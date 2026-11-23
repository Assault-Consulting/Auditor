# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""A segmented chain verified as a set (§22.1, U18).

The two answers the package keeps apart stay apart here: a segment deleted
under retention makes a set incomplete, never inconsistent; a segment
altered after writing makes it inconsistent. Every answer is held to the
package's own `verify_segment_set` on the same manifest.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from palimpsests.audit.pala.segments import segment_chain
from palimpsests.audit.segment_set import verify_segment_set
from pathlib import Path


@pytest.fixture
def segmented(tmp_path: Path, chain_path: Path) -> Path:
    """The shared fixture chain cut into segments of two records, with its
    `segments.json`, in a folder of its own."""
    out = tmp_path / "segments"
    result = segment_chain(chain_path, out, records_per_segment=2)
    return Path(result.manifest_path)


def _check(client: TestClient, manifest: Path) -> dict:
    r = client.post("/segment-set", json={"path": str(manifest)})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_whole_set_is_consistent_and_complete(open_client: TestClient, segmented: Path) -> None:
    body = _check(open_client, segmented)
    package = verify_segment_set(segmented)
    assert body["consistent"] is package.consistent is True
    assert body["complete"] is package.complete is True
    assert body["head"] == package.head.hex()
    assert body["manifest_sha256"] == package.manifest_sha256.hex()
    assert body["absent"] == []
    assert [s["file"] for s in body["segments"]] == [c.file for c in package.segments]
    for s in body["segments"]:
        assert s["present"] and s["verified"] and s["seam_ok"] and s["head_matches"]
        assert s["path"] == str(segmented.parent / s["file"])


def test_a_segment_gone_makes_it_incomplete_not_inconsistent(
    open_client: TestClient, segmented: Path
) -> None:
    first = sorted(segmented.parent.glob("*.pala"))[0]
    first.unlink()
    body = _check(open_client, segmented)
    assert body["consistent"] is True
    assert body["complete"] is False
    assert body["absent"] == [first.name]
    gone = next(s for s in body["segments"] if s["file"] == first.name)
    assert gone["present"] is False and gone["verified"] is None and gone["path"] is None
    # What the manifest declared it held is all that is left of it (R16).
    entry = next(c for c in verify_segment_set(segmented).segments if c.file == first.name)
    assert gone["declared_first_seq"] == entry.declared_first_seq == 0
    assert gone["declared_last_seq"] == entry.declared_last_seq
    assert gone["declared_head"] == entry.declared_head.hex()


def test_a_segment_altered_makes_it_inconsistent(
    open_client: TestClient, segmented: Path
) -> None:
    second = sorted(segmented.parent.glob("*.pala"))[1]
    data = bytearray(second.read_bytes())
    data[-1] ^= 0x01  # the last byte of the last body
    second.write_bytes(bytes(data))
    body = _check(open_client, segmented)
    assert body["consistent"] is False and body["complete"] is False
    bad = next(s for s in body["segments"] if s["file"] == second.name)
    assert bad["verified"] is False
    assert body == _check(open_client, segmented)  # stateless: the same files, the same answer


def test_a_file_that_is_not_a_manifest_is_refused_with_the_reason(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    r = open_client.post("/segment-set", json={"path": str(chain_path)})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("not a segment set:")
    other = tmp_path / "other.json"
    other.write_text('{"format": "something-else"}', encoding="utf-8")
    assert "not a segment set" in open_client.post(
        "/segment-set", json={"path": str(other)}
    ).json()["detail"]


def test_a_manifest_that_cannot_be_read_says_so(open_client: TestClient, tmp_path: Path) -> None:
    r = open_client.post("/segment-set", json={"path": str(tmp_path / "absent.segments.json")})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("the manifest could not be read")


def test_a_segment_opens_as_its_own_chain(open_client: TestClient, segmented: Path) -> None:
    """Browsing is per segment: the path the set gives opens as a session."""
    body = _check(open_client, segmented)
    path = body["segments"][1]["path"]
    r = open_client.post("/session", json={"path": path})
    assert r.status_code == 201


def test_the_route_needs_the_token(gated_client: TestClient, segmented: Path) -> None:
    assert gated_client.post("/segment-set", json={"path": str(segmented)}).status_code == 401
