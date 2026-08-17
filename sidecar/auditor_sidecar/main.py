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
from .pala_seam import verifier_identity
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

#: Not 8765. A fixed, distinctive port avoids colliding with another local
#: service on a developer machine, which would otherwise present as the shell
#: talking to something that is not this sidecar.
PORT = 8771

TOKEN_ENV = "AUDITOR_SIDECAR_TOKEN"

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

    @app.get("/health")
    def health() -> dict[str, object]:
        """Liveness probe, and the identity triple the UI displays.

        The verifier version is reported because a verification result is only
        meaningful alongside the verifier that produced it.
        """
        return {
            "status": "ok",
            "version": __version__,
            "authenticated": bool(request_token_required(app)),
            **verifier_identity(),
        }

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
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    run()
