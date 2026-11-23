# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Prefix consistency (E-07): the package's proof, and a held proof checked.

The proof is `consistency_proof`'s; the check keeps three answers apart —
the path connects the document's roots; this chain's prefix root is the
document's first root; and its root at the longer count is the second.
"""

from __future__ import annotations

import json
from fastapi.testclient import TestClient
from palimpsests.audit.pala.proofs import ConsistencyProof, consistency_proof
from palimpsests.audit.reader import AuditReader
from pathlib import Path
from writers import fixed_reopen


def _open(client: TestClient, path: Path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def test_the_proof_is_the_package_s(open_client: TestClient, chain_path: Path) -> None:
    sid = _open(open_client, chain_path)
    body = open_client.get(f"/session/{sid}/consistency", params={"first": 2}).json()
    theirs = consistency_proof(AuditReader.open(chain_path), 2)
    assert body["proof"] == theirs.to_json()
    assert body["verifies"] is True
    assert body["records_here"] == theirs.second
    assert ConsistencyProof.from_json(body["proof"]).verify()


def test_counts_out_of_range_are_refused(open_client: TestClient, chain_path: Path) -> None:
    sid = _open(open_client, chain_path)
    for params in ({"first": 0}, {"first": 3, "second": 2}, {"first": 1, "second": 10_000}):
        r = open_client.get(f"/session/{sid}/consistency", params=params)
        assert r.status_code == 422, params


def test_a_prefix_archived_earlier_is_intact_under_the_grown_chain(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    """Take a proof now, let the chain grow, check the proof against the
    grown chain: its first root is still this chain's prefix root."""
    n = AuditReader.open(chain_path).record_count
    grown = tmp_path / "grown.pala"
    grown.write_bytes(chain_path.read_bytes())
    proof = consistency_proof(AuditReader.open(grown), 2, n)
    held = tmp_path / "proof.json"
    held.write_text(json.dumps(proof.to_json()), encoding="utf-8")
    w = fixed_reopen(grown)
    w.boot()
    w.close()

    sid = _open(open_client, grown)
    body = open_client.post(f"/session/{sid}/consistency/check", json={"path": str(held)}).json()
    assert body["path_verifies"] is True
    assert body["first_root_matches"] is True and body["second_root_matches"] is True
    assert body["records_here"] > n


def test_a_proof_of_another_chain_does_not_match_here(
    open_client: TestClient, chain_path: Path, two_boot_chain: Path, tmp_path: Path
) -> None:
    proof = consistency_proof(AuditReader.open(two_boot_chain), 1, 2)
    held = tmp_path / "other.json"
    held.write_text(json.dumps(proof.to_json()), encoding="utf-8")
    sid = _open(open_client, chain_path)
    body = open_client.post(f"/session/{sid}/consistency/check", json={"path": str(held)}).json()
    assert body["path_verifies"] is True  # it is a sound proof — of something else
    assert body["first_root_matches"] is False


def test_a_proof_longer_than_this_chain_says_it_cannot_tell(
    open_client: TestClient, chain_path: Path, two_boot_chain: Path, tmp_path: Path
) -> None:
    r2 = AuditReader.open(two_boot_chain)
    proof = consistency_proof(r2, 1, r2.record_count)
    held = tmp_path / "long.json"
    held.write_text(json.dumps(proof.to_json()), encoding="utf-8")
    short = tmp_path / "short.pala"
    short.write_bytes(b"")
    sid = _open(open_client, short)
    body = open_client.post(f"/session/{sid}/consistency/check", json={"path": str(held)}).json()
    assert body["first_root_matches"] is None and body["second_root_matches"] is None


def test_a_file_that_is_not_a_proof_is_refused(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    bad = tmp_path / "bad.json"
    bad.write_text('{"format": "pala-consistency-proof/1", "first": 2.7}', encoding="utf-8")
    r = open_client.post(f"/session/{sid}/consistency/check", json={"path": str(bad)})
    assert r.status_code == 422 and r.json()["detail"].startswith("not a consistency proof")
    r = open_client.post(
        f"/session/{sid}/consistency/check", json={"path": str(tmp_path / "absent.json")}
    )
    assert r.status_code == 422 and r.json()["detail"].startswith("the proof could not be read")
