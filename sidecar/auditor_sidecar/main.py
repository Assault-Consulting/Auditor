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
from .models import HealthResponse
from .pala_seam import verifier_identity
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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

    return app


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
