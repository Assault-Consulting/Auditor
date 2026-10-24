# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0
"""A large fixture chain for ``scripts/bench_seam.py`` (C-10b).

Lives here, not beside the script, for the reason every fixture chain in
this directory does: it is built with the package's own writer, and
``sidecar/tests/`` is where ADR-0001's guard allows that — the script that
measures the seam must not import the package itself. Not collected by
pytest (no ``test_`` prefix); run as a program:

    python sidecar/tests/bench_chain.py /tmp/c.pala 1000000

Tool calls and their results, a model load, a SAFETY candidate and its
acknowledgement every thousand calls, an anchor every five thousand.
"""

from __future__ import annotations

import sys
from palimpsests.audit.pala_writer import PalaWriter
from pathlib import Path


def build(path: Path, n: int) -> None:
    if path.exists():
        raise SystemExit(f"{path} exists; refusing to overwrite")
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, role="engine.native")
    i = 0
    while w.seq < n:
        call = w.tool_call("tool", args_digest=i.to_bytes(32, "little"))
        w.tool_result(w.seq - 1, call, 0, result_digest=b"\x02" * 32)
        i += 1
        if i % 1000 == 0:
            cand_seq = w.seq
            cand = w.incident_candidate(1, 2, detail="guard refusals exceeded")
            w.oversight_ack(cand_seq, cand, 0, b"\x07" * 16)  # DISP_ACKNOWLEDGED
        if i % 5000 == 0:
            w.anchor()
    w.close()


if __name__ == "__main__":
    build(Path(sys.argv[1]), int(sys.argv[2]))
