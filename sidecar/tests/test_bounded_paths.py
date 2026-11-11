# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-10b(b) — the browse paths never decode the whole chain.

Before 0.13 every structural answer went through ``AuditReader.records()``,
which decodes every record: opening a 1M-record session cost 21.6 s and
2.0 GB before the first answer (``scripts/bench_seam.py``). Since then the
seam reads headers through ``header_at()`` into one index, decodes only the
records it returns, and asks the package's own bounded questions
(``record_count``, ``safety_records()``, ``acknowledged_candidates()``,
``shredded_targets()``, ``origin_state_at()``).

These tests make that a property rather than a measurement: the reader's
``records()`` is replaced with one that fails, and every browse path must
still answer. Since C-17 (0.14) that includes the filters on a record's
body — kind, source mark, outcome and detail are read in place through
``record_fields_at()``, and a record's own hash through ``record_at()``,
one record at a time — so there is no exception left. Equivalence with the
full-decode answers is held by ``test_body_filter_equivalence.py``.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader
from pathlib import Path


class FullDecode(AssertionError):
    pass


@pytest.fixture
def no_full_decode(monkeypatch):
    def refuse(self):
        raise FullDecode("records() decodes the whole chain")
        yield  # pragma: no cover - makes this a generator like the original

    monkeypatch.setattr(AuditReader, "records", refuse)


@pytest.fixture
def busy_chain(tmp_path) -> Path:
    path = tmp_path / "busy.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    for i in range(20):
        call = w.tool_call("tool", args_digest=bytes([i]) * 32)
        w.tool_result(w.seq - 1, call, i % 5, result_digest=b"\x02" * 32)
    cand_seq = w.seq
    cand = w.incident_candidate(1, 2, detail="guard refusals exceeded")
    w.oversight_ack(cand_seq, cand, 0, b"\x07" * 16)
    w.anchor()
    w.close()
    return path


def test_opening_a_session_decodes_nothing(busy_chain, no_full_decode) -> None:
    open_chain(busy_chain).close()


def test_every_browse_path_answers_without_the_full_decode(busy_chain, no_full_decode) -> None:
    h = open_chain(busy_chain)
    subject = h.subject()
    assert subject["records"] == 46
    first, last = subject["first_seq"], subject["last_seq"]
    assert h.record(first)["prev_seq"] is None
    assert h.record(last)["prev_seq"] == last - 1
    assert h.records(offset=0, limit=5)["total"] == 46
    assert h.records(type_name="SAFETY")["total"] == 2
    assert h.records(boot_id=h.record(first)["boot_id"], tier="A")["total"] >= 0
    assert h.safety()["total"] == 2
    assert h.timeline(axis="seq", buckets=7)["buckets"]
    assert h.timeline(axis="wall", buckets=2000, align="day")["buckets"]
    # On a coarse clock (Windows) several records share one wall time; the
    # nearest-instant rule then picks the lowest seq among them, by design.
    target = h.record(last)["wall_clock_ns"]
    found = h.nearest(target)
    assert found["delta_ns"] == 0
    same_wall = [r["seq"] for r in h.records(limit=100)["records"] if r["wall_clock_ns"] == target]
    assert found["seq"] == min(same_wall)
    assert found["equally_near"] == len(same_wall) - 1
    assert h.origin(last)["state"] == "active"
    h.boots()
    h.spans()
    h.close()


def test_the_ack_latency_still_reads_both_records(busy_chain, no_full_decode) -> None:
    h = open_chain(busy_chain)
    candidates = [r for r in h.safety()["records"] if r["acknowledged"]]
    assert candidates and candidates[0]["ack_latency_ns"] is not None
    h.close()


@pytest.mark.parametrize(
    "body_filter",
    [
        {"kind_name": "TOOL_RESULT"},
        {"source_name": "parsed-from-wire"},
        {"outcome_name": "unobserved"},
        {"text": "guard refusals"},
    ],
)
def test_a_question_about_bodies_no_longer_decodes_the_chain(
    busy_chain, body_filter, no_full_decode
) -> None:
    """A kind, a source mark, an outcome, a detail is not in the header;
    0.14's ``record_fields_at()`` reads it in place (C-17)."""
    h = open_chain(busy_chain)
    assert h.records(**body_filter)["total"] > 0
    h.close()


def test_a_body_question_still_honours_every_header_filter_beside_it(
    busy_chain, no_full_decode
) -> None:
    """The body path keeps applying the header filters too."""
    h = open_chain(busy_chain)
    first = h.record(h.subject()["first_seq"])
    walls = [r["wall_clock_ns"] for r in h.records(limit=100)["records"]]
    both = h.records(
        kind_name="TOOL_RESULT",
        type_name="EVENT",
        boot_id=first["boot_id"],
        tier=first["assurance_tier"]["name"],
        wall_from_ns=min(walls),
        wall_to_ns=max(walls) + 1,
    )
    assert both["total"] == 20
    assert h.records(kind_name="TOOL_RESULT", record_type=999)["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", type_name="SAFETY")["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", boot_id="00" * 16)["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", span_id="ff" * 16)["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", tier="B+")["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", wall_from_ns=max(walls) + 1)["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", wall_to_ns=min(walls))["total"] == 0
    assert h.records(kind_name="TOOL_RESULT", offset=10**9)["records"] == []
    h.close()


def test_a_record_found_by_its_own_hash_still_resolves(busy_chain, no_full_decode) -> None:
    h = open_chain(busy_chain)
    last = h.subject()["last_seq"]
    target = h.record(last)["record_hash"]
    assert [r["seq"] for r in h.records(record_hash=target)["records"]] == [last]
    h.close()


def test_out_of_order_records_keep_the_walk_and_stop_answer(tmp_path) -> None:
    """With seqs out of file order, `record(seq)` answers as the full walk
    did: the first record at or past the seq asked for, or nothing."""
    src = tmp_path / "src.pala"
    w = PalaWriter(src)
    w.genesis()
    w.boot()
    for _ in range(4):
        w.prefix_warm(token_count=1)
    w.close()
    # Whole records, cut where the package's own headers say they end.
    data = src.read_bytes()
    reader = AuditReader.open(src)
    lengths = [
        len(reader.header_at(i).encode()) + reader.header_at(i).body_len
        for i in range(reader.record_count)
    ]
    reader.close()
    records, at = [], 0
    for n in lengths:
        records.append(data[at : at + n])
        at += n
    swapped = tmp_path / "swapped.pala"
    swapped.write_bytes(b"".join(records[:2] + [records[3], records[2]] + records[4:]))

    h = open_chain(swapped)
    assert h.record(3)["seq"] == 3
    assert h.record(2) is None  # record 3 comes first in the file and overshoots
    assert h.record(4)["prev_seq"] == 2  # the record before it in the file
    # Boot boundaries look records up by seq; out of order, that is a search.
    assert h.timeline(axis="seq", buckets=3)["boot_boundaries"]
    assert h.timeline(axis="wall", buckets=3)["wall_follows_seq"] in (True, False)
    h.close()
