#!/usr/bin/env python3
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Enforce the coverage gate: statement >= 90 and branch >= 80, together.

The thresholds live here rather than in a ``--cov-fail-under`` argument for
two reasons. First, ``--cov-fail-under`` checks statement coverage only, and a
refusal path — the token gate saying no, an anchor source reporting
unreadable — is precisely the kind of branch that statement coverage counts as
covered while never taking it. Second, keeping the numbers in a script means
the CI job name stays ``coverage`` forever, so branch protection never has to
be re-pointed when a threshold moves.

Reads ``coverage.json``, which ``pytest --cov-report=json`` writes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

STATEMENT_MIN = 90.0
BRANCH_MIN = 80.0

REPORT = Path("coverage.json")


def _branch_percent(totals: dict) -> float:
    """Branch coverage as a percentage, or 100.0 when there are no branches.

    A codebase with no branches has not failed a branch gate; reporting 0.0
    for it would block a legitimately branch-free module.
    """
    covered = totals.get("covered_branches", 0)
    total = totals.get("num_branches", 0)
    if not total:
        return 100.0
    return 100.0 * covered / total


def main() -> int:
    if not REPORT.exists():
        print(f"FAIL: {REPORT} not found — run pytest with --cov-report=json first")
        return 2

    totals = json.loads(REPORT.read_text(encoding="utf-8"))["totals"]
    statement = float(totals["percent_covered"])
    branch = _branch_percent(totals)

    ok_statement = statement >= STATEMENT_MIN
    ok_branch = branch >= BRANCH_MIN

    print(f"statement: {statement:.1f}%  (gate {STATEMENT_MIN:.0f}%)  "
          f"{'ok' if ok_statement else 'FAIL'}")
    print(f"branch:    {branch:.1f}%  (gate {BRANCH_MIN:.0f}%)  "
          f"{'ok' if ok_branch else 'FAIL'}")

    if ok_statement and ok_branch:
        return 0

    # Name the files that are pulling the number down, so the failure is
    # actionable from the log alone without re-running anything locally.
    files = json.loads(REPORT.read_text(encoding="utf-8"))["files"]
    worst = sorted(
        ((p, f["summary"]["percent_covered"]) for p, f in files.items()),
        key=lambda kv: kv[1],
    )[:5]
    print("\nlowest-covered files:")
    for path, pct in worst:
        print(f"  {pct:5.1f}%  {path}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
