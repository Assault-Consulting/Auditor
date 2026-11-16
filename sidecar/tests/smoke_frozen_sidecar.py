# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Start the frozen sidecar and check it answers the way the source does.

A frozen build can import cleanly and still be missing what it reads at run
time — the package's metadata, its published vectors, a lazily imported
module. This drives the binary through the paths an installed application
takes on its first minute, against a chain written by the package's own
writer and one altered after writing:

    python sidecar/tests/smoke_frozen_sidecar.py dist/auditor-sidecar.exe

Kept with the tests, and not named test_*: it writes fixtures with the
package's writer, as the tests do (the ADR-0001 scan exempts this tree for
that), and it runs against a binary, so pytest does not collect it.

Exit 0 when every answer is as expected; otherwise the first difference is
printed and the exit is 1. Needs `palimpsests` importable here, to write the
fixtures — not in the binary's environment.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

TOKEN = "smoke-token-not-a-secret"
PORT = 8791


def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def fixtures(where: Path) -> tuple[Path, Path]:
    from palimpsests.audit.pala_writer import PalaWriter

    sound = where / "sound.pala"
    w = PalaWriter(sound)
    w.genesis()
    w.boot()
    w.incident_candidate(category=1, severity=2, detail="A" * 16)
    w.anchor()
    w.close()
    altered = where / "altered.pala"
    data = sound.read_bytes()
    i = data.index(b"A" * 16)
    altered.write_bytes(data[:i] + b"B" * 16 + data[i + 16 :])
    return sound, altered


def main(binary: str) -> int:
    work = Path(tempfile.mkdtemp(prefix="auditor-smoke-"))
    sound, altered = fixtures(work)
    env = {
        **os.environ,
        "AUDITOR_SIDECAR_TOKEN": TOKEN,
        "AUDITOR_SIDECAR_PORT": str(PORT),
        "AUDITOR_WITNESS_LOG": str(work / "witness.jsonl"),
    }
    proc = subprocess.Popen([binary], env=env)
    try:
        started = time.monotonic()
        while True:
            try:
                status, health = call("GET", "/health")
                if status == 200:
                    break
            except OSError:
                pass
            if proc.poll() is not None:
                print(f"the sidecar exited with {proc.returncode} before answering")
                return 1
            if time.monotonic() - started > 60:
                print("the sidecar did not answer /health within 60 s")
                return 1
            time.sleep(0.5)
        print(f"/health after {time.monotonic() - started:.1f} s: {health}")

        checks: list[tuple[str, bool]] = []
        for path, expect_mismatch in ((sound, False), (altered, True)):
            status, opened = call("POST", "/session", {"path": str(path)})
            checks.append((f"open {path.name} → {status}", status == 201))
            if status != 201:
                break
            sid = opened["session_id"]
            status, v = call("GET", f"/session/{sid}/verify")
            mismatches = v.get("container", {}).get("body_digest_mismatches", [])
            checks.append((f"verify {path.name} → {status}", status == 200))
            checks.append((f"{path.name}: chain_ok", v.get("chain", {}).get("chain_ok") is True))
            checks.append(
                (
                    f"{path.name}: body digest mismatches {mismatches}",
                    bool(mismatches) is expect_mismatch,
                )
            )
            checks.append((f"{path.name}: witnessed", v.get("witness", {}).get("hash") is not None))
            status, report = call("GET", f"/session/{sid}/report")
            report_ok = status == 200 and "html_text" in report
            checks.append((f"report {path.name} → {status}", report_ok))
            status, _ = call("GET", f"/session/{sid}/record/1/bytes")
            checks.append((f"record bytes {path.name} → {status}", status == 200))
        status, w = call("GET", "/witness")
        checks.append((f"witness log: {w.get('entries')} entries link", w.get("entries") == 2))
        status, _ = call("GET", "/health")

        failed = [name for name, ok in checks if not ok]
        for name, ok in checks:
            print(("ok   " if ok else "FAIL ") + name)
        return 1 if failed else 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
