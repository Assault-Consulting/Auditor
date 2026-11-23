# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""A chain as users bring it from 0.15 on: the writer's own two records.

Profile r8: `PalaWriter` writes `WRITER_OPEN` (kind 13, its name and version
in `detail`) straight after the first GENESIS or BOOT, and `WRITER_CLOSE`
(kind 12) last in `close()`. A boot that opened and was never closed is the
package's advisory `boot_ended_without_close` — never a violation.

Every other fixture that tests records by number builds through
`writers.fixed_writer`; this file is where the default mode is held to the
package.
"""

from __future__ import annotations

import pytest
import subprocess
import sys
from fastapi.testclient import TestClient
from palimpsests.audit.pala_writer import PalaWriter
from palimpsests.audit.reader import AuditReader
from pathlib import Path


def _records(client: TestClient, path: Path) -> list[dict]:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    return client.get(f"/session/{sid}/records", params={"limit": 500}).json()["records"]


def _verify(client: TestClient, path: Path) -> dict:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    r = client.get(f"/session/{sid}/verify")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def stopped_chain(tmp_path: Path) -> Path:
    """A first boot whose process is ended without `close()` — what a kill or
    a power cut leaves — then a second boot that closes. Ended for real, in a
    process of its own: the writer's lock is released by the OS, not by us."""
    path = tmp_path / "stopped.pala"
    code = (
        "import os, sys\n"
        "from palimpsests.audit.pala_writer import PalaWriter\n"
        "w = PalaWriter(sys.argv[1])\n"
        "w.genesis(); w.boot()\n"
        "w.incident_candidate(category=1, severity=2, detail='before the stop')\n"
        "os._exit(0)\n"
    )
    subprocess.run([sys.executable, "-c", code, str(path)], check=True)
    w = PalaWriter.open_existing(path)
    w.boot()
    w.anchor()
    w.close()
    return path


def test_each_boot_is_opened_and_closed_by_its_writer(
    open_client: TestClient, two_boot_chain: Path
) -> None:
    records = _records(open_client, two_boot_chain)
    kinds = [r["kind_name"] for r in records]
    assert kinds.count("WRITER_OPEN") == 2 and kinds.count("WRITER_CLOSE") == 2
    # Each boot's WRITER_OPEN is the record after the one that began it, and
    # its WRITER_CLOSE is the boot's last record.
    by_boot: dict[str, list[dict]] = {}
    for r in records:
        by_boot.setdefault(r["boot_id"], []).append(r)
    for boot in by_boot.values():
        assert boot[1]["kind_name"] == "WRITER_OPEN"
        assert boot[-1]["kind_name"] == "WRITER_CLOSE"
    # The writer names itself, and the name is shown as the package decoded it.
    opens = [r for r in records if r["kind_name"] == "WRITER_OPEN"]
    reader = AuditReader.open(two_boot_chain)
    for r in opens:
        assert r["detail"] == reader.record_by_seq(r["seq"]).detail
        assert r["detail"].startswith("palimpsests ")


def test_a_closed_chain_s_head_is_its_writer_close(
    open_client: TestClient, two_boot_chain: Path
) -> None:
    """Anchor after the writer stops: a head taken before `close()` is the
    head of a chain one record shorter."""
    body = _verify(open_client, two_boot_chain)
    records = _records(open_client, two_boot_chain)
    assert records[-1]["kind_name"] == "WRITER_CLOSE"
    assert body["chain"]["head"] == records[-1]["record_hash"]


def test_a_boot_stopped_without_close_is_advisory_not_a_violation(
    open_client: TestClient, stopped_chain: Path, two_boot_chain: Path
) -> None:
    body = _verify(open_client, stopped_chain)
    assert body["chain"]["chain_ok"] is True
    codes = [i["code"] for i in body["advisory"]["items"]]
    assert codes.count("boot_ended_without_close") == 1
    [item] = [i for i in body["advisory"]["items"] if i["code"] == "boot_ended_without_close"]
    records = _records(open_client, stopped_chain)
    first_boot = [r for r in records if r["boot_id"] == records[0]["boot_id"]]
    assert item["at_seq"] == first_boot[-1]["seq"]  # where the boot ends, unclosed
    # The closed chain carries no such item: the code is about the stop.
    closed = _verify(open_client, two_boot_chain)
    assert "boot_ended_without_close" not in [i["code"] for i in closed["advisory"]["items"]]
