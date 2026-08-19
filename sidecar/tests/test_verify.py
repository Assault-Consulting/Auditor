# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Asking the verifier, and passing the answer through unchanged.

The theme of this file is what the sidecar must *not* do: not summarise, not
combine, not decide. Every assertion here exists because the corresponding
shortcut is tempting and would be wrong.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.pala_seam import open_chain
from fastapi.testclient import TestClient

# --- the shape of an answer -------------------------------------------------


def test_a_sound_chain_answers_question_one(open_client: TestClient, chain_path) -> None:
    body = _verify(open_client, chain_path)
    assert body["chain"]["chain_ok"] is True
    assert body["chain"]["count"] == 5
    assert len(body["chain"]["head"]) == 64
    assert body["diagnosis"] is None


def test_no_anchor_means_not_checked_never_passed(open_client: TestClient, chain_path) -> None:
    """L7. The tri-state stays a tri-state.

    Null here means the question was never asked. Any code path that turned
    it into False would report a failure that did not happen, and any that
    turned it into True would report a check that was never run — which is
    the worse of the two.
    """
    completeness = _verify(open_client, chain_path)["completeness"]
    assert completeness["complete_to_anchor"] is None
    assert completeness["anchor_lag"] is None


def test_there_is_no_single_valid_field(open_client: TestClient, chain_path) -> None:
    """Three questions, three answers, one of which can be "not asked".

    A field collapsing them would be the shell deciding what a verdict means.
    This test fails the moment someone adds the convenience field a UI
    developer will eventually ask for.
    """
    body = _verify(open_client, chain_path)
    for forbidden in ("valid", "ok", "passed", "verdict", "status"):
        assert forbidden not in body


def test_the_answer_carries_its_subject(open_client: TestClient, chain_path) -> None:
    """A verification result must not be separable from what it is about."""
    opened = open_client.post("/session", json={"path": str(chain_path)}).json()
    body = open_client.get(f"/session/{opened['session_id']}/verify").json()
    assert body["subject_sha256"] == opened["subject"]["sha256"]
    assert body["verifier"] == opened["verifier"]


def test_advisory_is_carried_apart_from_the_chain(open_client: TestClient, chain_path) -> None:
    """L5. Advisory items live in their own key and say so in the payload.

    The note travels with the data rather than being left to the UI, because
    a consumer that receives advisory items beside chain_ok will eventually
    treat them as part of it.
    """
    body = _verify(open_client, chain_path)
    assert "advisory" in body
    assert body["advisory"]["note"] == "advisory items do not affect the verdict"
    assert "advisory" not in body["chain"]


# --- failure is described, not labelled -------------------------------------


def test_a_truncated_tail_is_diagnosed_not_just_failed(
    open_client: TestClient, truncated_chain
) -> None:
    """"Invalid" would be useless here.

    A writer interrupted mid-write and a replaced log are different
    incidents, and only the pattern tells the operator which one to open.
    """
    body = _verify(open_client, truncated_chain)
    assert body["diagnosis"]["pattern"] == "truncated_tail"
    assert body["diagnosis"]["narrative"]


def test_a_failing_chain_still_reports_its_structure(
    open_client: TestClient, truncated_chain
) -> None:
    """Failure never hides structure — inspecting broken evidence is half the job."""
    body = _verify(open_client, truncated_chain)
    assert body["chain"]["count"] > 0
    assert len(body["chain"]["head"]) == 64


def test_the_narrative_is_the_packages_own_sentence(truncated_chain) -> None:
    """Carried verbatim. A shell may show a localised sentence beside it and
    never instead of it, or the report stops saying what the verifier said."""
    handle = open_chain(truncated_chain)
    try:
        assert handle.verify()["diagnosis"]["narrative"].startswith("The container ends")
    finally:
        handle.close()


def test_an_advisory_item_is_reported_with_its_code(truncated_chain) -> None:
    handle = open_chain(truncated_chain)
    try:
        advisory = handle.verify()["advisory"]
        assert advisory["count"] >= 1
        assert advisory["items"][0]["code"] == "anchor_never_written"
    finally:
        handle.close()


# --- determinism and caching ------------------------------------------------


def test_verifying_twice_returns_the_same_object(store, chain_path) -> None:
    """Not a performance test.

    Two runs that disagreed would mean the shell had shown a verdict it could
    no longer reproduce, and reproducibility is this application's entire
    claim. Caching makes disagreement impossible rather than unlikely.
    """
    s = store.open(chain_path)
    assert s.verify() is s.verify()


def test_two_sessions_on_one_file_agree(store, chain_path) -> None:
    a, b = store.open(chain_path), store.open(chain_path)
    assert a.verify() == b.verify()


# --- the subject must still be the subject ----------------------------------


def test_verify_refuses_when_the_file_changed(open_client: TestClient, chain_path) -> None:
    """409, not a verdict with a warning attached.

    The session's subject and the file on disk are no longer the same
    artifact, so there is no honest answer — only a refusal that names why.
    A verdict about bytes that have since changed is worse than none, because
    it looks like one.
    """
    sid = open_client.post("/session", json={"path": str(chain_path)}).json()["session_id"]
    assert open_client.get(f"/session/{sid}/verify").status_code == 200

    open_client.app.state.sessions.detach(sid)
    chain_path.write_bytes(chain_path.read_bytes() + b"\x00")

    r = open_client.get(f"/session/{sid}/verify")
    assert r.status_code == 409
    assert "changed" in r.json()["detail"]


def test_verify_on_an_unknown_session_is_404(open_client: TestClient) -> None:
    assert open_client.get("/session/never-existed/verify").status_code == 404


def test_verify_requires_the_token(gated_client: TestClient, auth, chain_path) -> None:
    sid = gated_client.post(
        "/session", json={"path": str(chain_path)}, headers=auth
    ).json()["session_id"]
    assert gated_client.get(f"/session/{sid}/verify").status_code == 401
    assert gated_client.get(f"/session/{sid}/verify", headers=auth).status_code == 200


# --- helpers ----------------------------------------------------------------


def _verify(client: TestClient, path) -> dict:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    r = client.get(f"/session/{sid}/verify")
    assert r.status_code == 200
    return r.json()


@pytest.fixture
def truncated_chain(chain_path):
    """A container cut mid-record, which is what a crashed writer leaves.

    Produced by truncating a real chain rather than by hand-writing broken
    bytes: the mutation is described in the specification, and a fixture that
    invented its own damage would be testing our idea of breakage rather than
    the verifier's.
    """
    data = chain_path.read_bytes()
    chain_path.write_bytes(data[:-40])
    return chain_path
