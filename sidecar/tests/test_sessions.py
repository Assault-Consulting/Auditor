# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Opening a container and establishing what it is.

Identity before verdict, throughout: these tests assert that a session says
what the artifact *is* without saying anything about whether it verifies.
That separation is what lets a reader of a report confirm they hold the same
bytes the check ran against, whether or not the check passed.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.digest import file_sha256
from auditor_sidecar.main import build_app
from auditor_sidecar.pala_seam import NotAChain, open_chain
from auditor_sidecar.sessions import SessionNotFound, SessionStore, SubjectChanged
from fastapi.testclient import TestClient

# --- the store --------------------------------------------------------------


def test_open_reports_structure_from_the_reader(store: SessionStore, chain_path) -> None:
    s = store.open(chain_path)
    subject = s.subject()
    assert subject["records"] == 5
    assert subject["first_seq"] == 0
    assert subject["last_seq"] == 4
    assert subject["boots"] == 1


def test_digest_identifies_the_artifact(store: SessionStore, chain_path) -> None:
    """A report naming only a filename identifies nothing."""
    s = store.open(chain_path)
    assert s.subject()["sha256"] == file_sha256(chain_path)


def test_the_tiers_present_are_reported_as_a_set(store: SessionStore, chain_path) -> None:
    """Every tier the records carry, not the latest one.

    A chain written under more than one platform guarantee cannot have its
    verdict worded in a single sentence, and reducing the set here would
    decide that silently.
    """
    subject = store.open(chain_path).subject()
    assert subject["assurance_tiers"] == [{"value": 0, "name": "A"}]
    assert subject["time_trust_values"] == [{"value": 1, "name": "UNSYNCED"}]


def test_each_enum_carries_both_its_number_and_its_name(
    store: SessionStore, chain_path
) -> None:
    """The name is for a person; the number survives a name table changing."""
    for entry in store.open(chain_path).subject()["assurance_tiers"]:
        assert set(entry) == {"value", "name"}
        assert isinstance(entry["value"], int)


def test_two_sessions_on_one_file_are_independent(store: SessionStore, chain_path) -> None:
    a, b = store.open(chain_path), store.open(chain_path)
    assert a.session_id != b.session_id
    assert len(store) == 2
    store.close(a.session_id)
    assert len(store) == 1


def test_closing_an_unknown_session_is_an_error_not_a_shrug(store: SessionStore) -> None:
    with pytest.raises(SessionNotFound):
        store.close("never-existed")


# --- what is not a chain ----------------------------------------------------


def test_an_empty_file_is_not_a_chain(store: SessionStore, tmp_path) -> None:
    """Not "0 records, verified".

    An empty container is not a chain with nothing in it; it is a file that
    says nothing, and a verdict about nothing is the most misleading output
    this application could produce.
    """
    empty = tmp_path / "empty.pala"
    empty.write_bytes(b"")
    with pytest.raises(NotAChain):
        store.open(empty)


def test_a_non_pala_file_is_not_a_chain(store: SessionStore, tmp_path) -> None:
    junk = tmp_path / "notes.txt"
    junk.write_bytes(b"this is not a container")
    with pytest.raises(NotAChain):
        store.open(junk)


def test_a_directory_is_not_a_chain(store: SessionStore, tmp_path) -> None:
    with pytest.raises(NotAChain):
        store.open(tmp_path)


def test_a_missing_path_is_not_a_chain(store: SessionStore, tmp_path) -> None:
    with pytest.raises(NotAChain):
        store.open(tmp_path / "absent.pala")


# --- the file must not move under the session -------------------------------
#
# Each of these releases the container's memory map before touching the file,
# via `store.detach(...)`.
#
# That is not test choreography, it is the platform boundary. `AuditReader`
# memory-maps the container, and Windows refuses to write to or delete a file
# that backs an active mapping — ERROR_USER_MAPPED_FILE. A session still
# holding the map cannot observe the file change underneath it there, because
# Windows will not let the change happen at all.
#
# The behaviour under test is `assert_unchanged`, which reads the path and
# nothing else, and it must hold on every platform. See the note in
# sessions.py about which operating systems this guard actually protects.


def test_a_changed_file_invalidates_its_session(store: SessionStore, chain_path) -> None:
    """Re-reading silently would let a report describe one set of bytes while
    the screen showed another, with nothing anywhere saying so."""
    s = store.open(chain_path)
    s.assert_unchanged()
    store.detach(s.session_id)

    chain_path.write_bytes(chain_path.read_bytes() + b"\x00")
    with pytest.raises(SubjectChanged):
        s.assert_unchanged()


def test_a_deleted_file_invalidates_its_session(store: SessionStore, chain_path) -> None:
    s = store.open(chain_path)
    store.detach(s.session_id)

    chain_path.unlink()
    with pytest.raises(SubjectChanged):
        s.assert_unchanged()


def test_change_is_detected_by_digest_not_mtime(store: SessionStore, chain_path) -> None:
    """mtime is a claim the filesystem makes, and a copy can preserve it.

    This application does not accept claims where it can check.
    """
    import os

    s = store.open(chain_path)
    store.detach(s.session_id)

    before = chain_path.stat().st_mtime_ns
    chain_path.write_bytes(chain_path.read_bytes() + b"\x00")
    os.utime(chain_path, ns=(before, before))
    assert chain_path.stat().st_mtime_ns == before
    with pytest.raises(SubjectChanged):
        s.assert_unchanged()


# --- the seam ---------------------------------------------------------------


def test_the_seam_returns_no_package_types(chain_path) -> None:
    """Nothing from palimpsests crosses the seam.

    A package dataclass in a route signature becomes one in a response model,
    and the single point of contact quietly becomes a hundred.

    Checked by walking the whole structure and asking where each value's type
    came from, rather than by listing the scalar types that happen to be in
    use today. The earlier version enumerated `int | str` and failed the
    moment a legitimately plain list of dicts was added — a guard that
    obstructs correct changes gets loosened by whoever is in a hurry, and a
    loosened guard is the one that misses the real violation.
    """
    handle = open_chain(chain_path)
    try:
        assert type(handle).__module__.startswith("auditor_sidecar")
        _assert_plain(handle.subject())
        _assert_plain(handle.verify())
    finally:
        handle.close()


def _assert_plain(value: object, path: str = "subject") -> None:
    """Every value here must be a builtin, however deeply nested."""
    if isinstance(value, dict):
        for key, item in value.items():
            _assert_plain(item, f"{path}.{key}")
        return
    if isinstance(value, list | tuple):
        for index, item in enumerate(value):
            _assert_plain(item, f"{path}[{index}]")
        return
    origin = type(value).__module__
    assert origin == "builtins", f"{path} is a {origin} type: {type(value).__name__}"


# --- the HTTP surface -------------------------------------------------------


def test_post_session_returns_identity_and_verifier(open_client: TestClient, chain_path) -> None:
    r = open_client.post("/session", json={"path": str(chain_path)})
    assert r.status_code == 201
    body = r.json()
    assert body["subject"]["sha256"] == file_sha256(chain_path)
    assert body["verifier"]["package"].startswith("palimpsests ")
    assert body["verifier"]["spec"].startswith("PALA-1 ")


def test_post_session_says_nothing_about_the_verdict(open_client: TestClient, chain_path) -> None:
    """Identity is established before, and separately from, any verdict."""
    body = open_client.post("/session", json={"path": str(chain_path)}).json()
    flat = str(body)
    for word in ("chain_ok", "verified", "valid", "complete_to_anchor"):
        assert word not in flat


def test_a_non_chain_is_422_not_404_or_500(open_client: TestClient, tmp_path) -> None:
    """The path resolved; the bytes are not a chain.

    404 would say the file is missing and 500 would say this service is
    broken. Both send the operator to the wrong place.
    """
    junk = tmp_path / "notes.txt"
    junk.write_bytes(b"not a container")
    assert open_client.post("/session", json={"path": str(junk)}).status_code == 422


def test_session_lifecycle_over_http(open_client: TestClient, chain_path) -> None:
    sid = open_client.post("/session", json={"path": str(chain_path)}).json()["session_id"]
    assert open_client.get(f"/session/{sid}").status_code == 200
    assert open_client.delete(f"/session/{sid}").status_code == 204
    assert open_client.get(f"/session/{sid}").status_code == 404
    assert open_client.delete(f"/session/{sid}").status_code == 404


def test_sessions_require_the_token(gated_client: TestClient, auth, chain_path) -> None:
    """The session routes read a path off disk, so they are gated."""
    payload = {"path": str(chain_path)}
    assert gated_client.post("/session", json=payload).status_code == 401
    assert gated_client.post("/session", json=payload, headers=auth).status_code == 201


def test_each_app_has_its_own_store(chain_path) -> None:
    """One test's open container must not appear in another's session list."""
    a, b = TestClient(build_app(token=None)), TestClient(build_app(token=None))
    sid = a.post("/session", json={"path": str(chain_path)}).json()["session_id"]
    assert b.get(f"/session/{sid}").status_code == 404
