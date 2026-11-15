# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""A record's bytes as the file holds them, and the package's maps of them (C-06d).

The bytes view is the one place the screen shows wire bytes, so the one
place a shell is tempted to read them. Every test here holds the view to an
authority that is not this repository: the published vectors' own
`header_hex` / `body_hex`, and the package's own maps, compared whole.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from palimpsests.audit.pala import vectors
from palimpsests.audit.reader import HEADER_FIELDS, AuditReader
from pathlib import Path


def _open(client: TestClient, path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def _published(tmp_path: Path, vector_set: str) -> tuple[Path, list[dict]]:
    records = vectors.load(vector_set)["records"]
    data = b"".join(
        bytes.fromhex(r["header_hex"]) + bytes.fromhex(r.get("body_hex", "")) for r in records
    )
    path = tmp_path / f"{vector_set}.pala"
    path.write_bytes(data)
    return path, records


def test_the_bytes_are_the_published_bytes(open_client: TestClient, tmp_path: Path) -> None:
    """Every record of both vector sets comes back exactly as published —
    header and body, ciphertext included."""
    for vector_set in ("core", "inference"):
        path, published = _published(tmp_path, vector_set)
        sid = _open(open_client, path)
        records = open_client.get(f"/session/{sid}/records?limit=100").json()["records"]
        assert len(records) == len(published)
        offset = 0
        for row, pub in zip(records, published, strict=True):
            view = open_client.get(f"/session/{sid}/record/{row['seq']}/bytes").json()
            assert view["header_hex"] == pub["header_hex"]
            body = pub.get("body_hex", "")
            assert view["body_hex"] == body
            assert view["body_len"] == view["body_shown"] == len(body) // 2
            assert view["offset"] == offset
            assert view["index"] == row["index"]
            offset += len(pub["header_hex"]) // 2 + len(body) // 2


def test_the_maps_are_the_package_s(open_client: TestClient, tmp_path: Path) -> None:
    path, _ = _published(tmp_path, "inference")
    sid = _open(open_client, path)
    reader = AuditReader.open(path)
    rows = open_client.get(f"/session/{sid}/records?limit=100").json()["records"]
    saw_body_tlvs = saw_no_body_tlvs = False
    for row in rows:
        view = open_client.get(f"/session/{sid}/record/{row['seq']}/bytes").json()
        i = row["index"]
        assert view["header_fields"] == [
            {"name": f.name, "offset": f.offset, "length": f.length} for f in HEADER_FIELDS
        ]
        assert [tuple(t.values()) for t in view["header_tlvs"]] == reader.header_tlv_spans_at(i)
        body = reader.body_tlv_spans_at(i)
        if body is None:
            assert view["body_tlvs"] is None
            saw_no_body_tlvs = True
        else:
            assert [tuple(t.values()) for t in view["body_tlvs"]] == body
            saw_body_tlvs = True
    assert saw_body_tlvs and saw_no_body_tlvs


def test_an_encrypted_body_has_bytes_and_no_layout(open_client: TestClient, tmp_path: Path) -> None:
    path, _ = _published(tmp_path, "core")
    sid = _open(open_client, path)
    rows = open_client.get(f"/session/{sid}/records?limit=100").json()["records"]
    encrypted = [r for r in rows if r["key_id"] is not None]
    assert encrypted
    for row in encrypted:
        view = open_client.get(f"/session/{sid}/record/{row['seq']}/bytes").json()
        assert view["body_len"] > 0
        assert view["body_hex"]
        assert view["body_tlvs"] is None
        assert view["header_fields"] is not None


def test_a_long_body_is_cut_and_says_so(
    open_client: TestClient, chain_path: Path, monkeypatch
) -> None:
    """Past the limit the body is cut, and the view says how much was sent.

    The writer caps its own detail strings well below the real limit, so the
    limit is lowered here instead of a body being built by hand.
    """
    import auditor_sidecar.pala_seam as seam

    monkeypatch.setattr(seam, "_BODY_BYTES_SHOWN", 16)
    sid = _open(open_client, chain_path)
    view = open_client.get(f"/session/{sid}/record/3/bytes").json()
    assert view["body_len"] > 16
    assert view["body_shown"] == 16
    assert len(view["body_hex"]) == 2 * 16
    # The layout is the whole body's, so a span may lie past what was sent.
    end_shown = len(view["header_hex"]) // 2 + 16
    assert any(t["value_offset"] + t["length"] > end_shown for t in view["body_tlvs"])


def test_a_header_the_package_does_not_accept_is_shown_unnamed(
    open_client: TestClient, chain_path: Path
) -> None:
    """An unknown format version: the bytes as stored, no field named."""
    version = next(f for f in HEADER_FIELDS if f.name == "format_version")
    data = bytearray(chain_path.read_bytes())
    second = data.index(b"PALA", 4)
    data[second + version.offset : second + version.offset + version.length] = b"\xfe\xff"
    chain_path.write_bytes(bytes(data))
    sid = _open(open_client, chain_path)
    view = open_client.get(f"/session/{sid}/record/1/bytes").json()
    assert view["header_fields"] is None
    assert view["header_tlvs"] is None
    assert view["body_tlvs"] is None
    stored = bytes.fromhex(view["header_hex"])
    assert stored == bytes(data[second : second + len(stored)])


def test_no_such_record_is_a_404_naming_the_record(
    open_client: TestClient, chain_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/record/99/bytes")
    assert r.status_code == 404
    assert "no record 99" in r.json()["detail"]
