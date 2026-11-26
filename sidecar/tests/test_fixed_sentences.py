# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""R19: the report's fixed sentences, by name.

The seam gives `vocabulary()` the package's NOTES and HEALTH_BASES. On
0.15.0, which has neither, it gives its own copy of what 0.15.0 writes.
Both must be the package's words letter for letter: the English catalog is
held to this table, so a copy that drifted would put words in the
package's mouth.
"""

from __future__ import annotations

import importlib
from auditor_sidecar import pala_seam
from pathlib import Path


def test_the_table_is_the_package_s_when_the_package_has_one() -> None:
    report = importlib.import_module("palimpsests.audit.report")
    if hasattr(report, "NOTES"):
        assert dict(pala_seam.NOTES) == dict(report.NOTES)
        assert dict(pala_seam.HEALTH_BASES) == dict(report.HEALTH_BASES)


def test_every_sentence_is_what_the_report_writes(chain_path: Path) -> None:
    """Held to a report the package builds now, on whichever release is
    installed: the copy for 0.15.0 cannot drift from 0.15.0's text."""
    from palimpsests.audit.report import build_report

    report = build_report(chain_path, health=True).data
    assert report["checked_at"]["note"] == pala_seam.NOTES["checked_at"]
    assert report["health"]["note"] == pala_seam.NOTES["health"]
    bases = {g["basis"] for g in report["health"].values() if isinstance(g, dict) and "basis" in g}
    assert bases <= set(pala_seam.HEALTH_BASES.values())
    if "note_id" in report["checked_at"]:  # 0.15.1 names them in the report
        assert report["checked_at"]["note_id"] == "checked_at"


def test_the_vocabulary_carries_them() -> None:
    v = pala_seam.vocabulary()
    assert v["notes"]["advisory"] == "advisory items do not affect the verdict"
    assert set(v["health_bases"]) == {"proved_order", "monotonic_in_boot", "wall_against_monotonic"}
