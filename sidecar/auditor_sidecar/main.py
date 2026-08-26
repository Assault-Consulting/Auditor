# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Sidecar FastAPI entrypoint.

Serves on ``127.0.0.1:8771``. This process reads arbitrary file paths on
request, which makes it the most sensitive surface in the application, so two
things are true of it from the first commit rather than from a later hardening
pass:

* it binds loopback only — never ``0.0.0.0``;
* every route except the liveness probe requires a **per-launch bearer token**
  that the desktop shell generates and hands to the frontend over IPC. Without
  it, any other local process could ask this service to read any file the user
  can read.

``/health`` is deliberately exempt: the shell polls it to decide when the
sidecar is up, and a liveness probe that can fail for two different reasons is
a liveness probe that cannot be trusted. It discloses only versions.
"""

from __future__ import annotations

import os
import secrets
import uvicorn
from . import __version__
from .anchors import NO_ANCHOR, AnchorProfiles, ProfileNotFound
from .keychain import KeychainUnavailable
from .keychain import available as keychain_available
from .keychain import write as keychain_write
from .models import (
    AnchorProfile,
    BootView,
    ChainSubject,
    HealthResponse,
    KeychainSeedRequest,
    KeychainStatus,
    OriginModel,
    RecordPage,
    RecordView,
    SessionRequest,
    SessionResponse,
    SpanView,
    Timeline,
    VerificationResponse,
)
from .pala_seam import NotAChain, UnknownAnchorKind, verifier_identity
from .sessions import SessionNotFound, SessionStore, SubjectChanged
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pathlib import Path

#: Not 8765. A fixed, distinctive default avoids colliding with another local
#: service on a developer machine, which would otherwise present as the shell
#: talking to something that is not this sidecar. The shell overrides it when
#: the port is taken.
DEFAULT_PORT = 8771

PORT_ENV = "AUDITOR_SIDECAR_PORT"
TOKEN_ENV = "AUDITOR_SIDECAR_TOKEN"

#: Origins the webview can legitimately present.
#:
#: CORS is NOT the security boundary here and must never be mistaken for one:
#: it is enforced by browsers, and any local process with curl ignores it
#: entirely. The boundary is the bearer token. What this list does is narrower
#: and still worth having — it stops an ordinary web page open in the user's
#: browser from probing the unauthenticated /health endpoint and learning that
#: this application is installed and which verifier it links against.
#:
#: Hence exact origins, no wildcard, and no credentials: the token travels in
#: an Authorization header, never in a cookie, so allow_credentials stays off.
#: See docs/adr/0002-the-bearer-token-is-the-boundary.md.
ALLOWED_ORIGINS = (
    "tauri://localhost",       # macOS and Linux webview
    "http://tauri.localhost",  # Windows webview
    "http://localhost:1420",   # vite dev server
    "http://127.0.0.1:1420",
)


def resolve_port() -> int:
    """The port to serve on, from the environment or the default."""
    # Stripped before the emptiness check, so an env var set to whitespace
    # behaves the same as one set to "" and the same as one never set. Three
    # spellings of "unset" that behave differently is a bug waiting for a
    # launcher script with a stray space in it.
    raw = os.environ.get(PORT_ENV, "").strip()
    if not raw:
        return DEFAULT_PORT
    try:
        port = int(raw)
    except ValueError:
        raise SystemExit(f"{PORT_ENV} is not a number: {raw!r}") from None
    if not 1 <= port <= 65535:
        raise SystemExit(f"{PORT_ENV} out of range: {port}")
    return port

#: Routes reachable without a token. Keep this list at exactly one entry
#: unless there is a reason of the same weight as the liveness argument above.
PUBLIC_PATHS = frozenset({"/health"})


def new_token() -> str:
    """Generate a per-launch session token. Used by the shell and by tests."""
    return secrets.token_urlsafe(32)


def build_app(token: str | None = None) -> FastAPI:
    """Construct the application.

    A factory rather than a module-level singleton so tests can build an
    instance with a known token, and so the token is read once at construction
    instead of at import — an import-time read is untestable and silently
    fixes the value for the life of the process.
    """
    if token is None:
        token = os.environ.get(TOKEN_ENV) or None

    app = FastAPI(
        title="palimpsests-auditor-sidecar",
        version=__version__,
        docs_url="/docs",
    )
    app.state.token = token
    # One store per application instance, not a module global: tests build
    # several apps in one process, and a shared store would let one test's
    # open container appear in another's session list.
    app.state.sessions = SessionStore()
    app.state.anchors = AnchorProfiles()

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        # Returned, not raised. An HTTPException raised inside middleware is
        # not seen by the application's exception handlers — it propagates and
        # surfaces as a 500, which would report an authentication refusal as a
        # server fault. The response is constructed here instead.
        expected = request.app.state.token
        if expected and request.url.path not in PUBLIC_PATHS:
            presented = request.headers.get("authorization", "")
            if not secrets.compare_digest(presented, f"Bearer {expected}"):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "bad or missing session token"},
                )
        return await call_next(request)

    # Added AFTER the token middleware, and therefore running OUTSIDE it:
    # Starlette builds the stack in reverse order of registration. A CORS
    # preflight carries no Authorization header, so if the token check ran
    # first every preflight would be refused and every real request would
    # fail for a reason the browser reports as a CORS error rather than a
    # 401 — an hour of debugging the wrong layer.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        """Liveness probe, and the identity triple the UI displays.

        The verifier version is reported because a verification result is only
        meaningful alongside the verifier that produced it.
        """
        identity = verifier_identity()
        return HealthResponse(
            status="ok",
            version=__version__,
            package=identity["package"],
            spec=identity["spec"],
            authenticated=request_token_required(app),
        )

    @app.post("/session", response_model=SessionResponse, status_code=201)
    def open_session(req: SessionRequest) -> SessionResponse:
        """Open a container and return what it is.

        Deliberately says nothing about whether the chain verifies. Identity
        and structure are established first, and separately: a reader of a
        report must be able to confirm they hold the same artifact the check
        ran against, whether or not that check passed.
        """
        try:
            session = app.state.sessions.open(Path(req.path))
        except NotAChain as exc:
            # 422, not 404 or 500. The path resolved; the bytes are not a
            # chain. A 404 would say the file is missing and a 500 would say
            # this service is broken — both send the operator to the wrong
            # place.
            raise HTTPException(status_code=422, detail=str(exc)) from None

        return SessionResponse(
            session_id=session.session_id,
            subject=ChainSubject(**session.subject()),
            verifier=verifier_identity(),
        )

    @app.get("/session/{session_id}", response_model=SessionResponse)
    def get_session(session_id: str) -> SessionResponse:
        session = _session_or_404(app, session_id)
        session.assert_unchanged()
        return SessionResponse(
            session_id=session.session_id,
            subject=ChainSubject(**session.subject()),
            verifier=verifier_identity(),
        )

    @app.get("/anchors/profiles", response_model=list[AnchorProfile])
    def list_profiles() -> list[AnchorProfile]:
        """Every profile this sidecar knows, including the empty one."""
        return [
            AnchorProfile(name=name, sources=sources)
            for name, sources in sorted(app.state.anchors.all().items())
        ]

    @app.put("/anchors/profiles/{name}", response_model=AnchorProfile)
    def put_profile(name: str, profile: AnchorProfile) -> AnchorProfile:
        """Define or replace a profile.

        The body's `name` is ignored in favour of the path, so a profile
        cannot be defined under one name and answer to another.
        """
        specs = [s.model_dump(exclude_none=True) for s in profile.sources]
        try:
            app.state.anchors.put(name, specs)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from None
        return AnchorProfile(name=name, sources=profile.sources)

    @app.delete("/anchors/profiles/{name}", status_code=204)
    def delete_profile(name: str) -> None:
        try:
            app.state.anchors.delete(name)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from None
        except ProfileNotFound:
            raise HTTPException(status_code=404, detail="no such profile") from None

    @app.get("/anchors/keychain", response_model=KeychainStatus)
    def keychain_status() -> KeychainStatus:
        """Whether this machine can keep an anchor at all.

        Asked before the operator configures a keychain profile, so the UI
        can say "this machine has nowhere to keep one" rather than letting
        them configure a source that will report absent forever.
        """
        if keychain_available():
            return KeychainStatus(
                available=True, detail="a secret store is available on this machine"
            )
        return KeychainStatus(
            available=False,
            detail=(
                "no usable secret store: install the keyring extra, or use a "
                "file or manual anchor on this machine"
            ),
        )

    @app.put("/anchors/keychain", status_code=204)
    def seed_keychain(req: KeychainSeedRequest) -> None:
        """Store a head in the secret store.

        This writes, and the read-only rule still holds: the target is
        Auditor's own anchor store, never an audited container. The rule is
        about not touching evidence, not about never writing a byte.

        It exists so an operator can seed an anchor from the application
        rather than from a shell one-liner they have to get exactly right —
        and a head seeded with a typo persists, so getting it right matters
        more here than anywhere else.
        """
        try:
            keychain_write(req.account, req.head)
        except KeychainUnavailable as exc:
            # 503, not 500: the service is fine, the machine has nowhere to
            # put this. The operator can act on that; a 500 would send them
            # to our logs.
            raise HTTPException(status_code=503, detail=str(exc)) from None

    @app.get("/session/{session_id}/boots", response_model=list[BootView])
    def session_boots(session_id: str) -> list[BootView]:
        """The boots in this container, with their statistics.

        Browsing is separate from verifying, and answers no question about
        soundness. A chain that fails verification is still browsed — half
        the job is inspecting evidence that did not pass.
        """
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)
        return [BootView(**boot) for boot in session.boots()]

    @app.get("/session/{session_id}/spans", response_model=list[SpanView])
    def session_spans(session_id: str) -> list[SpanView]:
        """The spans in this container, including the ones never closed."""
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)
        return [SpanView(**span) for span in session.spans()]

    @app.get("/session/{session_id}/records", response_model=RecordPage)
    def session_records(
        session_id: str,
        offset: int = Query(
            default=0,
            ge=0,
            description="First sequence number to include.",
        ),
        limit: int = Query(
            default=200,
            ge=1,
            le=1000,
            description=(
                "Most records to return. Bounded at 1000 because the caller "
                "choosing the page size must not be able to ask for a "
                "response the sidecar cannot build."
            ),
        ),
        record_type: int | None = Query(
            default=None,
            description=(
                "Keep only records of this raw type. Filtering by a type "
                "that appears nowhere yields an empty window rather than an "
                "error — that is the truthful answer to the question asked."
            ),
        ),
        boot_id: str | None = Query(
            default=None, description="Keep only records from this boot."
        ),
        span_id: str | None = Query(
            default=None, description="Keep only records carrying this span."
        ),
    ) -> RecordPage:
        """A window onto the records, as structure rather than content.

        `total` counts the records that matched the filters, not the records
        in the file. A total that counted everything would print "3 of 40000"
        above three rows that are the only three there are.
        """
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)
        return RecordPage(
            **session.records(
                offset=offset,
                limit=limit,
                record_type=record_type,
                boot_id=boot_id,
                span_id=span_id,
            )
        )

    @app.get("/session/{session_id}/record/{seq}", response_model=RecordView)
    def session_record(session_id: str, seq: int) -> RecordView:
        """One record by sequence number.

        404 when the file holds no such record. A segment covering records
        400–900 legitimately has no record 12, and saying so is different
        from saying the session is unknown — which the caller can tell apart
        because that 404 names the session instead.
        """
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)
        record = session.record(seq)
        if record is None:
            raise HTTPException(
                status_code=404, detail=f"this container holds no record {seq}"
            )
        return RecordView(**record)

    @app.get("/session/{session_id}/origin", response_model=OriginModel | None)
    def session_origin(
        session_id: str,
        seq: int = Query(
            description=(
                "The record to ask about. Required rather than defaulted: "
                "origin changes along a chain, so an unasked-for default "
                "would answer a different question than the caller meant."
            ),
        ),
    ) -> OriginModel | None:
        """What was running when a record was written, or null if unstated.

        **Null is an answer, not an absence.** Nothing before the first
        MODEL_LOAD has an origin, because none had been declared — and a UI
        must render that as "not stated in this file" rather than as an
        empty card, which would read as "nothing was running".

        200 with a null body rather than 404 for that reason: the question
        was answered, and the answer is that the file does not say.
        """
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)
        origin = session.origin(seq)
        return None if origin is None else OriginModel(**origin)

    @app.get("/session/{session_id}/timeline", response_model=Timeline)
    def session_timeline(
        session_id: str,
        axis: str = Query(
            default="seq",
            description=(
                "'seq' for proved order, 'wall' for the writer's clock. "
                "Defaults to seq because that is the axis the chain "
                "establishes; wall time is a claim and is opt-in (L3)."
            ),
        ),
        buckets: int = Query(
            default=120,
            ge=1,
            le=2000,
            description=(
                "How many intervals to divide the range into. Bounded for "
                "the same reason the record page is: the caller choosing the "
                "resolution must not be able to ask for a response the "
                "sidecar cannot build."
            ),
        ),
        align: str | None = Query(
            default=None,
            description=(
                "Omit for uniform buckets. 'day' makes each bucket one UTC "
                "calendar day, which is what a date rail needs: a uniform "
                "bucket of roughly a day straddles midnight, so a record "
                "just after it would be labelled with the previous date. "
                "Needs axis='wall' — sequence numbers have no calendar."
            ),
        ),
    ) -> Timeline:
        """Record density along one axis, with the boot breaks beside it."""
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)
        try:
            return Timeline(
                **session.timeline(axis=axis, buckets=buckets, align=align)
            )
        except ValueError as exc:
            # 422 for all three of the seam's refusals — an unknown axis, an
            # unknown alignment, and a bucket count too small for the span —
            # because each of them has the same alternative and it is worse.
            # Substituting a default would answer a different question than
            # the caller asked and return it labelled as theirs: uniform
            # buckets marked as calendar days, or a rail silently missing its
            # last stretch, which looks exactly like a chain that ended early.
            raise HTTPException(status_code=422, detail=str(exc)) from None

    @app.get("/session/{session_id}/verify", response_model=VerificationResponse)
    def verify_session(
        session_id: str,
        profile: str = Query(
            default=NO_ANCHOR,
            description=(
                "Anchor profile to check completeness against. The default "
                "asks question one only and leaves question two not checked."
            ),
        ),
    ) -> VerificationResponse:
        """The verifier's answer about this session's container.

        Re-checks the file digest first. A verdict about bytes that have since
        changed is worse than no verdict, because it looks like one.

        Note what this endpoint does NOT return: a single "valid" field. The
        three questions have three separate answers, one of which can be "not
        asked", and collapsing them here would be the shell deciding what a
        verdict means — which is the one thing ADR-0001 exists to prevent.
        """
        session = _session_or_404(app, session_id)
        _assert_still_the_subject(session)

        try:
            sources = app.state.anchors.get(profile)
        except ProfileNotFound:
            # 404 on the profile, not a fallback to no anchor. Falling back
            # would answer a question the caller did not ask and label it as
            # theirs — and "not checked" looks identical whether it was
            # requested or substituted.
            raise HTTPException(
                status_code=404, detail=f"no anchor profile named {profile!r}"
            ) from None

        try:
            result = session.verify(profile, sources)
        except UnknownAnchorKind as exc:
            raise HTTPException(
                status_code=422, detail=f"unknown anchor source kind: {exc}"
            ) from None

        return VerificationResponse(
            session_id=session.session_id,
            subject_sha256=session.sha256,
            verifier=verifier_identity(),
            **result,
        )

    @app.delete("/session/{session_id}", status_code=204)
    def close_session(session_id: str) -> None:
        try:
            app.state.sessions.close(session_id)
        except SessionNotFound:
            raise HTTPException(status_code=404, detail="no such session") from None

    return app


def _assert_still_the_subject(session) -> None:
    """409 when the file moved under an open session.

    Not 200-with-a-warning. The session's subject and the file on disk are no
    longer the same artifact, so there is no honest answer to give — only a
    refusal that names the reason. A verdict about bytes that have since
    changed is worse than none, because it looks like one.

    Browsing needs this as much as verifying does, which is why it is one
    function rather than a check copied into each route: a record list read
    from a file that has since changed describes bytes nobody is holding any
    more, and looks exactly like one that does not.
    """
    try:
        session.assert_unchanged()
    except SubjectChanged as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


def _session_or_404(app: FastAPI, session_id: str):
    try:
        return app.state.sessions.get(session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="no such session") from None


def request_token_required(app: FastAPI) -> bool:
    """Whether this instance is enforcing the token gate."""
    return bool(app.state.token)


app = build_app()


def run() -> None:
    """Entrypoint for ``python -m auditor_sidecar.main`` and the bundled binary."""
    if not app.state.token:
        print(
            f"WARNING: {TOKEN_ENV} is unset — the session token gate is DISABLED. "
            "This is a development affordance, not a supported configuration: "
            "any local process can ask this service to read any file you can read."
        )
    uvicorn.run(app, host="127.0.0.1", port=resolve_port(), log_level="info")


if __name__ == "__main__":
    run()
