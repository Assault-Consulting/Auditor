# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Record health (E-03, F12): the package's detection, counted, never judged.

Each figure is held to the package's own function on the same file, so the
route can only copy or count — and a test fails the day it starts deciding.
"""

from __future__ import annotations

import pytest
import subprocess
import sys
from fastapi.testclient import TestClient
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader, boot_statistics, step_catalog
from palimpsests.audit.timehealth import drift_series
from pathlib import Path
from writers import fixed_writer


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
    w = fixed_writer(path)
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


def test_drift_is_the_package_s_series(open_client: TestClient, two_boot_chain: Path) -> None:
    body = _health(open_client, two_boot_chain)
    series = drift_series(AuditReader.open(two_boot_chain))
    assert body["drift"] == [
        {
            "boot_id": d.boot_id.hex(),
            "slope_ppm": d.slope_ppm,
            "points": len(d.points),
            "time_trusts": list(d.time_trusts),
        }
        for d in series
    ]
    assert len(body["drift"]) == len(body["boots"])
    assert "claim" in body["drift_note"]


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

def test_a_boot_without_the_writer_s_marks_says_unmarked(
    open_client: TestClient, tmp_path: Path
) -> None:
    """A writer before r8 — or one with the marks turned off — there is nothing to say
    about a close, and nothing is guessed."""
    path = tmp_path / "unmarked.pala"
    w = PalaWriter(path, lifecycle=False)
    w.genesis()
    w.boot()
    w.close()
    [boot] = _health(open_client, path)["boots"]
    assert boot["lifecycle"] == {
        "state": "unmarked", "writer": None, "open_seq": None, "close_seq": None
    }


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


# --- SAFETY against the origin in force (E-03, F12 "correlation with origin events")

M1, M2 = b"\x11" * 32, b"\x22" * 32
C1, C2 = b"\xaa" * 32, b"\xbb" * 32


@pytest.fixture
def origin_chain(tmp_path) -> Path:
    """Records before any origin; a model; the same model under a new config;
    an unload; a second model under which nothing SAFETY is written."""
    path = tmp_path / "origins.pala"
    w = fixed_writer(path)
    w.genesis()  # 0
    w.boot()  # 1
    w.incident_candidate(category=1, severity=1, detail="before any model")  # 2
    w.model_load(M1, C1)  # 3
    w.incident_candidate(category=1, severity=2, detail="a")  # 4
    w.model_load(M1, C2)  # 5 — the config digest changes
    w.incident_candidate(category=1, severity=2, detail="b")  # 6
    w.incident_candidate(category=1, severity=2, detail="c")  # 7
    w.model_unload()  # 8
    w.model_load(M2, C2)  # 9
    w.anchor()  # 10
    w.close()
    return path


def test_safety_is_counted_under_the_origin_in_force(
    open_client: TestClient, origin_chain: Path
) -> None:
    origins = _health(open_client, origin_chain)["origins"]
    shape = [
        (o["state"], o["first_seq"], o["last_seq"], o["changed"], o["safety_total"])
        for o in origins
    ]
    assert shape == [
        ("not_stated", 0, 2, [], 1),
        ("active", 3, 4, ["loaded"], 1),
        ("active", 5, 7, ["config_digest"], 2),
        ("unloaded", 8, 8, ["unloaded"], 0),
        # Nothing SAFETY under the second model is listed, with zero: it is
        # half of the comparison.
        ("active", 9, 10, ["loaded"], 0),
    ]
    assert sum(o["records"] for o in origins) == 11


def test_each_stretch_is_the_package_s_origin_at_every_record(
    open_client: TestClient, origin_chain: Path
) -> None:
    """Held to the package: every record's stretch names the origin
    `origin_state_at` gives for that record."""
    origins = _health(open_client, origin_chain)["origins"]
    reader = AuditReader.open(origin_chain)
    for o in origins:
        for seq in range(o["first_seq"], o["last_seq"] + 1):
            st = reader.origin_state_at(seq)
            if o["state"] == "active":
                assert st.origin is not None and st.origin.since_seq == o["origin"]["since_seq"]
                assert st.origin.config_digest.hex() == o["origin"]["config_digest"]
            else:
                assert st.origin is None and st.unloaded == (o["state"] == "unloaded")


def test_a_chain_with_no_origin_is_one_stretch(open_client: TestClient, tmp_path: Path) -> None:
    path = tmp_path / "plain.pala"
    w = fixed_writer(path)
    w.genesis()
    w.boot()
    w.incident_candidate(category=1, severity=1, detail="x")
    w.close()
    [only] = _health(open_client, path)["origins"]
    assert only["state"] == "not_stated" and only["origin"] is None and only["safety_total"] == 1
