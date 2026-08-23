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


class _InMemoryKeyring:
    """A secret store that lives and dies with one test.

    Deliberately not a mock. The keychain anchor source has to be exercised
    against something that really stores and returns values, or the tests
    would only prove that a mock was called — and the interesting cases here
    are *absent* and *unreadable*, which a mock makes up rather than
    produces.
    """

    priority = 1

    def __init__(self) -> None:
        self.entries: dict[tuple[str, str], str] = {}

    def set_password(self, service: str, username: str, password: str) -> None:
        self.entries[(service, username)] = password

    def get_password(self, service: str, username: str) -> str | None:
        return self.entries.get((service, username))

    def delete_password(self, service: str, username: str) -> None:
        self.entries.pop((service, username), None)


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_keyring: run against the genuinely installed keyring module. "
        "Only for tests that import it and never touch a stored secret.",
    )


@pytest.fixture(autouse=True)
def _no_real_keychain(request, monkeypatch):
    """Point every test at an in-memory store, always.

    Autouse and unconditional, because the failure this prevents is silent:
    a test that reaches the developer's real keychain passes locally, may
    prompt for a password, and can write an entry that outlives the run.
    CONTRIBUTING.md has said "a test that touches the developer's real OS
    keychain is a bug even when it passes" since before there was a keychain
    source to touch one — this is that sentence made true.

    Installed by patching the module's importer rather than calling
    `keyring.set_keyring`, which mutates process-global state that would
    leak between tests and outlive the session.

    A test may opt out with `@pytest.mark.real_keyring`, and exactly one
    does: the one that checks the real importer works at all. Opting out is
    a marker rather than a conftest edit so that every such test is greppable
    — the isolation is only worth something if departures from it are
    visible.
    """
    from auditor_sidecar import keychain as kc

    if request.node.get_closest_marker("real_keyring"):
        return None

    store = _InMemoryKeyring()

    class _Errors:
        KeyringError = RuntimeError

    monkeypatch.setattr(kc, "_import_keyring", lambda: (_FakeKeyringModule(store), _Errors))
    return store


class _FakeKeyringModule:
    """Just enough of the keyring module surface for the code under test."""

    def __init__(self, store: _InMemoryKeyring) -> None:
        self._store = store

    def get_password(self, service: str, account: str) -> str | None:
        return self._store.get_password(service, account)

    def set_password(self, service: str, account: str, secret: str) -> None:
        self._store.set_password(service, account, secret)

    def get_keyring(self):
        return self._store


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


@pytest.fixture
def head_hex(chain_path) -> str:
    """The chain's head, through the seam.

    Shared by the anchor and agreement tests so neither computes it itself —
    a test that derives the head independently would be re-implementing the
    format to check the thing that forbids re-implementing the format.
    """
    from auditor_sidecar.pala_seam import open_chain

    handle = open_chain(chain_path)
    try:
        return handle.verify()["chain"]["head"]
    finally:
        handle.close()


@pytest.fixture
def lagging_chain(tmp_path):
    """A chain with records written after the head that was anchored.

    Returns (path, head as it stood partway through, records written since).
    Built with the writer's own `head_hex` rather than by hashing anything
    here — a fixture that computed a head itself would be re-implementing the
    format in order to test the rule that forbids re-implementing the format.
    """
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "lagging.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    early = w.head_hex
    w.incident_candidate(category=1, severity=2, detail="written after the anchor")
    w.anchor()
    w.close()
    return path, early, 2


@pytest.fixture
def body_swapped_chain(tmp_path):
    """A chain whose header links are intact and one of whose bodies is not.

    Sixteen bytes of a cleartext record body are replaced in place, so every
    header — and therefore the whole chain hash — still verifies, while the
    body no longer matches the `body_digest` its own header carries.

    Written with a distinctive marker rather than by computing offsets: the
    fixture finds the text it wrote and overwrites it, which needs no
    knowledge of the format's layout.

    This is the shape neither the agreement suite nor the mutation fixtures
    contained. Every fixture in both damages a header or the chain; none
    touched a body, which is why a real overclaim survived nine pull requests
    of wording discipline.
    """
    from palimpsests.audit.pala_writer import PalaWriter

    marker = b"A" * 16
    path = tmp_path / "bodyswap.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    w.incident_candidate(category=1, severity=2, detail=marker.decode())
    w.anchor()
    w.close()

    data = path.read_bytes()
    at = data.index(marker)
    path.write_bytes(data[:at] + b"B" * 16 + data[at + 16 :])
    return path
