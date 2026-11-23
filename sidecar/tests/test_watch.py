# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Watch mode (F15): the package's TailingReader, run and counted.

Each event is the package's (channel 9, provisional in 0.15); the snapshot
is its batch verification, held to an AuditReader over the same records.
The watch never writes the file and never becomes a session.
"""

from __future__ import annotations

import os
import pytest
import time
from auditor_sidecar import pala_seam
from fastapi.testclient import TestClient
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader
from pathlib import Path


def _start(client: TestClient, path: Path, **extra) -> str:
    r = client.post("/watch", json={"path": str(path), "poll_interval": 0.1, **extra})
    assert r.status_code == 201, r.text
    return r.json()["watch_id"]


def _until(client: TestClient, wid: str, pred, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    body = client.get(f"/watch/{wid}/events", params={"after": 0}).json()
    while not pred(body) and time.monotonic() < deadline:
        time.sleep(0.05)
        body = client.get(f"/watch/{wid}/events", params={"after": 0}).json()
    assert pred(body), body
    return body


@pytest.fixture
def growing(tmp_path: Path):
    path = tmp_path / "live.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    yield path, w
    try:
        w.close()
    except Exception:  # noqa: BLE001 — some tests close it themselves
        pass


def test_records_arrive_as_they_are_written(open_client: TestClient, growing) -> None:
    path, w = growing
    wid = _start(open_client, path)
    _until(open_client, wid, lambda b: b["state"]["records"] >= 3)
    call = w.tool_call("t", args_digest=bytes(32))
    w.tool_result(w.seq - 1, call, 0, result_digest=bytes(32))
    w.anchor()
    body = _until(open_client, wid, lambda b: any(e["kind"] == "anchor_seen" for e in b["events"]))
    kinds = [e["record_kind"] for e in body["events"] if e["kind"] == "record"]
    assert kinds[:5] == ["GENESIS", "WRITER_OPEN", "BOOT", "TOOL_CALL", "TOOL_RESULT"]
    assert [e["n"] for e in body["events"]] == list(range(len(body["events"])))
    assert body["state"]["state"] == "watching"
    assert body["state"]["by_kind"]["TOOL_CALL"] == 1


def test_the_snapshot_is_the_batch_answer_over_what_was_verified(
    open_client: TestClient, growing
) -> None:
    path, w = growing
    w.anchor()
    w.close()
    wid = _start(open_client, path)
    n = AuditReader.open(path).record_count
    _until(open_client, wid, lambda b: b["state"]["records"] == n)
    snap = open_client.get(f"/watch/{wid}/snapshot").json()
    batch = AuditReader.open(path).verify()
    assert snap["chain"]["count"] == batch.chain.count == n
    assert snap["chain"]["head"] == batch.chain.head.hex()
    assert snap["chain"]["chain_ok"] is batch.chain.chain_ok is True


def test_the_cursor_waits_and_a_reader_behind_is_told(
    open_client: TestClient, growing, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pala_seam, "WATCH_KEEP_EVENTS", 3)
    path, w = growing
    for _ in range(5):
        w.anchor()
    wid = _start(open_client, path)
    body = _until(open_client, wid, lambda b: b["next"] >= 8)
    assert len(body["events"]) == 3 and body["dropped"] == body["next"] - 3
    # Nothing new: a long poll waits, then answers empty with the same cursor.
    t = time.monotonic()
    again = open_client.get(
        f"/watch/{wid}/events", params={"after": body["next"], "wait": 0.3}
    ).json()
    assert again["events"] == [] and again["next"] == body["next"]
    assert time.monotonic() - t >= 0.25


def test_a_watch_stops_itself_at_its_limit(
    open_client: TestClient, growing, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pala_seam, "WATCH_MAX_RECORDS", 2)
    path, _ = growing
    wid = _start(open_client, path)
    body = _until(open_client, wid, lambda b: b["state"]["state"] != "watching")
    assert body["state"]["state"] == "limit"
    assert "Open the file" in body["state"]["reason"]


def test_a_file_cut_below_what_was_verified_is_the_package_s_alarm(
    open_client: TestClient, growing
) -> None:
    path, w = growing
    w.anchor()
    w.close()
    wid = _start(open_client, path)
    n = AuditReader.open(path).record_count
    _until(open_client, wid, lambda b: b["state"]["records"] == n)
    data = path.read_bytes()
    with open(path, "r+b") as fh:
        fh.truncate(len(data) // 2)
        os.fsync(fh.fileno())
    body = _until(open_client, wid, lambda b: any(e["kind"] == "diagnosis" for e in b["events"]))
    diag = [e for e in body["events"] if e["kind"] == "diagnosis"]
    assert "replaced_or_rolled_back" in diag[-1]["detail"]


def test_stopping_forgets_the_watch_and_leaves_the_file(open_client: TestClient, growing) -> None:
    path, _ = growing
    before = path.read_bytes()
    wid = _start(open_client, path)
    assert open_client.delete(f"/watch/{wid}").status_code == 204
    assert open_client.get(f"/watch/{wid}/events").status_code == 404
    assert path.read_bytes() == before


def test_refusals(open_client: TestClient, tmp_path: Path, growing, monkeypatch) -> None:
    r = open_client.post("/watch", json={"path": str(tmp_path / "absent.pala")})
    assert r.status_code == 422 and r.json()["detail"].startswith("not a file")
    path, _ = growing
    r = open_client.post("/watch", json={"path": str(path), "profile": "nope"})
    assert r.status_code == 404
    import auditor_sidecar.main as main

    monkeypatch.setattr(main, "MAX_WATCHES", 1)
    first = _start(open_client, path)
    r = open_client.post("/watch", json={"path": str(path)})
    assert r.status_code == 422 and "already being watched" in r.json()["detail"]
    open_client.delete(f"/watch/{first}")


def test_the_routes_need_the_token(gated_client: TestClient) -> None:
    assert gated_client.post("/watch", json={"path": "x"}).status_code == 401
    assert gated_client.get("/watch/x/events").status_code == 401
