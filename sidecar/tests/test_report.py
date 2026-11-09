# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""D-01 — the package's report, shown and never rebuilt.

`build_report` (channel 2) produces `pala-verification-report/1`, and its
verdict comes from `derive_verdict`, the package's one verdict rule, which a
renderer must not re-derive. These tests hold the sidecar to passing the
report through: the dict is the package's, the text is the package's own
serialisation, and the verdict is copied, not computed.
"""

from __future__ import annotations

import json
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.report import build_report, derive_verdict


def _open(client, path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def test_the_report_is_the_packages_own(open_client, chain_path) -> None:
    sid = _open(open_client, chain_path)
    body = open_client.get(f"/session/{sid}/report").json()
    report = body["report"]
    assert body["format"] == report["format"] == "pala-verification-report/1"
    # The text is the package's serialisation, and parses to the same object.
    assert json.loads(body["json_text"]) == report
    # The verdict is the package's rule applied to the package's report.
    assert body["verdict"] == report["verdict"] == derive_verdict(report)
    assert report["verifier"]["tool"] == "palimpsests-auditor-sidecar"
    assert report["subject"]["sha256"] == body["subject_sha256"]


def test_the_report_is_what_build_report_gives(chain_path) -> None:
    """Apart from `checked_at`, which is when it was built, the report equals
    what `build_report(...)` gives for the same file."""
    handle = open_chain(chain_path)
    try:
        ours = handle.report()
    finally:
        handle.close()
    theirs = build_report(chain_path, tool="palimpsests-auditor-sidecar")
    a, b = json.loads(ours["json"]), json.loads(theirs.to_json_bytes())
    a.pop("checked_at")
    b.pop("checked_at")
    assert a == b
    # And the text is the package's serialisation of exactly the object we
    # return — not a re-serialisation on this side.
    assert json.loads(ours["json"]) == ours["report"]


def test_one_check_one_report(open_client, chain_path) -> None:
    """Built once per profile: asking again returns the same attestation,
    the same `checked_at`, not a second one."""
    sid = _open(open_client, chain_path)
    first = open_client.get(f"/session/{sid}/report").json()
    second = open_client.get(f"/session/{sid}/report").json()
    assert first["json_text"] == second["json_text"]


def test_no_anchor_is_partial_and_says_completeness_was_not_checked(
    open_client, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    report = open_client.get(f"/session/{sid}/report").json()["report"]
    assert report["verdict"] == "partial"
    assert report["completeness"]["complete_to_anchor"] is None


def test_an_anchor_profile_reaches_the_report(open_client, lagging_chain) -> None:
    path, early, _ = lagging_chain
    open_client.put(
        "/anchors/profiles/desk",
        json={"name": "desk", "sources": [{"kind": "manual", "head": early}]},
    )
    sid = _open(open_client, path)
    with_anchor = open_client.get(f"/session/{sid}/report", params={"profile": "desk"}).json()
    without = open_client.get(f"/session/{sid}/report").json()
    assert with_anchor["report"]["anchor"]["head"] == early
    assert with_anchor["report"]["completeness"]["complete_to_anchor"] is not None
    assert without["report"]["anchor"] is None
    # Two profiles, two questions, two reports — neither overwrites the other.
    assert with_anchor["json_text"] != without["json_text"]


def test_a_swapped_body_is_a_violation_in_the_report(open_client, body_swapped_chain) -> None:
    sid = _open(open_client, body_swapped_chain)
    report = open_client.get(f"/session/{sid}/report").json()["report"]
    assert report["container"]["body_digest_mismatches"]
    assert report["verdict"] == "violation"


def test_the_route_refuses_what_verify_refuses(open_client, chain_path) -> None:
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/report", params={"profile": "nope"}).status_code == 404
    assert open_client.get("/session/nope/report").status_code == 404
    open_client.app.state.sessions.detach(sid)
    chain_path.write_bytes(chain_path.read_bytes() + b"\x00")
    assert open_client.get(f"/session/{sid}/report").status_code == 409
