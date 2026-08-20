# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Anchor profiles, and the provenance that must travel with every answer.

An anchor is what makes question two answerable at all, and it has to come
from outside the log — otherwise the log vouches for itself. These tests are
mostly about the consequences of that: a completeness claim is worth exactly
as much as the anchor behind it, so the two are never allowed to separate.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.anchors import NO_ANCHOR, AnchorProfiles, ProfileNotFound
from auditor_sidecar.models import AnchorSourceSpec
from auditor_sidecar.pala_seam import UnknownAnchorKind, open_chain
from fastapi.testclient import TestClient
from pydantic import ValidationError

# --- a head is validated where it is pasted ---------------------------------


def test_a_head_is_normalised_not_merely_accepted() -> None:
    assert AnchorSourceSpec(kind="manual", head="  " + "AB" * 32 + " ").head == "ab" * 32


@pytest.mark.parametrize(
    "bad",
    ["", "abc", "zz" * 32, "ab" * 31, "ab" * 33, "ab" * 32 + "!"],
)
def test_a_malformed_head_is_refused_at_entry(bad: str) -> None:
    """Refused where it is pasted, not where it is used.

    A head with a typo carried further becomes an anchor naming no record in
    the chain, which the verifier reports as replaced_or_rolled_back — the
    most alarming diagnosis this tool produces. Sending someone to investigate
    a replaced log because they mistyped a character is our failure, not
    theirs.
    """
    with pytest.raises(ValidationError):
        AnchorSourceSpec(kind="manual", head=bad)


# --- the store --------------------------------------------------------------


def test_the_empty_profile_exists_and_is_not_a_degraded_mode() -> None:
    """Verifying with no anchor is the honest default.

    It produces "not checked", which is a truthful answer to a question
    nobody asked — so the no-anchor case is a named profile rather than the
    absence of one.
    """
    assert AnchorProfiles().names() == [NO_ANCHOR]


def test_the_empty_profile_cannot_be_redefined_or_deleted() -> None:
    """"Verify without an anchor" has to keep meaning that."""
    profiles = AnchorProfiles()
    with pytest.raises(ValueError):
        profiles.put(NO_ANCHOR, [{"kind": "manual", "head": "ab" * 32}])
    with pytest.raises(ValueError):
        profiles.delete(NO_ANCHOR)


def test_a_profile_can_be_replaced(anchor_profiles: AnchorProfiles) -> None:
    """A user correcting a mistyped path should not have to delete first."""
    anchor_profiles.put("desk", [{"kind": "file", "path": "/wrong"}])
    anchor_profiles.put("desk", [{"kind": "file", "path": "/right"}])
    assert anchor_profiles.get("desk") == [{"kind": "file", "path": "/right"}]


def test_an_unknown_profile_raises(anchor_profiles: AnchorProfiles) -> None:
    with pytest.raises(ProfileNotFound):
        anchor_profiles.get("never-defined")


# --- resolution reports what it tried, not only what worked -----------------


def test_the_first_source_that_answers_wins(chain_path, head_hex) -> None:
    handle = open_chain(chain_path)
    try:
        result = handle.verify(
            [
                {"kind": "file", "path": "/nonexistent/anchor.head"},
                {"kind": "manual", "head": head_hex},
            ]
        )
        assert result["completeness"]["complete_to_anchor"] is True
        assert result["anchor"]["source_kind"] == "manual"
    finally:
        handle.close()


def test_a_skipped_source_is_still_reported(chain_path, head_hex) -> None:
    """The answering source alone would let a UI present it as "the" anchor
    while silently skipping one the operator believed was authoritative."""
    handle = open_chain(chain_path)
    try:
        attempts = handle.verify(
            [
                {"kind": "file", "path": "/nonexistent/anchor.head"},
                {"kind": "manual", "head": head_hex},
            ]
        )["anchor_attempts"]
        assert [(a["source_kind"], a["outcome"]) for a in attempts] == [
            ("file", "absent"),
            ("manual", "answered"),
        ]
    finally:
        handle.close()


def test_absent_and_error_are_different_outcomes(
    chain_path, head_hex, tmp_path
) -> None:
    """Merging them would hide a corrupt anchor file behind "no anchor
    configured" — two situations calling for different actions."""
    corrupt = tmp_path / "corrupt.head"
    corrupt.write_text("this is not a head")

    handle = open_chain(chain_path)
    try:
        attempts = handle.verify(
            [
                {"kind": "file", "path": str(tmp_path / "absent.head")},
                {"kind": "file", "path": str(corrupt)},
                {"kind": "manual", "head": head_hex},
            ]
        )["anchor_attempts"]
        outcomes = [a["outcome"] for a in attempts]
        assert outcomes == ["absent", "error", "answered"]
        assert attempts[1]["error"]
    finally:
        handle.close()


def test_a_file_anchor_can_answer_on_its_own(chain_path, head_hex, tmp_path) -> None:
    anchor_file = tmp_path / "anchor.head"
    anchor_file.write_text(head_hex)

    handle = open_chain(chain_path)
    try:
        result = handle.verify([{"kind": "file", "path": str(anchor_file)}])
        assert result["anchor"]["source_kind"] == "file"
        assert result["completeness"]["complete_to_anchor"] is True
    finally:
        handle.close()


def test_when_nothing_answers_the_question_stays_unasked(chain_path, tmp_path) -> None:
    """L7 again, from the anchor side.

    Every source absent is not "incomplete" — it is "not checked". The
    tri-state has to survive a profile that found nothing just as it survives
    no profile at all.
    """
    handle = open_chain(chain_path)
    try:
        result = handle.verify([{"kind": "file", "path": str(tmp_path / "gone.head")}])
        assert result["completeness"]["complete_to_anchor"] is None
        assert result["anchor"] is None
        assert result["anchor_attempts"][0]["outcome"] == "absent"
    finally:
        handle.close()


def test_an_unknown_source_kind_is_refused(chain_path) -> None:
    handle = open_chain(chain_path)
    try:
        with pytest.raises(UnknownAnchorKind):
            handle.verify([{"kind": "smoke-signal"}])
    finally:
        handle.close()


# --- the rule this whole file exists to protect -----------------------------


def test_a_completeness_claim_never_travels_without_provenance(
    open_client: TestClient, chain_path, head_hex
) -> None:
    """L2, as an assertion rather than a convention.

    If complete_to_anchor says anything at all, the source that said it must
    be in the same payload. A claim about completeness is worth exactly as
    much as the anchor it was checked against.
    """
    _put(open_client, "desk", [{"kind": "manual", "head": head_hex}])
    sid = _open(open_client, chain_path)

    for profile in (NO_ANCHOR, "desk"):
        body = open_client.get(f"/session/{sid}/verify?profile={profile}").json()
        claimed = body["completeness"]["complete_to_anchor"]
        if claimed is None:
            assert body["anchor"] is None
        else:
            assert body["anchor"] is not None
            assert body["anchor"]["head"]


# --- the HTTP surface -------------------------------------------------------


def test_profiles_start_with_only_the_empty_one(open_client: TestClient) -> None:
    assert [p["name"] for p in open_client.get("/anchors/profiles").json()] == [NO_ANCHOR]


def test_the_path_names_the_profile_not_the_body(open_client: TestClient, head_hex) -> None:
    """A profile must not be definable under one name and answer to another."""
    r = open_client.put(
        "/anchors/profiles/desk",
        json={"name": "something-else", "sources": [{"kind": "manual", "head": head_hex}]},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "desk"
    assert "desk" in [p["name"] for p in open_client.get("/anchors/profiles").json()]


def test_redefining_the_empty_profile_is_409(open_client: TestClient) -> None:
    r = open_client.put("/anchors/profiles/none", json={"name": "none", "sources": []})
    assert r.status_code == 409


def test_deleting_the_empty_profile_is_409(open_client: TestClient) -> None:
    assert open_client.delete("/anchors/profiles/none").status_code == 409


def test_deleting_an_unknown_profile_is_404(open_client: TestClient) -> None:
    assert open_client.delete("/anchors/profiles/never-defined").status_code == 404


def test_an_unknown_profile_is_404_not_a_silent_fallback(
    open_client: TestClient, chain_path
) -> None:
    """Falling back to no anchor would answer a question the caller did not
    ask and label it as theirs — and "not checked" looks identical whether it
    was requested or substituted."""
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/verify?profile=typo")
    assert r.status_code == 404
    assert "typo" in r.json()["detail"]


def test_two_profiles_on_one_session_are_two_answers(
    open_client: TestClient, chain_path, head_hex
) -> None:
    """A user who tries the file, finds nothing, then pastes a head by hand
    has asked two questions rather than corrected one."""
    _put(open_client, "empty-file", [{"kind": "file", "path": "/nonexistent.head"}])
    _put(open_client, "pasted", [{"kind": "manual", "head": head_hex}])
    sid = _open(open_client, chain_path)

    first = open_client.get(f"/session/{sid}/verify?profile=empty-file").json()
    second = open_client.get(f"/session/{sid}/verify?profile=pasted").json()

    assert first["completeness"]["complete_to_anchor"] is None
    assert second["completeness"]["complete_to_anchor"] is True


def test_a_malformed_head_is_422_at_the_boundary(open_client: TestClient) -> None:
    r = open_client.put(
        "/anchors/profiles/typo",
        json={"name": "typo", "sources": [{"kind": "manual", "head": "deadbeef"}]},
    )
    assert r.status_code == 422


def test_anchor_routes_require_the_token(gated_client: TestClient, auth, head_hex) -> None:
    body = {"name": "desk", "sources": [{"kind": "manual", "head": head_hex}]}
    assert gated_client.get("/anchors/profiles").status_code == 401
    assert gated_client.put("/anchors/profiles/desk", json=body).status_code == 401
    assert gated_client.put("/anchors/profiles/desk", json=body, headers=auth).status_code == 200


# --- helpers ----------------------------------------------------------------


def _put(client: TestClient, name: str, sources: list[dict]) -> None:
    r = client.put(f"/anchors/profiles/{name}", json={"name": name, "sources": sources})
    assert r.status_code == 200


def _open(client: TestClient, path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


@pytest.fixture
def anchor_profiles() -> AnchorProfiles:
    return AnchorProfiles()


@pytest.fixture
def head_hex(chain_path) -> str:
    """The chain's real head, read through the seam rather than recomputed."""
    handle = open_chain(chain_path)
    try:
        return handle.verify()["chain"]["head"]
    finally:
        handle.close()
