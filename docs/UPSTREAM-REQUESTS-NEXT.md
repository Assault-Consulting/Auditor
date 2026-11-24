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

---

## Answers (Palimpsests, 19 November 2026)

All three are in `main` and go out with 0.15. Checked here against `main`
at `b01b015`, not taken on trust:

- **R15 — yes (#380).** `build_report(..., health=True)` (and `pala report
  --health`) fills a top-level `health` key: boots, anchors (the widest gap
  and boots without one), wall-clock steps, regressions, slews and drift,
  spans — counts and extremes, no series; each group with its `basis`; a
  `note` saying it is advisory. Without the flag the key is present and
  `null`, which means "not asked for", never "healthy". `derive_verdict`
  does not read it. `health_summary(reader)` gives the same section for a
  reader already held. Their cost on 10⁶ records: 11 s / 0.7 GB with it,
  9 s / 0.4 GB without. **Confirmed** by building a report both ways on a
  three-boot chain. E-04 is built as "show what the report says", on 0.15.
- **R16 — done (#379).** `SegmentCheck.declared_first_seq`,
  `declared_last_seq`, `declared_head` for every listed segment, present or
  not; `None` for an unlisted live tail, and for a value the manifest does
  not carry in the format's form. Declared, never verified. **Confirmed** on
  a three-segment set with the first deleted: the absent one reports
  `0`–`3` and its head.
- **R17 — declared, provisional (#379).** Channel 9, "Live reading":
  `TailingReader` (`events`, `snapshot`, `close`), `TailEvent`, and
  `TAIL_EVENT_KINDS` (`record`, `pending_tail`, `shrunk`, `recovered`,
  `anchor_seen`, `diagnosis` — an open vocabulary), in `__all__` and under
  the contract test. **Provisional**: may change in a minor release, named
  in the changelog. Known limits: every verified record kept in memory,
  `snapshot()` re-verifies them all on each call, no following a rotation
  into the next segment. It becomes public, or says why not, before 1.0 —
  and what watch mode finds decides which. **Confirmed** by import.

Also new: the serve's HTTP surface has a contract (`docs/SERVE-SURFACE.md`,
#381, open) — not used by Auditor.

Auditor's sidecar suite against `main` at `b01b015`: 470 passed, 5 skipped,
2 failed — the same two the canary's ledger lists, which leave it with
C-18.

## Status here, after the answers

- **E-04** — on 0.15: ask for `health=True`, show the report's own section
  beside E-03's series; no document of Auditor's own.
- **§22.1 follow-up** — on 0.15: a missing segment is named by its declared
  records and head ("records #0–#3, head 9f2a…, declared, not here").
- **F15, watch mode** — planned against 0.15 with the pin's minor held
  (`<0.16`), since the channel is provisional. What it finds about memory
  and `snapshot()` cost goes back upstream; that is the point of building
  it.

## R18 — `verify_statement` taking the head from the reader — **small**

24 November 2026, from E-06.

**What Auditor does.** A user holds a SCITT Signed Statement someone
published about a chain, and the issuer's key; Auditor asks
`verify_statement(message, key, expected_head, reader=reader)` whether it is
about *this* chain. The statement was usually signed when the chain was
shorter, so the expected head is this chain's record hash at the statement's
`last_seq` — which is in the payload, which is not verified yet.

**What it does now.** The seam reads `last_seq` from the payload with
`cbor2` (key 3) before verifying, only to choose which head to hand over.
That reading decides nothing — the package refuses unless the signed
payload commits to exactly that head — but it is CBOR read outside the
package, which is the line ADR-0001 draws.

**The ask.** With a reader, let `expected_head` be optional:
`verify_statement(message, key, reader=reader)` takes the head at the
payload's `last_seq` from the reader (refusing `chain_too_short` when the
chain is shorter, as the v3 root already does). The result could carry the
seq it compared at. Then the seam reads nothing.

## Measured here, for R17 (F15 on 0.15.0)

- `TailingReader` over an existing 10⁶-record file: 21.6 s to catch up,
  2.5 GB resident (~2.5 KB per record held); `snapshot()` over it 10 s.
- Auditor's watch stops itself at 250,000 records for that reason. A
  bounded mode (hold headers only, or a window) would let a watch run
  against a production log.
