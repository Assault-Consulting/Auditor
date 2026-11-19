<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Upstream requests after R14

Three requests (R15–R17), from building record health (E-03), segment sets
(§22.1) and planning watch mode. Same rules as before: none changes a
verdict or the wire format; numbering, design and timing are Palimpsests'
call; each says what was observed, on which version, and why it matters.

Checked against **0.14.1** (PyPI) and Palimpsests **`main` at `d72c026`**
(#378), 19 November 2026. Nothing here is asked of 0.15 — it is a queue for
whichever release suits.

---

## R15 — an advisory health section in the report — **question**

**Observed.** Auditor's plan has an item, E-04, "a health summary in the
report, labelled advisory". The report is the package's (`build_report`,
channel 2), and Auditor never adds to it or rebuilds it — the same reason
D-01 shows `to_json_bytes()` as it comes. So E-04 cannot be built on
Auditor's side without either changing that rule or making a second
document.

The package already computes everything such a section would hold —
`step_catalog`, `boot_statistics`, and from 0.15 `drift_series` (channel 5).
Auditor's record-health panel (E-03) shows them today, each figure under its
time basis (proved order, the monotonic clock within a boot, the writer's
wall clock), with no threshold and no verdict word.

**Why it matters.** A report that leaves the desk without the record's
health leaves out the one part a reader can judge a clock by: how often the
chain was anchored (and so how wide an external witness's brackets would
be), whether the writer's clock stepped, how the boots fell. Attached as a
second file by Auditor, it is a format Auditor owns, outside the report's
digest and the report's tests.

**Question.** Would the report carry an optional advisory section — e.g.
`health`, under `advisory` or beside it, never touching the verdict — built
from channel 5? If yes, Auditor builds E-04 as "show what the report says".
If no, Auditor drops E-04 rather than invent a document of its own.

---

## R16 — the declared range and head of a segment that is gone

**Observed (0.14.1 and `main`).** `verify_segment_set` reports a segment
listed in the manifest but not on disk as `present=False`, `verified=None`,
and puts its name in `absent`. `SegmentCheck` carries no range and no head:
`file`, `listed`, `present`, `verified`, `head_matches`, `seam_ok`, `detail`.
The module's own docstring says what the manifest declares of an absent
segment "is the only evidence left of it, and is reported as declared" —
the dataclass does not report it.

**Why it matters.** Auditor's segment-set panel can say *that* a segment is
missing but not *which records* it held — "records #0–#3, head 9f2a…,
declared, not here". That is the sentence a reader of a rotated chain
under retention needs, and the manifest has it. Reading the manifest on
Auditor's side would re-derive a package format, which ADR-0001 rules out.

**Ask.** `SegmentCheck.declared_first_seq`, `declared_last_seq`,
`declared_head` (bytes) — the manifest's entry, as declared, for every
listed segment, present or not; `None` for an unlisted live tail. Additive.

---

## R17 — is `TailingReader` public? — **question**

**Observed.** `palimpsests.audit.tailing` declares `__all__ = ["TailingReader",
"TailEvent"]` and its docstring calls it "the second surface over the one
`IncrementalVerifier`", built so "a UI can render the same three questions
in either mode". It is not in `INTEGRATION-SURFACE.md`'s channel table, on
0.14.1 or on `main`.

**Why it matters.** Auditor's watch mode (F15, Phase 5) is exactly that UI:
a running verdict, a live SAFETY feed, an alert on an unacknowledged
INCIDENT_CANDIDATE. Auditor's seam imports only declared names (C-16), so
watch mode waits on whether this is a channel.

**Question.** Is `TailingReader` meant as public — channel 1 beside
`AuditReader`, or a channel of its own — and from which release? If it is
not yet meant to be, what would make it so; Auditor will wait rather than
build on an undeclared module.

---

## Status here

- R15 decides E-04: built from the report, or dropped.
- R16: the segment-set panel (§22.1, built) names missing segments by file
  only until then.
- R17 decides whether watch mode (F15) is planned against 0.15+ or waits.
