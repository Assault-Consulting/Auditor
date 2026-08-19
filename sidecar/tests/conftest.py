# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Shared test fixtures.

Every piece of process-global state gets a reset fixture, and the resets are
autouse so a test that never asks for them still starts clean. The failure
this prevents is the one that is hardest to diagnose: a test that passes alone
and fails in a suite, or passes in the suite and fails alone.

The environment variable holding the session token is cleared for every test.
A developer running the suite with a real token exported would otherwise see
different behaviour from CI, and the difference would be invisible.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.main import TOKEN_ENV, build_app, new_token
from fastapi.testclient import TestClient

TEST_TOKEN = "test-token-not-a-secret"


@pytest.fixture(autouse=True)
def _no_ambient_token(monkeypatch):
    """Keep every test off whatever token the developer's shell has exported."""
    monkeypatch.delenv(TOKEN_ENV, raising=False)


@pytest.fixture
def open_client() -> TestClient:
    """A sidecar with the token gate disabled — the development posture."""
    return TestClient(build_app(token=None))


@pytest.fixture
def gated_client() -> TestClient:
    """A sidecar with the token gate enforced — the production posture."""
    return TestClient(build_app(token=TEST_TOKEN))


@pytest.fixture
def auth() -> dict[str, str]:
    """The header a correctly-configured caller sends."""
    return {"Authorization": f"Bearer {TEST_TOKEN}"}


@pytest.fixture
def fresh_token() -> str:
    return new_token()


@pytest.fixture
def store():
    """A fresh session store, closed afterwards.

    Containers are memory-mapped while open; leaving one mapped past the end
    of a test keeps a file handle alive and, on Windows, makes tmp_path
    cleanup fail in a way that reads as an unrelated flake.
    """
    from auditor_sidecar.sessions import SessionStore

    s = SessionStore()
    try:
        yield s
    finally:
        s.close_all()


@pytest.fixture
def chain_path(tmp_path):
    """A real PALA-1 container, written by the package's own writer.

    Built rather than committed as a binary fixture: a hand-made container
    would be this repository asserting what the format looks like, which is
    the thing ADR-0001 exists to prevent. The writer is the authority.
    """
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "chain.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    w.incident_candidate(category=1, severity=2, detail="guard escalation x3")
    w.anchor()
    w.close()
    return path
