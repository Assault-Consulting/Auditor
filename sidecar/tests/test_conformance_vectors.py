# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Conformance against the published PALA-1 vectors (C-15).

The independent authority. `test_agreement_with_cli.py` compares the sidecar
with the package's own CLI, which shares its code, so the two can only agree
or disagree — never both be checked. The published vectors are what a
third-party verifier written from the prose alone is measured against, and
`CONSUMER-SURFACE.md` r2 (decision 5) asks this repository to move its test
fixtures onto them wherever a vector carries the case.

What runs here, all through Auditor's own read path (`open_chain`, the one
seam that touches the package):

- **Core envelope** — the frozen §8 Expected-results block, pinned below as
  constants rather than read back from the vectors' own `verify` block.
- **Core demos** — the four the vectors carry as plain record bytes and
  hashes, so they are built here by concatenating published bytes and never
  by writing a header: a truncated tail, a stale anchor, a flipped body bit,
  a missing GENESIS. The other three (`seq_gap`, `unknown_record_type`,
  `unknown_time_with_clock`) need a header written for them; they stay with
  the writer-built mutation suite (`test_mutations.py`), which keeps every
  case here too, since it also checks the screen's wording.
- **Inference profile semantics** — the decoded r2–r6 expectations in the
  vectors' `semantics` block (kinds, the oversight loop, tool calls and
  results, source marks, outcomes, a shred, a segment continuation), compared
  field by field with what `RecordView` renders. Here the expectation *is*
  the published block: it is the specification's statement about these
  bytes, not a copy of something this test computes.
- **A real encrypted body** — both vector sets carry one, the only ciphertext
  this repository can test against (the package's writer does not encrypt).

Fields the semantics block states and this shell does not render are listed,
with the reason, in `NOT_RENDERED`; an unlisted field fails the test, so a
richer vector cannot be passed by silence.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.pala import vectors
from pathlib import Path


def _record_bytes(record: dict) -> bytes:
    return bytes.fromhex(record["header_hex"]) + bytes.fromhex(record.get("body_hex", ""))


def _container_from(records: list[dict]) -> bytes:
    """The §2.4 container: each record's published header bytes followed by its
    published body bytes, concatenated in order. Nothing here is written."""
    return b"".join(_record_bytes(r) for r in records)


def _open(tmp_path: Path, name: str, data: bytes):
    path = tmp_path / f"{name}.pala"
    path.write_bytes(data)
    return open_chain(path)


def _verify(tmp_path: Path, name: str, data: bytes, head: str | None = None) -> dict:
    handle = _open(tmp_path, name, data)
    try:
        return handle.verify([{"kind": "manual", "head": head}] if head else None)
    finally:
        handle.close()


# Published expectations as constants — the frozen §8 Expected-results block
# (PALA-1.md §8), pinned here rather than read from the vectors' own `verify`
# block. The point of an independent authority is lost if the test reads its
# expectation from the same file it is checking.
CORE_CHAIN_OK = True
CORE_RECORD_COUNT = 12
CORE_CHAIN_HEAD = "3a1a3673f50498eb1d1c6f94b983d6c606cd85ed53627b4e4ffe55153c7af813"


def test_the_core_vectors_verify_as_published(tmp_path: Path) -> None:
    """Envelope conformance: the frozen `verify` block, reproduced."""
    chain = _verify(tmp_path, "core", _container_from(vectors.load("core")["records"]))["chain"]
    assert chain["chain_ok"] is CORE_CHAIN_OK
    assert chain["count"] == CORE_RECORD_COUNT
    assert chain["breaks"] == []
    assert chain["gaps"] == []
    assert chain["violations"] == []
    assert chain["head"] == CORE_CHAIN_HEAD


# --- core demos the vectors carry as plain bytes --------------------------------


@pytest.fixture(scope="module")
def core() -> dict:
    return vectors.load("core")


def test_demo_tail_truncation(tmp_path: Path, core: dict) -> None:
    demo = core["demos"]["tail_truncation"]
    records = core["records"]
    assert records[-1]["seq"] == demo["dropped_seq"]
    result = _verify(tmp_path, "tail", _container_from(records[:-1]), core["anchor_head"])
    assert result["chain"]["chain_ok"] is demo["chain_ok_without_anchor"]
    assert result["completeness"]["complete_to_anchor"] is demo["complete_to_anchor"]
    assert result["completeness"]["anchor_reason"] == demo["anchor_reason"]
    assert result["diagnosis"]["pattern"] == "replaced_or_rolled_back"


def test_demo_stale_anchor(tmp_path: Path, core: dict) -> None:
    demo = core["demos"]["stale_anchor"]
    named = next(r for r in core["records"] if r["seq"] == demo["anchor_names_seq"])
    result = _verify(tmp_path, "stale", _container_from(core["records"]), named["record_hash"])
    assert result["chain"]["chain_ok"] is demo["chain_ok"]
    assert result["completeness"]["complete_to_anchor"] is demo["complete_to_anchor"]
    assert result["completeness"]["anchor_lag"] == demo["anchor_lag"]
    assert result["completeness"]["anchor_reason"] == demo["anchor_reason"]
    assert result["diagnosis"]["pattern"] == "unanchored_tail"


def test_demo_body_bitflip(tmp_path: Path, core: dict) -> None:
    """One bit flipped inside a published body: the header chain still links,
    and the body-digest walk names the record."""
    demo = core["demos"]["body_bitflip"]
    records = core["records"]
    flipped = next(r for r in records if r.get("body_hex"))
    data = bytearray(_container_from(records))
    at = sum(len(_record_bytes(r)) for r in records[: records.index(flipped)])
    data[at + len(bytes.fromhex(flipped["header_hex"]))] ^= 0x01
    result = _verify(tmp_path, "flip", bytes(data))
    assert result["chain"]["chain_ok"] is demo["chain_still_verifies"]
    assert (flipped["seq"] in result["container"]["body_digest_mismatches"]) is demo["detected"]


def test_demo_missing_genesis(tmp_path: Path, core: dict) -> None:
    demo = core["demos"]["missing_genesis"]
    assert core["records"][0]["label"] == "genesis"
    result = _verify(tmp_path, "nogen", _container_from(core["records"][1:]))
    assert result["chain"]["chain_ok"] is demo["chain_ok"]
    assert result["chain"]["breaks"] == demo["breaks"]
    assert result["chain"]["violations"] == demo["violations"]
    assert result["diagnosis"]["pattern"] == "prefix_absent"


def test_the_demos_this_file_cannot_build_are_named(core: dict) -> None:
    """The rest need a header written for them, which only the writer may do;
    a new demo must be placed on one side or the other, not slip through."""
    built_here = {"tail_truncation", "stale_anchor", "body_bitflip", "missing_genesis"}
    on_the_writer = {"seq_gap", "unknown_record_type", "unknown_time_with_clock"}
    assert set(core["demos"]) == built_here | on_the_writer


# --- a real encrypted body -------------------------------------------------------


@pytest.mark.parametrize("vector_set", ["core", "inference"])
def test_a_real_encrypted_body_is_opaque_and_counted_as_unsearched(
    tmp_path: Path, vector_set: str
) -> None:
    """Ciphertext the package's own encoder produced (the writer does not
    encrypt): shown as opaque, never decoded, and counted by a text search as
    not searched rather than as a non-match (C-09d)."""
    vec = vectors.load(vector_set)
    handle = _open(tmp_path, vector_set, _container_from(vec["records"]))
    try:
        encrypted = [r for r in handle.records(limit=100)["records"] if r["key_id"] is not None]
        assert encrypted, "the published set carries an encrypted body"
        for row in encrypted:
            assert row["body_len"] > 0
            assert row["body_tlv_types"] is None
            assert row["detail"] is None
        page = handle.records(text="e")
        assert page["unsearched"] == len(encrypted)
        assert all(r["key_id"] is None for r in page["records"])
    finally:
        handle.close()


# --- inference profile semantics -------------------------------------------------

#: Semantics fields this shell does not render, and why. A field the vectors
#: state that is neither checked below nor listed here fails the test.
NOT_RENDERED = {
    "category": "incident category — not on RecordView",
    "severity": "incident severity — not on RecordView",
    "recoverable": "incident recoverability — not on RecordView",
    "ref_hash": "a reference's hash; the package resolves it, the shell shows the result",
    "tool_name": "tool name — not on RecordView",
    "payload_digest": "tool payload digest — not on RecordView",
    "iterations": "loop-limit iterations — not on RecordView",
    "tools_offered": "count of tools offered — not on RecordView",
    "tools_digest": "digest of the tools offered — not on RecordView",
    "names_canonicalization": "a statement about the digest, not a record field",
    "reason": "shred reason — not on RecordView",
    "prior_root_covers": "prose on which records the prior root covers, not a record field",
}


@pytest.fixture(scope="module")
def inference(tmp_path_factory) -> tuple[dict, object]:
    vec = vectors.load("inference")
    path = tmp_path_factory.mktemp("inference") / "inference.pala"
    path.write_bytes(_container_from(vec["records"]))
    handle = open_chain(path)
    yield vec, handle
    handle.close()


def test_the_inference_vectors_verify_as_published(inference) -> None:
    vec, handle = inference
    result = handle.verify([{"kind": "manual", "head": vec["anchor_head"]}])
    assert result["chain"]["chain_ok"] is True
    assert result["chain"]["count"] == len(vec["records"])
    assert result["chain"]["head"] == vec["chain_head"]
    assert result["completeness"]["complete_to_anchor"] is True
    assert result["diagnosis"] is None


def test_the_inference_profile_semantics_are_resolved_as_published(inference) -> None:
    """Every stated field is either compared with what the record card shows,
    or listed in NOT_RENDERED with its reason."""
    vec, handle = inference
    checked = 0
    for key, expected in vec["semantics"].items():
        if not key.isdigit():
            continue  # the block's own rules and comments
        seq = int(key)
        view = handle.record(seq)
        for field, value in expected.items():
            if field in NOT_RENDERED:
                continue
            checked += 1
            if field == "kind":
                assert view["kind"] == value, (seq, field)
            elif field == "kind_name":
                assert view["kind_name"] == value, (seq, field)
            elif field == "record_type":
                assert view["type_name"] == value, (seq, field)
            elif field == "detail":
                if view["type_name"] in ("EVENT", "SAFETY"):
                    assert view["detail"] == value, (seq, field)
                else:
                    # The package decodes EVT_DETAIL on EVENT and SAFETY bodies
                    # only (U12's scope); a KEY_SHRED's detail is not on its
                    # DecodedRecord, so the card shows none. A gap upstream,
                    # stated here rather than skipped.
                    assert view["detail"] is None, (seq, field)
            elif field == "ref_seq":
                if view["kind_name"] == "OVERSIGHT_ACK":
                    assert view["acknowledges"] == value, (seq, field)
                    assert handle.record(value)["acknowledged_by"] == seq
                # A result's call, a candidate's cause and a loop limit's call
                # are resolved by the package for its advisories; the card
                # shows no link for them.
            elif field == "disposition":
                assert view["disposition"]["value"] == value, (seq, field)
            elif field == "operator_id":
                assert view["operator_id"] == value, (seq, field)
            elif field == "source":
                assert view["source"]["value"] == value, (seq, field)
            elif field == "source_name":
                assert view["source"]["name"] == value, (seq, field)
            elif field == "outcome":
                assert view["outcome"]["value"] == value, (seq, field)
            elif field == "outcome_name":
                assert view["outcome"]["name"] == value, (seq, field)
            elif field in ("segment_index", "predecessor_head", "retention_s", "prior_root"):
                assert view["continuation"][field] == value, (seq, field)
            elif field == "target_seqs":
                for target in value:
                    assert handle.record(target)["shredded_by"] == seq, (seq, field)
            else:
                pytest.fail(f"semantics field {field!r} at seq {seq} is neither checked nor listed")
    assert checked >= 40


def test_the_source_rule_holds_for_an_absent_mark(inference) -> None:
    """`source_rule`: an absent EVT_SOURCE means 0, parsed-from-wire — a claim,
    not the absence of one, so the card shows it as such."""
    vec, handle = inference
    assert "absent means 0" in vec["semantics"]["source_rule"]
    for seq in (8, 9):
        assert handle.record(seq)["source"] == {"value": 0, "name": "parsed-from-wire"}
