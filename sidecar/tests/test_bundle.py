# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The evidence bundle (E-01): the package's, for a bounded selection.

Every member is `assemble_bundle`'s; the route only carries the tar out and
says, in headers, what the package said about it. Held to the package's own
assembly of the same selection, byte for byte.
"""

from __future__ import annotations

import io
import json
import pytest
import tarfile
from auditor_sidecar import pala_seam
from fastapi.testclient import TestClient
from palimpsests.audit.pala.bundle import BUNDLE_FORMAT, assemble_bundle
from pathlib import Path


def _open(client: TestClient, path: Path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def test_the_bundle_is_the_package_s_byte_for_byte(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/bundle", params={"from_seq": 1, "to_seq": 3})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/x-tar"
    assert int(r.headers["content-length"]) == len(r.content)
    theirs = assemble_bundle(chain_path, tmp_path / "theirs.tar", from_seq=1, to_seq=3)
    assert r.content == Path(theirs.path).read_bytes()
    assert r.headers["x-bundle-format"] == BUNDLE_FORMAT
    assert int(r.headers["x-bundle-records"]) == theirs.records == 3
    assert int(r.headers["x-bundle-proven"]) == theirs.proven
    assert r.headers["x-bundle-head"] == theirs.head
    assert r.headers["x-bundle-consistent"] == ("true" if theirs.consistent else "false")
    assert (r.headers["x-bundle-from-seq"], r.headers["x-bundle-to-seq"]) == ("1", "3")
    names = tarfile.open(fileobj=io.BytesIO(r.content)).getnames()
    assert any(n.endswith("verification.json") for n in names)


def test_a_damaged_chain_bundles_and_says_so(
    open_client: TestClient, body_swapped_chain: Path
) -> None:
    sid = _open(open_client, body_swapped_chain)
    r = open_client.get(f"/session/{sid}/bundle")
    assert r.status_code == 200
    assert r.headers["x-bundle-consistent"] == "false"
    with tarfile.open(fileobj=io.BytesIO(r.content)) as tar:
        member = next(m for m in tar.getmembers() if m.name.endswith("verification.json"))
        assert json.load(tar.extractfile(member))["consistent"] is False


def test_the_selection_is_bounded(
    open_client: TestClient, chain_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pala_seam, "MAX_BUNDLE_RECORDS", 2)
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/bundle", params={"from_seq": 0, "to_seq": 2})
    assert r.status_code == 422
    assert "at most 2 records" in r.json()["detail"]
    assert open_client.get(
        f"/session/{sid}/bundle", params={"from_seq": 0, "to_seq": 1}
    ).status_code == 200


@pytest.mark.parametrize("params", [{"from_seq": 3, "to_seq": 1}])
def test_a_backwards_range_is_refused(open_client, chain_path, params) -> None:
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/bundle", params=params)
    assert r.status_code == 422 and "after its end" in r.json()["detail"]


def test_an_empty_file_has_nothing_to_bundle(open_client: TestClient, tmp_path: Path) -> None:
    empty = tmp_path / "empty.pala"
    empty.write_bytes(b"")
    r = open_client.get(f"/session/{_open(open_client, empty)}/bundle")
    assert r.status_code == 422 and "no records" in r.json()["detail"]


def test_nothing_is_left_behind(
    open_client: TestClient, chain_path: Path, tmp_path: Path, monkeypatch
) -> None:
    """The tar is written in a directory of the sidecar's own and removed
    once sent, refused or not."""
    import tempfile

    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    sid = _open(open_client, chain_path)
    open_client.get(f"/session/{sid}/bundle")
    open_client.get(f"/session/{sid}/bundle", params={"from_seq": 5, "to_seq": 1})
    assert list(tmp_path.glob("auditor-bundle-*")) == []


def test_the_route_needs_the_token(gated_client: TestClient) -> None:
    assert gated_client.get("/session/x/bundle").status_code == 401


def test_a_range_outside_the_file_is_refused(open_client: TestClient, chain_path: Path) -> None:
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/bundle", params={"from_seq": 9_000, "to_seq": 9_001})
    assert r.status_code == 422 and "outside this file" in r.json()["detail"]
