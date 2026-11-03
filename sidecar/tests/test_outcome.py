# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""C-14 — a tool result's outcome, carried through the seam as the package
names it.

EVT_OUTCOME is the writer's statement of how a TOOL_RESULT ended: ok, error,
timeout, cancelled, or (r6) unobserved — the result returned and the
recording vantage could not see whether it failed. The seam passes value and
name through and adds nothing; what `ok` does NOT mean (profile note 5) is
said on the card, not here.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from palimpsests.audit.pala_writer import PalaWriter
from pathlib import Path

OUTCOMES = ["ok", "error", "timeout", "cancelled", "unobserved"]


def _chain(tmp_path: Path) -> Path:
    log = tmp_path / "outcomes.pala"
    w = PalaWriter(log)
    w.genesis()
    w.boot()
    for value in range(len(OUTCOMES)):
        call = w.tool_call("tool", args_digest=bytes([value]) * 32)
        w.tool_result(w.seq - 1, call, value, result_digest=b"\x02" * 32)
    w.close()
    return log


def _rows(client: TestClient, path: Path, **filters) -> list[dict]:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    return client.get(f"/session/{sid}/records", params=filters).json()["records"]


def test_each_result_carries_the_outcome_the_writer_recorded(
    open_client: TestClient, tmp_path: Path
) -> None:
    results = [r for r in _rows(open_client, _chain(tmp_path)) if r["kind_name"] == "TOOL_RESULT"]
    assert [r["outcome"] for r in results] == [
        {"value": v, "name": name} for v, name in enumerate(OUTCOMES)
    ]


def test_no_other_record_carries_an_outcome(open_client: TestClient, tmp_path: Path) -> None:
    others = [r for r in _rows(open_client, _chain(tmp_path)) if r["kind_name"] != "TOOL_RESULT"]
    assert others and all(r["outcome"] is None for r in others)


def test_the_filter_keeps_only_results_with_that_outcome(
    open_client: TestClient, tmp_path: Path
) -> None:
    path = _chain(tmp_path)
    for name in OUTCOMES:
        rows = _rows(open_client, path, outcome_name=name)
        assert [r["outcome"]["name"] for r in rows] == [name]


def test_a_name_the_package_never_gives_matches_nothing(
    open_client: TestClient, tmp_path: Path
) -> None:
    """Exact names, as the package spells them: 'success' is not one."""
    assert _rows(open_client, _chain(tmp_path), outcome_name="success") == []
