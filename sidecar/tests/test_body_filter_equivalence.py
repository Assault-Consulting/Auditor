# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-17 — the body filters answer as the full decode did.

Before 0.14 every filter on a record's body (kind, source mark, outcome,
detail text, a record's own hash) walked ``AuditReader.records()``, the whole
chain decoded. Since C-17 the seam reads those fields in place through
``record_fields_at()`` and decodes only the rows it returns. This file keeps
the old walk as an oracle, written out here from the pre-C-17 seam, and holds
the new path to it over a grid of filters on chains that include the
published vectors — the only real ciphertext this repository has — and a
chain whose records are out of seq order.

What is compared is the whole answer: every row as the seam renders it,
``total``, ``has_more`` and ``unsearched``.
"""

from __future__ import annotations

import itertools
import pytest
from auditor_sidecar.pala_seam import _span_or_none, open_chain
from palimpsests.audit.names import assurance_tier_name
from palimpsests.audit.pala import vectors
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader
from pathlib import Path


def _oracle(handle, offset, limit, f) -> dict:
    """The pre-C-17 `_records_by_body`, over the full decode."""
    acks, shredded, counts = handle._safety_context()
    records = list(handle._reader.records())
    needle = None if f.get("text") is None else f["text"].casefold()
    window, matched, past, unsearched = [], 0, 0, 0
    for r in records:
        h = r.header
        if f.get("type_name") is not None and r.type_name != f["type_name"]:
            continue
        if f.get("boot_id") is not None and h.boot_id.hex() != f["boot_id"]:
            continue
        if f.get("span_id") is not None and _span_or_none(h.span_id) != f["span_id"]:
            continue
        if f.get("tier") is not None and assurance_tier_name(h.assurance_tier) != f["tier"]:
            continue
        if f.get("kind_name") is not None and r.kind_name != f["kind_name"]:
            continue
        if f.get("source_name") is not None and r.source_name != f["source_name"]:
            continue
        if f.get("outcome_name") is not None and r.outcome_name != f["outcome_name"]:
            continue
        if f.get("record_hash") is not None and r.record_hash.hex() != f["record_hash"]:
            continue
        if needle is not None:
            if h.key_id != 0:
                unsearched += 1
                continue
            if r.detail is None or needle not in r.detail.casefold():
                continue
        matched += 1
        if r.seq < offset:
            continue
        past += 1
        if len(window) < limit:
            prev = records[r.index - 1].seq if r.index > 0 else None
            window.append(handle._record_view(r, prev, acks, shredded, counts))
    return {
        "records": window,
        "offset": offset,
        "limit": limit,
        "total": matched,
        "has_more": past > len(window),
        "unsearched": None if needle is None else unsearched,
    }


def _vector_chain(tmp_path: Path, name: str) -> Path:
    path = tmp_path / f"{name}.pala"
    path.write_bytes(
        b"".join(
            bytes.fromhex(r["header_hex"]) + bytes.fromhex(r.get("body_hex", ""))
            for r in vectors.load(name)["records"]
        )
    )
    return path


def _busy_chain(tmp_path: Path) -> Path:
    path = tmp_path / "busy.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    for i in range(12):
        call = w.tool_call("tool", args_digest=bytes([i]) * 32)
        w.tool_result(w.seq - 1, call, i % 5, result_digest=b"\x02" * 32)
    for text in ("Frame magic mismatch", "frame MAGIC again", "sensor drift"):
        w.incident_candidate(1, 2, detail=text)
    w.anchor()
    w.close()
    return path


def _out_of_order_chain(tmp_path: Path) -> Path:
    src = _busy_chain(tmp_path)
    data = src.read_bytes()
    reader = AuditReader.open(src)
    lengths = [
        len(reader.header_at(i).encode()) + reader.header_at(i).body_len
        for i in range(reader.record_count)
    ]
    reader.close()
    parts, at = [], 0
    for n in lengths:
        parts.append(data[at : at + n])
        at += n
    swapped = tmp_path / "swapped.pala"
    swapped.write_bytes(b"".join(parts[:3] + [parts[4], parts[3]] + parts[5:]))
    return swapped


def _grid(handle) -> list[dict]:
    """Filters drawn from what the chain holds, plus values it does not."""
    recs = list(handle._reader.records())
    kinds = sorted({r.kind_name for r in recs if r.kind_name}) + ["NO_SUCH_KIND"]
    sources = sorted({r.source_name for r in recs if r.source_name}) + ["no-such-source"]
    outcomes = sorted({r.outcome_name for r in recs if r.outcome_name}) + ["no-such-outcome"]
    details = sorted({r.detail for r in recs if r.detail})
    texts = [d[:5] for d in details] + [d[-4:].upper() for d in details] + ["zzz-none"]
    hashes = [recs[i].record_hash.hex() for i in (0, len(recs) // 2, -1)] + ["00" * 32]
    types = sorted({r.type_name for r in recs if r.type_name})
    boot = recs[-1].header.boot_id.hex()
    body = (
        [{"kind_name": k} for k in kinds]
        + [{"source_name": s} for s in sources]
        + [{"outcome_name": o} for o in outcomes]
        + [{"text": t} for t in texts]
        + [{"record_hash": h} for h in hashes]
        + [{"kind_name": kinds[0], "text": texts[0]}]
    )
    header = [{}, {"type_name": types[0]}, {"type_name": types[-1]}, {"boot_id": boot}]
    return [{**b, **h} for b, h in itertools.product(body, header)]


@pytest.mark.parametrize("make", ["busy", "core", "inference", "out_of_order"])
def test_every_body_filter_answers_as_the_full_decode_did(tmp_path: Path, make: str) -> None:
    path = {
        "busy": lambda: _busy_chain(tmp_path),
        "core": lambda: _vector_chain(tmp_path, "core"),
        "inference": lambda: _vector_chain(tmp_path, "inference"),
        "out_of_order": lambda: _out_of_order_chain(tmp_path),
    }[make]()
    handle = open_chain(path)
    try:
        seqs = [r.seq for r in handle._reader.records()]
        windows = [(0, 1000), (0, 2), (seqs[len(seqs) // 2], 3)]
        compared = 0
        for f in _grid(handle):
            for offset, limit in windows:
                ours = handle.records(offset=offset, limit=limit, **f)
                theirs = _oracle(handle, offset, limit, f)
                ours.setdefault("unsearched", None)
                assert ours == theirs, (make, f, offset, limit)
                compared += 1
        assert compared > 50
    finally:
        handle.close()


def test_the_vectors_ciphertext_is_counted_unsearched(tmp_path: Path) -> None:
    """Real encrypted bodies reach the new path: a text search over the
    inference vectors leaves them counted, never treated as non-matches."""
    handle = open_chain(_vector_chain(tmp_path, "inference"))
    try:
        page = handle.records(text="e")
        assert page["unsearched"] and page["unsearched"] > 0
    finally:
        handle.close()
