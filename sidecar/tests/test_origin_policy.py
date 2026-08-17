# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The webview origin policy and the port the sidecar serves on.

CORS is tested here as a *narrowing* control, not as the security boundary.
The boundary is the bearer token: any local process with curl ignores CORS
entirely, so a passing test in this file proves only that an ordinary web
page open in the user's browser cannot reach the service — not that the
service is protected. ADR-0002 states that distinction; these tests keep the
allowlist from quietly widening past what it says.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.main import (
    ALLOWED_ORIGINS,
    DEFAULT_PORT,
    PORT_ENV,
    build_app,
    resolve_port,
)
from fastapi.testclient import TestClient

TAURI_ORIGIN = "tauri://localhost"

# --- the origin allowlist ---------------------------------------------------


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_allowed_origins_get_a_cors_header(origin: str) -> None:
    client = TestClient(build_app(token=None))
    r = client.get("/health", headers={"Origin": origin})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize(
    "origin",
    [
        "https://example.com",
        "http://localhost:3000",  # a neighbouring dev server is not us
        "http://tauri.localhost:1420",  # close, and still not on the list
        "null",
    ],
)
def test_foreign_origins_get_no_cors_header(origin: str) -> None:
    """No header means the browser refuses the response to the caller.

    Note what this does *not* claim: the request still reached the service
    and still returned 200. CORS is a browser-side control. Only the token
    keeps a non-browser caller out.
    """
    client = TestClient(build_app(token=None))
    r = client.get("/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in r.headers


def test_no_wildcard_origin_is_ever_sent() -> None:
    """A wildcard would let any page on the internet read /health."""
    client = TestClient(build_app(token=None))
    for origin in (*ALLOWED_ORIGINS, "https://example.com"):
        r = client.get("/health", headers={"Origin": origin})
        assert r.headers.get("access-control-allow-origin") != "*"


def test_credentials_are_not_allowed() -> None:
    """The token travels in an Authorization header, never in a cookie.

    Allowing credentials would invite a cookie-based session later, and a
    cookie is exactly the thing a cross-site request carries by default.
    """
    client = TestClient(build_app(token=None))
    r = client.get("/health", headers={"Origin": TAURI_ORIGIN})
    assert "access-control-allow-credentials" not in r.headers


# --- preflight vs the token gate --------------------------------------------


def test_preflight_succeeds_while_the_token_gate_is_on() -> None:
    """Registration order is load-bearing, so it is pinned here.

    A CORS preflight carries no Authorization header. If the token middleware
    ran outside the CORS middleware, every preflight would be refused, and the
    browser would report the failure as a CORS error rather than a 401 — an
    hour spent debugging the wrong layer. Starlette builds the stack in
    reverse order of registration, so CORS is added last to run first.
    """
    app = build_app(token="s3cret")

    @app.get("/__probe")
    def probe() -> dict[str, bool]:
        return {"reached": True}

    client = TestClient(app)
    r = client.options(
        "/__probe",
        headers={
            "Origin": TAURI_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == TAURI_ORIGIN


def test_preflight_does_not_open_the_real_request() -> None:
    """An allowed origin still needs the token for the request that follows."""
    app = build_app(token="s3cret")

    @app.get("/__probe")
    def probe() -> dict[str, bool]:
        return {"reached": True}

    client = TestClient(app)
    assert client.get("/__probe", headers={"Origin": TAURI_ORIGIN}).status_code == 401
    ok = client.get(
        "/__probe",
        headers={"Origin": TAURI_ORIGIN, "Authorization": "Bearer s3cret"},
    )
    assert ok.status_code == 200


# --- the port ---------------------------------------------------------------


def test_port_defaults_when_unset(monkeypatch) -> None:
    monkeypatch.delenv(PORT_ENV, raising=False)
    assert resolve_port() == DEFAULT_PORT


def test_port_is_read_from_the_environment(monkeypatch) -> None:
    """The shell picks the port, because it is the process that can see a
    collision and retry. A hard-coded port would make two Auditor windows on
    one machine fight over it silently."""
    monkeypatch.setenv(PORT_ENV, "9931")
    assert resolve_port() == 9931


@pytest.mark.parametrize("blank", ["", " ", "   "])
def test_blank_port_is_treated_as_unset(monkeypatch, blank: str) -> None:
    """Three spellings of "unset" that behaved differently would be a bug
    waiting for a launcher script with a stray space in it."""
    monkeypatch.setenv(PORT_ENV, blank)
    assert resolve_port() == DEFAULT_PORT


@pytest.mark.parametrize("bad", ["nine", "80.5", "-1", "0", "65536", "99999"])
def test_a_bad_port_exits_rather_than_guessing(monkeypatch, bad: str) -> None:
    """Refuse loudly. Falling back to the default here would start the service
    on a port the shell is not watching, and the window would sit forever on
    "starting" with a healthy sidecar three ports away."""
    monkeypatch.setenv(PORT_ENV, bad)
    with pytest.raises(SystemExit):
        resolve_port()
