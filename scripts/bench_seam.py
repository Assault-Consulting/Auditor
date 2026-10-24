#!/usr/bin/env python3
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0
"""C-10b — what each seam call costs on a large chain, measured.

FUNCTIONALITY.md §19 sets the size envelope: a ~1M-record chain opens, the
timeline stays interactive. This measures it through the seam the sidecar
serves, one call per fresh process, so every figure is a cold reader's
cost and its own peak RSS — the cost a person pays the first time they ask.

    python scripts/bench_seam.py build  /tmp/c.pala 1000000
    python scripts/bench_seam.py run    /tmp/c.pala

Run it from an environment where the sidecar is installed (``pip install -e
sidecar``): every call goes through ``auditor_sidecar.pala_seam``, and the
table names the ``palimpsests`` version that environment resolved.

``build`` has ``sidecar/tests/bench_chain.py`` write the chain with the
package's own writer — the fixture lives there because only the seam and
the tests may import the package — then writes a ``.meta.json`` beside it
with a mid-chain seq and wall-clock instant, chosen through the seam, so
``run`` does not have to decode the chain to choose what to ask.

``run`` prints a Markdown table: for each call, the open (which the seam
pays on every session) and the call itself, separately, and the process's
peak RSS. Nothing here is a pass/fail gate; the numbers go into the plan's
C-10b row, before and after the seam moves onto the 0.13 paths.
"""

from __future__ import annotations

import json
import resource
import subprocess
import sys
import time
from pathlib import Path

CALLS = [
    "open_only",
    "subject",
    "boots",
    "spans",
    "records_first_page",
    "record_mid",
    "origin_mid",
    "safety",
    "timeline",
    "nearest_mid",
    "verify",
]


def build(path: Path, n: int) -> None:
    from auditor_sidecar.pala_seam import open_chain

    # The chain is written by the package's writer, which only the seam and
    # sidecar/tests/ may import (ADR-0001's guard); the fixture builder lives
    # there and runs as its own process. This script measures; it never
    # writes PALA-1 itself.
    builder = Path(__file__).resolve().parent.parent / "sidecar" / "tests" / "bench_chain.py"
    subprocess.run([sys.executable, str(builder), str(path), str(n)], check=True)
    # Chosen through the seam, as everything else here is; paid once, at build.
    h = open_chain(path)
    subject = h.subject()
    mid_seq = subject["first_seq"] + subject["records"] // 2
    mid = h.record(mid_seq)
    h.close()
    meta = {
        "records": subject["records"],
        "bytes": path.stat().st_size,
        "mid_seq": mid_seq,
        "mid_wall_ns": str(mid["wall_clock_ns"]),
    }
    Path(f"{path}.meta.json").write_text(json.dumps(meta))
    print(json.dumps(meta))


def one(path: Path, call: str) -> None:
    from auditor_sidecar.pala_seam import open_chain

    meta = json.loads(Path(f"{path}.meta.json").read_text())
    t0 = time.perf_counter()
    h = open_chain(path)
    t_open = time.perf_counter() - t0
    t1 = time.perf_counter()
    if call == "subject":
        h.subject()
    elif call == "boots":
        h.boots()
    elif call == "spans":
        h.spans()
    elif call == "records_first_page":
        h.records(offset=0, limit=50)
    elif call == "record_mid":
        h.record(meta["mid_seq"])
    elif call == "origin_mid":
        h.origin(meta["mid_seq"])
    elif call == "safety":
        h.safety()
    elif call == "timeline":
        h.timeline()
    elif call == "nearest_mid":
        h.nearest(int(meta["mid_wall_ns"]))
    elif call == "verify":
        h.verify()
    t_call = time.perf_counter() - t1
    rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    if sys.platform == "darwin":  # ru_maxrss is bytes on macOS, KiB on Linux
        rss_mb /= 1024
    h.close()
    print(json.dumps({"call": call, "open_s": t_open, "call_s": t_call, "rss_mb": rss_mb}))


def run(path: Path) -> None:
    meta = json.loads(Path(f"{path}.meta.json").read_text())
    import importlib.metadata as md

    version = md.version("palimpsests")
    print(f"palimpsests {version}; {meta['records']:,} records, {meta['bytes'] / 1e6:.0f} MB\n")
    print("| Call | Open | Call | Peak RSS |")
    print("|---|---|---|---|")
    for call in CALLS:
        out = subprocess.run(
            [sys.executable, __file__, "one", str(path), call],
            capture_output=True,
            text=True,
        )
        if out.returncode != 0:
            print(f"| `{call}` | failed: {out.stderr.strip().splitlines()[-1]} | | |")
            continue
        row = json.loads(out.stdout.strip().splitlines()[-1])
        call_cell = "—" if call == "open_only" else f"{row['call_s']:.2f} s"
        print(f"| `{call}` | {row['open_s']:.2f} s | {call_cell} | {row['rss_mb']:.0f} MB |")


if __name__ == "__main__":
    cmd, target = sys.argv[1], Path(sys.argv[2])
    if cmd == "build":
        build(target, int(sys.argv[3]))
    elif cmd == "one":
        one(target, sys.argv[3])
    elif cmd == "run":
        run(target)
    else:
        raise SystemExit(f"unknown command {cmd!r}")
