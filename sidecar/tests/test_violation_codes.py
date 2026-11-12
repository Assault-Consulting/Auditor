# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-17(b) — violation codes and the diagnosis code, carried as the package gives them.

Since 0.14 a chain violation carries a code (U24): ``VerifyResult.violation_codes``,
parallel to ``violations``, and ``Diagnosis.code`` for ``record_violation``.
The code is the machine field; the reason beside it is the verifier's
sentence, never parsed (INTEGRATION-SURFACE.md, "machine fields are
contract; sentences are not").
"""

from __future__ import annotations

import dataclasses
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.pala import vectors
from palimpsests.audit.reader import AuditReader, Diagnosis
from pathlib import Path


def _missing_genesis(tmp_path: Path) -> Path:
    """The published core vectors with their first record left out — the
    `missing_genesis` demo, built from published bytes only (as in C-15)."""
    records = vectors.load("core")["records"]
    path = tmp_path / "missing-genesis.pala"
    path.write_bytes(
        b"".join(
            bytes.fromhex(r["header_hex"]) + bytes.fromhex(r.get("body_hex", ""))
            for r in records[1:]
        )
    )
    return path


def test_violation_codes_run_parallel_to_violations_on_real_bytes(tmp_path) -> None:
    handle = open_chain(_missing_genesis(tmp_path))
    try:
        chain = handle.verify()["chain"]
    finally:
        handle.close()
    assert chain["violation_codes"] == [[0, "prefix_absent"]]
    # Parallel: the same seqs, in the same order, as the sentences.
    assert [seq for seq, _ in chain["violation_codes"]] == [seq for seq, _ in chain["violations"]]


def test_a_sound_chain_has_no_codes(open_client, chain_path) -> None:
    sid = open_client.post("/session", json={"path": str(chain_path)}).json()["session_id"]
    body = open_client.get(f"/session/{sid}/verify").json()
    assert body["chain"]["violation_codes"] == []
    assert body["diagnosis"] is None


def test_the_diagnosis_code_is_passed_through(chain_path, monkeypatch) -> None:
    """No writer-built chain can carry a record_violation (the writer cannot
    emit one), so the package's verdict is replaced with one that names a
    code, to hold the seam to copying it rather than reading the sentence."""
    real = AuditReader.verify

    def with_a_violation(self):
        result = real(self)
        return dataclasses.replace(
            result,
            diagnosis=Diagnosis(
                "record_violation",
                3,
                "time_trust UNKNOWN with a zero wall clock",
                "Record 3 breaks a normative MUST.",
                code="time_unknown_with_wall_clock",
            ),
        )

    monkeypatch.setattr(AuditReader, "verify", with_a_violation)
    handle = open_chain(chain_path)
    try:
        diagnosis = handle.verify()["diagnosis"]
    finally:
        handle.close()
    assert diagnosis["code"] == "time_unknown_with_wall_clock"
    assert diagnosis["expected"] == "time_trust UNKNOWN with a zero wall clock"


def test_the_code_is_null_for_every_other_pattern(tmp_path) -> None:
    handle = open_chain(_missing_genesis(tmp_path))
    try:
        diagnosis = handle.verify()["diagnosis"]
    finally:
        handle.close()
    assert diagnosis["pattern"] == "prefix_absent"
    assert diagnosis["code"] is None
