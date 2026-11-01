# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-13a — what palimpsests 0.13 says about segments, carried through the seam.

Two things a 0.13 verdict can rest on that 0.12 never showed: a
SEGMENT_CONTINUATION record declaring where its segment begins, and the
segments manifest beside the file that the continuation diagnosis is decided
against (U17). The record's declaration is passed through as the package
decodes it; the manifest is named, fingerprinted, and held to the same
"still the same bytes" test as the container — a verdict that read a second
file is about two files.
"""

from __future__ import annotations

import json
import os
from auditor_sidecar.digest import file_sha256
from fastapi.testclient import TestClient
from palimpsests.audit.pala_writer import PalaWriter, RotationPolicy
from pathlib import Path

RETENTION_S = 15_552_000


def _survivor(tmp_path: Path) -> Path:
    """The last segment of a rotated chain, every earlier one removed and the
    manifest left beside it."""
    base = tmp_path / "w.pala"
    w = PalaWriter(base, rotation=RotationPolicy(max_records=4, retention_s=RETENTION_S))
    w.genesis()
    for _ in range(13):
        w.prefix_warm(token_count=1)
    w.close()
    segments = [base] + sorted(tmp_path.glob("w.pala.0*"))
    for old in segments[:-1]:
        os.remove(old)
    return segments[-1]


def _manifest(tmp_path: Path) -> Path:
    return tmp_path / "w.pala.segments.json"


def _open(client: TestClient, path: Path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def _verify(client: TestClient, sid: str):
    return client.get(f"/session/{sid}/verify")


# --- the manifest a verdict rests on ----------------------------------------------


def test_a_survivor_segment_names_the_manifest_it_was_judged_against(
    open_client: TestClient, tmp_path: Path
) -> None:
    seg = _survivor(tmp_path)
    body = _verify(open_client, _open(open_client, seg)).json()
    assert body["diagnosis"]["pattern"] == "declared_continuation"
    assert body["manifest"] == {
        "path": str(_manifest(tmp_path)),
        "status": "matches",
        "sha256": file_sha256(_manifest(tmp_path)),
        "detail": None,
    }


def test_a_whole_chain_rests_on_no_second_file(open_client: TestClient, chain_path) -> None:
    body = _verify(open_client, _open(open_client, chain_path)).json()
    assert body["manifest"] is None


def test_a_contradicting_manifest_is_named_with_its_own_digest(
    open_client: TestClient, tmp_path: Path
) -> None:
    seg = _survivor(tmp_path)
    mf = json.loads(_manifest(tmp_path).read_text())
    mf["segments"][-1]["head"] = "ab" * 32
    _manifest(tmp_path).write_text(json.dumps(mf))
    body = _verify(open_client, _open(open_client, seg)).json()
    assert body["diagnosis"]["pattern"] == "continuation_contradicts_manifest"
    assert body["manifest"]["status"] == "contradicts"
    assert body["manifest"]["sha256"] == file_sha256(_manifest(tmp_path))


# --- held to the same test as the container ---------------------------------------


def test_an_edited_manifest_refuses_the_session_like_an_edited_file(
    open_client: TestClient, tmp_path: Path
) -> None:
    seg = _survivor(tmp_path)
    sid = _open(open_client, seg)
    assert _verify(open_client, sid).status_code == 200
    _manifest(tmp_path).write_text(_manifest(tmp_path).read_text() + " ")
    refused = _verify(open_client, sid)
    assert refused.status_code == 409
    assert "segments manifest" in refused.json()["detail"]
    assert open_client.get(f"/session/{sid}/records").status_code == 409


def test_a_removed_manifest_refuses_the_session(open_client: TestClient, tmp_path: Path) -> None:
    seg = _survivor(tmp_path)
    sid = _open(open_client, seg)
    assert _verify(open_client, sid).status_code == 200
    _manifest(tmp_path).unlink()
    assert _verify(open_client, sid).status_code == 409


def test_a_manifest_that_appears_after_the_verdict_refuses_the_session(
    open_client: TestClient, tmp_path: Path
) -> None:
    """Absent when judged is a fact too: its arriving would change the
    diagnosis (declared_only -> matches or contradicts)."""
    seg = _survivor(tmp_path)
    saved = _manifest(tmp_path).read_bytes()
    _manifest(tmp_path).unlink()
    sid = _open(open_client, seg)
    body = _verify(open_client, sid).json()
    assert body["manifest"]["status"] == "declared_only"
    assert body["manifest"]["sha256"] is None
    _manifest(tmp_path).write_bytes(saved)
    assert _verify(open_client, sid).status_code == 409


def test_an_untouched_manifest_keeps_the_session_answering(
    open_client: TestClient, tmp_path: Path
) -> None:
    seg = _survivor(tmp_path)
    sid = _open(open_client, seg)
    first = _verify(open_client, sid).json()
    assert _verify(open_client, sid).json() == first
    assert open_client.get(f"/session/{sid}/records").status_code == 200


# --- what a SEGMENT_CONTINUATION declares --------------------------------------------


def test_the_continuation_record_carries_its_declaration(
    open_client: TestClient, tmp_path: Path
) -> None:
    seg = _survivor(tmp_path)
    sid = _open(open_client, seg)
    rows = open_client.get(f"/session/{sid}/records").json()["records"]
    first, rest = rows[0], rows[1:]
    assert first["kind_name"] == "SEGMENT_CONTINUATION"
    declared = first["continuation"]
    assert declared["retention_s"] == RETENTION_S
    assert declared["segment_index"] >= 1
    assert declared["predecessor_head"] == first["prev_hash"]
    assert len(declared["prior_root"]) == 64
    assert all(r["continuation"] is None for r in rest)


def test_the_single_record_view_carries_it_too(open_client: TestClient, tmp_path: Path) -> None:
    seg = _survivor(tmp_path)
    sid = _open(open_client, seg)
    first = open_client.get(f"/session/{sid}/records").json()["records"][0]
    one = open_client.get(f"/session/{sid}/record/{first['seq']}").json()
    assert one["continuation"] == first["continuation"]


def test_records_outside_a_rotated_chain_declare_nothing(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    rows = open_client.get(f"/session/{sid}/records").json()["records"]
    assert rows and all(r["continuation"] is None for r in rows)
