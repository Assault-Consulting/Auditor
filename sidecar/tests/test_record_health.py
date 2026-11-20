# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Record health (E-03, F12): the package's detection, counted, never judged.

Each figure is held to the package's own function on the same file, so the
route can only copy or count — and a test fails the day it starts deciding.
"""

from __future__ import annotations

import inspect
import pytest
import subprocess
import sys
from fastapi.testclient import TestClient
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader, boot_statistics, step_catalog
from pathlib import Path


def _health(client: TestClient, path: Path) -> dict:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    r = client.get(f"/session/{sid}/record-health")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def recurring_chain(tmp_path, monkeypatch):
    """One boot with a clock that jumps ten minutes forward mid-boot, and the
    same refusal recorded three times — a pattern, not an episode."""
    import palimpsests.audit.pala_writer as pw

    clock = {"now": 1_787_000_000_000_000_000}

    def _tick() -> int:
        now = clock["now"]
        clock["now"] += 1_000_000
        return now

    monkeypatch.setattr(pw.time, "time_ns", _tick)
    path = tmp_path / "recurring.pala"
    w = pw.PalaWriter(path)
    w.genesis()
    w.boot()
    w.guard_state_reject(detail="no frame magic")
    w.guard_state_reject(detail="no frame magic")
    clock["now"] += 600_000_000_000  # the writer's clock jumps
    w.guard_state_reject(detail="no frame magic")
    w.incident_candidate(category=1, severity=2, detail="once")
    w.anchor()
    w.close()
    return path


def test_boots_and_steps_are_the_package_s(open_client: TestClient, two_boot_chain: Path) -> None:
    body = _health(open_client, two_boot_chain)
    reader = AuditReader.open(two_boot_chain)
    stats = boot_statistics(reader)
    assert [b["boot_id"] for b in body["boots"]] == [s.view.boot_id.hex() for s in stats]
    for got, st in zip(body["boots"], stats, strict=True):
        assert got["uptime_ns"] == st.uptime_ns
        assert got["anchors"] == st.anchors.count
        assert got["anchor_gaps_ns"] == list(st.anchors.gaps_ns)
        assert got["widest_anchor_gap_ns"] == st.anchors.widest_anchor_gap_ns
        assert got["records"] == st.view.record_count
    assert body["steps"] == [
        {"seq": s.seq, "boot_id": s.boot_id.hex(), "kind": s.kind, "delta_ns": s.delta_ns}
        for s in step_catalog(reader)
    ]


def test_the_gap_between_boots_is_the_timeline_s(
    open_client: TestClient, two_boot_chain: Path
) -> None:
    sid = open_client.post("/session", json={"path": str(two_boot_chain)}).json()["session_id"]
    timeline = open_client.get(f"/session/{sid}/timeline", params={"axis": "wall"}).json()
    health = open_client.get(f"/session/{sid}/record-health").json()
    assert len(health["wall_gaps"]) == 1
    assert health["wall_gaps"][0]["duration_ns"] == timeline["wall_gaps"][0]["duration_ns"]
    # The fixture's writer is down for an hour, one tick after its last record.
    assert health["wall_gaps"][0]["duration_ns"] == 3_601_000_000_000


def test_safety_is_counted_by_kind_and_boot(open_client: TestClient, two_boot_chain: Path) -> None:
    body = _health(open_client, two_boot_chain)
    assert body["safety_total"] == 2
    [kind] = body["safety_by_kind"]
    assert kind["kind"] == "INCIDENT_CANDIDATE" and kind["total"] == 2
    assert sorted(b["count"] for b in kind["per_boot"]) == [1, 1]
    assert {b["boot_id"] for b in kind["per_boot"]} == {b["boot_id"] for b in body["boots"]}
    assert body["recurring_details"] == []


def test_a_recurring_detail_is_a_pattern(open_client: TestClient, recurring_chain: Path) -> None:
    body = _health(open_client, recurring_chain)
    assert body["recurring_details"] == [
        {"detail": "no frame magic", "kind": "GUARD_STATE_REJECT", "count": 3, "first_seq": 2}
    ]
    kinds = {k["kind"]: k["total"] for k in body["safety_by_kind"]}
    assert kinds == {"GUARD_STATE_REJECT": 3, "INCIDENT_CANDIDATE": 1}
    assert list(kinds) == ["GUARD_STATE_REJECT", "INCIDENT_CANDIDATE"]  # most first
    assert any(s["kind"] == "step" and s["seq"] == 4 for s in body["steps"])


def test_drift_waits_for_the_declared_surface(open_client: TestClient, chain_path: Path) -> None:
    body = _health(open_client, chain_path)
    assert body["drift"] is None
    assert "0.15" in body["drift_note"]


def test_no_verdict_word_and_no_threshold(open_client: TestClient, recurring_chain: Path) -> None:
    """F12's second discipline: describe, never judge. Nothing in the answer
    names a cause or crosses a line nobody drew."""
    text = str(_health(open_client, recurring_chain)).lower()
    for word in ("anomal", "suspicious", "tamper", "attack", "threshold", "verdict", "healthy"):
        assert word not in text


def test_an_empty_file_has_no_health_to_report(open_client: TestClient, tmp_path: Path) -> None:
    empty = tmp_path / "empty.pala"
    empty.write_bytes(b"")
    body = _health(open_client, empty)
    assert body["boots"] == [] and body["steps"] == [] and body["wall_gaps"] == []
    assert body["safety_total"] == 0


# --- the writer's open and close (profile r8, 0.15) ---------------------------

_MARKS = "lifecycle" in inspect.signature(PalaWriter.__init__).parameters


def test_a_boot_without_the_writer_s_marks_says_unmarked(
    open_client: TestClient, tmp_path: Path
) -> None:
    """Before r8 — or with the marks turned off — there is nothing to say
    about a close, and nothing is guessed."""
    path = tmp_path / "unmarked.pala"
    w = PalaWriter(path, **({"lifecycle": False} if _MARKS else {}))
    w.genesis()
    w.boot()
    w.close()
    [boot] = _health(open_client, path)["boots"]
    assert boot["lifecycle"] == {
        "state": "unmarked", "writer": None, "open_seq": None, "close_seq": None
    }


@pytest.mark.skipif(not _MARKS, reason="the writer marks its open and close from r8 (0.15)")
def test_closed_stopped_and_last_boots_are_the_package_s(
    open_client: TestClient, tmp_path: Path
) -> None:
    """Three boots: one ended by a real process exit, one closed, one still
    open. The stopped one is exactly the package's `boot_ended_without_close`."""
    path = tmp_path / "three.pala"
    code = (
        "import os, sys\n"
        "from palimpsests.audit.pala_writer import PalaWriter\n"
        "w = PalaWriter(sys.argv[1]); w.genesis(); w.boot(); os._exit(0)\n"
    )
    subprocess.run([sys.executable, "-c", code, str(path)], check=True)
    w = PalaWriter.open_existing(path)
    w.boot()
    w.close()
    code_open = (
        "import os, sys\n"
        "from palimpsests.audit.pala_writer import PalaWriter\n"
        "w = PalaWriter.open_existing(sys.argv[1]); w.boot(); os._exit(0)\n"
    )
    subprocess.run([sys.executable, "-c", code_open, str(path)], check=True)

    boots = _health(open_client, path)["boots"]
    assert [b["lifecycle"]["state"] for b in boots] == ["stopped", "closed", "last_unclosed"]
    for b in boots:
        assert b["lifecycle"]["writer"].startswith("palimpsests ")
        assert b["lifecycle"]["open_seq"] == b["first_seq"] + 1
    assert boots[1]["lifecycle"]["close_seq"] == boots[1]["last_seq"]

    advisory = AuditReader.open(path).verify().advisory
    stopped = {i.boot_id.hex() for i in advisory.items if i.code == "boot_ended_without_close"}
    assert stopped == {b["boot_id"] for b in boots if b["lifecycle"]["state"] == "stopped"}
