# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-09d — free text over `detail` (§22.3 decided: MVP).

A literal, case-insensitive substring over the package's own `detail`; no
pattern language, so the same query finds the same records on every desk.
A record without detail never matches, and an encrypted body is counted as
not searched rather than silently treated as a non-match.
"""

from __future__ import annotations

import dataclasses
import pytest
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader
from pathlib import Path


@pytest.fixture
def detailed_chain(tmp_path) -> Path:
    path = tmp_path / "detail.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.incident_candidate(1, 2, detail="No frame magic at offset 4096")
    w.incident_candidate(1, 2, detail="sensor timeout")
    w.incident_candidate(1, 2, detail="no FRAME magic again")
    w.prefix_warm(token_count=1)  # an EVENT with no detail
    w.close()
    return path


def _seqs(page):
    return [r["seq"] for r in page["records"]]


def test_matches_a_literal_substring_ignoring_case(detailed_chain) -> None:
    h = open_chain(detailed_chain)
    page = h.records(text="frame magic")
    assert _seqs(page) == [2, 4]
    assert page["total"] == 2
    assert page["unsearched"] == 0
    h.close()


def test_is_not_a_pattern_language(detailed_chain) -> None:
    h = open_chain(detailed_chain)
    assert h.records(text="frame.magic")["total"] == 0
    assert h.records(text="no frame magic*")["total"] == 0
    h.close()


def test_a_record_without_detail_never_matches(detailed_chain) -> None:
    h = open_chain(detailed_chain)
    # An empty-looking needle still needs a detail to be inside.
    assert 5 not in _seqs(h.records(text="o"))
    h.close()


def test_combines_with_the_other_filters(detailed_chain) -> None:
    h = open_chain(detailed_chain)
    assert h.records(text="magic", type_name="SAFETY")["total"] == 2
    assert h.records(text="magic", type_name="EVENT")["total"] == 0
    assert _seqs(h.records(text="magic", offset=3)) == [4]
    h.close()


def test_without_text_unsearched_is_absent(detailed_chain) -> None:
    h = open_chain(detailed_chain)
    assert "unsearched" not in h.records()  # the model fills null
    assert h.records(kind_name="INCIDENT_CANDIDATE")["unsearched"] is None
    h.close()


def test_an_encrypted_body_is_counted_never_silently_skipped(detailed_chain, monkeypatch) -> None:
    """The package's writer does not encrypt, so the encrypted record here is
    the shape the reader gives one — the header names a key, and the fields
    read in place carry no `detail` — swapped in for record 3, which lets the
    count be checked next to other filters. Since C-17 the search reads
    `header_at()` and `record_fields_at()`, so those are what is replaced.
    The real-bytes case runs against the published vectors' ciphertext in
    `test_conformance_vectors.py` (C-15)."""
    header_at = AuditReader.header_at
    fields_at = AuditReader.record_fields_at

    def encrypted_header(self, index):
        header = header_at(self, index)
        if header is not None and header.seq == 3:
            header = dataclasses.replace(header, key_id=7)
        return header

    def no_detail(self, index):
        fields = fields_at(self, index)
        if header_at(self, index).seq == 3:
            fields = dataclasses.replace(fields, detail=None)
        return fields

    monkeypatch.setattr(AuditReader, "header_at", encrypted_header)
    monkeypatch.setattr(AuditReader, "record_fields_at", no_detail)
    h = open_chain(detailed_chain)
    page = h.records(text="sensor")
    assert page["total"] == 0
    assert page["unsearched"] == 1
    # Another filter that excludes the encrypted record excludes it from the count too.
    assert h.records(text="sensor", type_name="EVENT")["unsearched"] == 0
    h.close()


def test_the_route_validates_and_carries_unsearched(open_client, detailed_chain) -> None:
    sid = open_client.post("/session", json={"path": str(detailed_chain)}).json()["session_id"]
    ok = open_client.get(f"/session/{sid}/records", params={"text": "Magic"}).json()
    assert [r["seq"] for r in ok["records"]] == [2, 4]
    assert ok["unsearched"] == 0
    assert open_client.get(f"/session/{sid}/records").json()["unsearched"] is None
    assert open_client.get(f"/session/{sid}/records", params={"text": ""}).status_code == 422
    assert open_client.get(f"/session/{sid}/records", params={"text": "x" * 201}).status_code == 422
