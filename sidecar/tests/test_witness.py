# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The local witness log (E-05, F14, ADR-0003).

What is tested is the claim and its limit together: an entry changed,
removed or inserted after the fact stops linking — and a log cut at its end
still links, which the screen must say, so a test pins it.
"""

from __future__ import annotations

import json
import pytest
import subprocess
import sys
from auditor_sidecar.witness import FORMAT, WitnessLog, WitnessRefused, canonical, entry_hash
from fastapi.testclient import TestClient
from pathlib import Path

CHECKER = Path(__file__).resolve().parents[2] / "scripts" / "check_witness_log.py"


def _open(client: TestClient, path: Path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def _lines(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]


def _independent(path: Path) -> tuple[int, str]:
    run = subprocess.run(
        [sys.executable, "-I", str(CHECKER), str(path)], capture_output=True, text=True
    )
    return run.returncode, run.stdout


def _log_of(tmp_path: Path, n: int) -> WitnessLog:
    log = WitnessLog(tmp_path / "w.jsonl")
    for i in range(n):
        log.append({"head": f"{i:064x}"})
    return log


# --- a check goes in the log, once -------------------------------------------


def test_a_check_is_written_once_with_what_was_seen(
    open_client: TestClient, chain_path: Path, witness_log_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    first = open_client.get(f"/session/{sid}/verify").json()
    again = open_client.get(f"/session/{sid}/verify").json()
    entries = _lines(witness_log_path)
    assert len(entries) == 1
    e = entries[0]
    assert first["witness"] == again["witness"] == {"n": 0, "hash": e["hash"], "error": None}
    assert e["format"] == FORMAT and e["n"] == 0 and e["prev"] is None
    assert e["subject"]["sha256"] == first["subject_sha256"]
    assert e["subject"]["name"] == chain_path.name
    assert e["head"] == first["chain"]["head"]
    assert e["records"] == first["chain"]["count"]
    assert e["chain_ok"] is True and e["well_formed"] is True
    assert e["body_digest_mismatches"] == 0
    assert e["anchor"] is None and e["complete_to_anchor"] is None
    assert e["verifier"] == first["verifier"]
    assert e["tool"].startswith("palimpsests-auditor-sidecar ")


def test_the_log_keeps_facts_not_a_verdict(
    open_client: TestClient, chain_path: Path, witness_log_path: Path
) -> None:
    """Which facts answer question one is the package's rule; the log keeps
    the facts, so a later reader applies the rule of their day."""
    sid = _open(open_client, chain_path)
    open_client.get(f"/session/{sid}/verify")
    text = witness_log_path.read_text(encoding="utf-8")
    for word in ("verdict", "valid", "verified", "sound", "intact", "tamper"):
        assert word not in text


def test_each_profile_is_its_own_check(
    open_client: TestClient, chain_path: Path, witness_log_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    head = open_client.get(f"/session/{sid}/verify").json()["chain"]["head"]
    open_client.put(
        "/anchors/profiles/desk",
        json={"name": "desk", "sources": [{"kind": "manual", "head": head}]},
    )
    second = open_client.get(f"/session/{sid}/verify", params={"profile": "desk"}).json()
    entries = _lines(witness_log_path)
    assert [e["n"] for e in entries] == [0, 1]
    assert entries[1]["prev"] == entries[0]["hash"]
    assert entries[1]["profile"] == "desk"
    assert entries[1]["anchor"]["head"] == head
    assert entries[1]["complete_to_anchor"] is True
    assert second["witness"]["n"] == 1


def test_a_log_that_cannot_be_written_does_not_hide_the_verdict(
    open_client: TestClient, chain_path: Path, witness_log_path: Path
) -> None:
    witness_log_path.mkdir(parents=True)  # a directory where the file should be
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/verify")
    assert r.status_code == 200
    assert r.json()["chain"]["chain_ok"] is True
    w = r.json()["witness"]
    assert w["n"] is None and w["hash"] is None and w["error"]


def test_a_broken_log_is_not_appended_to(
    open_client: TestClient, chain_path: Path, witness_log_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    open_client.get(f"/session/{sid}/verify")
    entries = _lines(witness_log_path)
    entries[0]["head"] = "0" * 64
    witness_log_path.write_text(json.dumps(entries[0]) + "\n", encoding="utf-8")
    before = witness_log_path.read_bytes()
    sid2 = _open(open_client, chain_path)
    w = open_client.get(f"/session/{sid2}/verify").json()["witness"]
    assert w["hash"] is None
    assert "does not link at line 1" in w["error"]
    assert "nothing was added" in w["error"]
    assert witness_log_path.read_bytes() == before


# --- the log's own linkage ---------------------------------------------------


def test_entries_link_and_the_independent_checker_agrees(tmp_path: Path) -> None:
    log = _log_of(tmp_path, 4)
    c = log.check()
    assert (c.entries, c.broken_at, c.reason) == (4, None, None)
    assert c.head == _lines(log.path)[-1]["hash"]
    code, out = _independent(log.path)
    assert code == 0 and f"head {c.head}" in out


@pytest.mark.parametrize(
    ("damage", "line", "reason"),
    [
        ("edit", 2, "does not match its own digest"),
        ("drop", 2, "numbered 2, not 1"),
        ("swap", 2, "numbered 2, not 1"),
        ("insert", 4, "numbered 2, not 3"),
        ("garbage", 4, "not a JSON object"),
    ],
)
def test_a_change_after_the_fact_stops_linking(
    tmp_path: Path, damage: str, line: int, reason: str
) -> None:
    log = _log_of(tmp_path, 4)
    rows = log.path.read_text(encoding="utf-8").splitlines()
    if damage == "edit":
        e = json.loads(rows[1])
        e["head"] = "f" * 64
        rows[1] = json.dumps(e)
    elif damage == "drop":
        del rows[1]
    elif damage == "swap":
        rows[1], rows[2] = rows[2], rows[1]
    elif damage == "insert":
        # A well-formed entry, hashed correctly, chained to entry 1 — written
        # by something that knows the format. It still breaks what follows.
        e = {"format": FORMAT, "n": 2, "prev": json.loads(rows[1])["hash"], "head": "e" * 64}
        e["hash"] = entry_hash(e)
        rows.insert(2, json.dumps(e))
    elif damage == "garbage":
        rows[3] = rows[3][: len(rows[3]) // 2]  # a write cut in the middle
    log.path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    c = log.check()
    assert c.broken_at == line
    assert reason in c.reason
    assert c.head is None
    assert _independent(log.path)[0] == 1
    with pytest.raises(WitnessRefused):
        log.append({"head": "0" * 64})


def test_a_log_cut_at_its_end_still_links(tmp_path: Path) -> None:
    """The residual, pinned: the log alone cannot show a missing tail. Only a
    copy kept elsewhere — its head noted — or an external witness does."""
    log = _log_of(tmp_path, 4)
    rows = log.path.read_text(encoding="utf-8").splitlines()
    log.path.write_text("\n".join(rows[:2]) + "\n", encoding="utf-8")
    c = log.check()
    assert (c.entries, c.broken_at) == (2, None)
    assert _independent(log.path)[0] == 0


def test_no_log_yet_is_empty_not_broken(tmp_path: Path) -> None:
    c = WitnessLog(tmp_path / "absent.jsonl").check()
    assert (c.entries, c.head, c.broken_at) == (0, None, None)


def test_the_hash_is_over_the_documented_bytes() -> None:
    e = {"n": 0, "format": FORMAT, "prev": None, "é": 1, "hash": "ignored"}
    assert canonical(e) == '{"format":"auditor-witness/1","n":0,"prev":null,"é":1}'.encode()


# --- the route ---------------------------------------------------------------


def test_the_route_says_where_the_log_is_and_whether_it_links(
    open_client: TestClient, chain_path: Path, witness_log_path: Path
) -> None:
    empty = open_client.get("/witness").json()
    assert empty["entries"] == 0 and empty["tail"] == [] and empty["broken_at"] is None
    assert empty["path"] == str(witness_log_path)
    sid = _open(open_client, chain_path)
    open_client.get(f"/session/{sid}/verify")
    body = open_client.get("/witness?limit=5").json()
    assert body["format"] == FORMAT
    assert body["entries"] == 1
    assert body["head"] == body["tail"][-1]["hash"]
    assert body["tail"][0]["subject"]["name"] == chain_path.name


def test_the_route_shows_a_broken_log_as_broken(
    open_client: TestClient, witness_log_path: Path
) -> None:
    witness_log_path.parent.mkdir(parents=True)
    witness_log_path.write_text("not json\n", encoding="utf-8")
    body = open_client.get("/witness").json()
    assert body["broken_at"] == 1 and body["head"] is None
    assert body["reason"] == "this line is not a JSON object"


def test_the_route_needs_the_token(gated_client: TestClient) -> None:
    assert gated_client.get("/witness").status_code == 401
