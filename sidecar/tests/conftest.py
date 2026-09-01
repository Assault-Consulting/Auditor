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


@pytest.fixture
def spanned_chain(tmp_path):
    """A chain with one span opened and never closed.

    The unclosed case is the one worth a fixture: an interrupted operation
    looks exactly like this, and `end_seq` must come back null rather than
    filled in with the last record seen.
    """
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "spanned.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.session_start("run-42")
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    w.anchor()
    w.close()
    return path


@pytest.fixture
def safety_heavy_chain(tmp_path):
    """A chain with more SAFETY records than a small page limit — three
    candidates and the ack for one of them, mixed with non-SAFETY records
    on either side.

    `chain_path` has exactly one SAFETY record, which cannot exercise
    `/safety`'s own paging: a `total` that never exceeds `limit` cannot
    prove `has_more` is stated rather than a coincidence of the count. The
    mix of kinds (three INCIDENT_CANDIDATE, one OVERSIGHT_ACK) also means
    a test here cannot pass by asserting `record_type == 64` alone; it has
    to filter on the type this view claims to filter on.
    """
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "safetyheavy.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    c1 = w.incident_candidate(category=1, severity=2, detail="first")
    w.incident_candidate(category=1, severity=1, detail="second")
    w.incident_candidate(category=2, severity=3, detail="third")
    w.oversight_ack(3, c1, disposition=1, operator_id=b"\x01" * 16)
    w.anchor()
    w.close()
    return path


@pytest.fixture
def two_boot_chain(tmp_path):
    """A chain spanning two boots, so a boundary and a wall gap are real.

    One caveat this fixture cannot escape: `PalaWriter` reads the process
    monotonic clock, so a second boot written by the same process does NOT
    reset `monotonic_ns` the way a real restart would. A test asserting that
    monotonic is incomparable across a boot must rest on the format's rule,
    never on what this fixture happens to produce.
    """
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "twoboot.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    w.incident_candidate(category=1, severity=2, detail="first boot")
    w.anchor()
    w.close()

    w2 = PalaWriter.open_existing(path)
    w2.boot()
    w2.incident_candidate(category=1, severity=3, detail="second boot")
    w2.anchor()
    w2.close()
    return path


#: One UTC day in nanoseconds, so a fixture can place records on chosen days.
_DAY_NS = 86_400_000_000_000


@pytest.fixture
def multi_day_chain(tmp_path, monkeypatch):
    """A chain spanning three UTC days, with the middle one empty.

    Until this existed, every fixture in the suite was written in one burst
    and spanned under a millisecond — so the wall axis could only ever be
    checked arithmetically, never as the thing a person would look at. A
    date rail cannot be tested at all against a chain that occupies a single
    instant.

    The clock is controlled by patching the one the writer reads. That is
    not fabrication: `PalaWriter` still emits real records, real headers and
    a real hash chain, and the reader verifies them. Only *when* it was
    written is chosen. The monotonic clock is left alone, as a real writer's
    would be.

    Day 0 gets GENESIS, BOOT and the model load; day 1 nothing; day 2 the
    incident candidate and the anchor. So the rail has an empty row between
    two populated ones, which is the case a series that omitted empty buckets
    would silently smooth over.

    There are exactly as many stamps as records. An earlier version had one
    spare, which cost nothing at runtime and made a test assert the number of
    stamps rather than the number of records.
    """
    import palimpsests.audit.pala_writer as pw

    base = (1_787_000_000_000_000_000 // _DAY_NS) * _DAY_NS + 10 * 3_600_000_000_000
    stamps = [
        base,                                   # GENESIS
        base + 60_000_000_000,                  # BOOT
        base + 120_000_000_000,                 # MODEL_LOAD
        base + 2 * _DAY_NS,                     # INCIDENT_CANDIDATE
        base + 2 * _DAY_NS + 60_000_000_000,    # ANCHOR
    ]
    ticks = iter(stamps)
    monkeypatch.setattr(pw.time, "time_ns", lambda: next(ticks, stamps[-1]))

    path = tmp_path / "multiday.pala"
    w = pw.PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    w.incident_candidate(category=1, severity=2, detail="day two")
    w.anchor()
    w.close()
    return path
