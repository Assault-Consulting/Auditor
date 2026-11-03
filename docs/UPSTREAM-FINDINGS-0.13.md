<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Upstream findings against palimpsests 0.13.1

Two costs found while moving Auditor's seam onto the 0.13 reading surface
(C-10b(b)). Both are inside `palimpsests.audit.reader`, not in this
repository, so they are written down here for Palimpsests development and
are **not** worked around on this side: a workaround would mean reading
wire bytes or private reader state, which ADR-0001 rules out.

Track U is Palimpsests' work (`docs/CONSUMER-SURFACE.md` r2 in that
repository). This document proposes nothing about how to fix either
finding; it states what was measured, how to reproduce it, and where in
the package the cost comes from.

## Setup

- palimpsests **0.13.1** (tag `v0.13.1`), Python 3.12, Linux.
- One chain of **1,000,000 records / 246 MB**, built with the package's own
  writer by `sidecar/tests/bench_chain.py`: a genesis, a boot, a model
  load, then tool calls each followed by its tool result, a SAFETY
  candidate and its acknowledgement every thousand calls, an anchor every
  five thousand. About half the records are TOOL_RESULTs, each referencing
  the TOOL_CALL before it — the ordinary shape of an agent's log.

```
python sidecar/tests/bench_chain.py /tmp/m1.pala 1000000
```

Every figure is one call in a fresh process; peak RSS is the process's.

## Finding 1 — `AuditReader.verify()` decodes and keeps every tool loop

| | Time | Peak RSS | Records left in the sparse cache |
|---|---|---|---|
| `AuditReader.verify()` on a fresh reader | **32.5 s** | **2.47 GB** | **999,898** |
| `build_report(path, reader=r)` after it | 4.1 s | (same) | (same) |

```python
from palimpsests.audit.reader import AuditReader
r = AuditReader.open("/tmp/m1.pala")
r.verify()
len(r._partial)   # 999898 — inspected only to explain the RSS
```

**Where it comes from.** `_referential_advisories()` (reader.py, v0.13.1
line 838) decodes every record whose kind is in `_REFERENCING_KINDS`
(line 343: INCIDENT_CANDIDATE, OVERSIGHT_ACK, **TOOL_RESULT**,
GUARD_TOOL_LOOP_LIMIT) and every record they name. On a chain of tool
loops that is every result and every call — the whole chain. Each decode
goes through `_record_at()` (line 1342), which stores the
`DecodedRecord` in `self._partial` (line 670) with no bound, so the
records stay resident after the check that needed them is done.

**Why U14 did not see it.** U14's 0.12.0 measurement (verify +
`build_report(reader=)`: 11.3 s / 421 MB at 1M) used a chain without tool
calls. The pass is bounded by the number of references, as its docstring
says; on an agent's log the number of references is about half the
records.

**What it costs a consumer.** Opening a 1M-record session in Auditor now
takes under a second (C-10b(b)); pressing Verify on the same file takes
35.6 s and 2.4 GB, all of it inside this call.

**Two separate questions for Palimpsests**, either of which would change
the figure:
1. whether the referential pass needs to *keep* what it decoded — the
   check reads a reference and its target, and nothing after it uses
   them;
2. whether the sparse cache should be bounded at all, since any consumer
   that pages through `record_at()` grows it the same way.

## Finding 2 — no way to read a record's kind without decoding it

Auditor's records list filters by kind (`kind:TOOL_RESULT`), by evidence
mark (`source:`) and by tool outcome (`outcome:`). All three are body
fields. 0.13's public surface reaches them only through a full
`DecodedRecord`:

| Over 1M records | Time | Peak RSS |
|---|---|---|
| `record_at(i).kind_name` for every `i` | **21.9 s** | **2.04 GB** (1,000,000 records cached) |
| `header_at(i)` for every `i` (for comparison) | 3.2 s | 267 MB |

The reader already has the cheap path internally: `_kind_probe()` (line
1483) reads `EVT_KIND` from a cleartext body's first TLV in place, without
copying the body. It is private, so a consumer may not call it, and
Auditor's body filters therefore still decode the chain — the one browse
path C-10b(b) could not bound.

**The question for Palimpsests:** whether the kind (and, for the same
reason, the source mark and the tool outcome) should be readable per
record without a full decode — as a header-index-style accessor or
otherwise — or whether consumers should treat body filters as
inherently O(n) decode and say so.

## What Auditor does meanwhile

- Opening, browsing, the timeline, the nearest-instant jump, a single
  record and the SAFETY list do not touch either path (C-10b(b);
  `sidecar/tests/test_bounded_paths.py` fails if one of them decodes the
  chain).
- Body filters and Verify keep calling the package as they did, and cost
  what the tables above say. Nothing here reads private reader state or
  wire bytes to avoid it.
- The two figures are in `DEVELOPMENT-PLAN.md`'s C-10b row and will be
  re-measured with `scripts/bench_seam.py` on the release that changes
  either.
