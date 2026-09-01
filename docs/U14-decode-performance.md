<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# U14 — record-decode and verify performance (revision -01)

A revision, not a first draft: an earlier working version of this
investigation existed only as a local file during the session that produced
it and was never committed to this repository. Everything in that version
that still holds is restated here rather than assumed known; six things in
it turned out to need correcting, one of them a directly refuted
conclusion. This is the first version of this document this repository
actually has.

Scope: what closes on this side (Auditor), and what stays open, tracked
separately, in the corresponding Palimpsests-side plan — not detailed here,
by design, since building or scoping the upstream fix is that plan's job,
not this document's.

## Status at a glance

| # | Finding | Status |
|---|---|---|
| 1 | `_decoded_records()`'s cache has no lock: concurrent callers each decode the whole chain independently | **Closed here** — A1, PR #54 |
| 2 | `build_report()` reads the whole file and hashes every body unconditionally, `reader=` or not | Open, upstream |
| 3 | `AuditReader`'s own module docstring says `verify()` is header-only; it is not | Open, upstream |
| 4 | An all-encrypted chain still pays a real per-record cost for a referential-advisories result that is always empty | Open, upstream — not yet measured against a real fixture |
| 5 | `_walk()`'s own header/span copies cost real memory before any decode happens | Open, upstream — estimated, not measured |
| 6 | `acknowledged_candidates()` / `shredded_targets()` each build an additional full mapping over the cached record list | Open, upstream — not re-benchmarked at 1M-record scale since they landed |

The original measurements this investigation started from — a 100k-record /
22.4 MB fixture at 4.9 s / 460 MB peak RSS, and a 224 MB / 1,000,004-record
fixture killed by the OS mid-`verify` on a 3.9 GB machine — are unchanged
and are not repeated in full here; they are in `DEVELOPMENT-PLAN.md`'s own
U14 entry and its C-10 writeup.

## 1. The race — closed here

**What was wrong.** The original investigation timed three concurrent
calls (`records`, `safety`, `timeline`) against one freshly opened session
and concluded they did not compound the decode cost — "consistent with
CPython's GIL serialising the underlying CPU-bound work". That conclusion
was reproduced and found wrong: `_decoded_records()` checks
`self._decoded is None` and, if so, builds the whole list before assigning
it — a window wide enough, on a chain large enough to take real decode
time, for every concurrent caller to see the cache unset and start its own
full build.

**Measured directly against the package**, not through the sidecar, on a
100k-record fixture: three concurrent calls made `AuditReader._decode`
run 300,006 times for 100,002 records — exactly 3× — and took 6.8 s
against 1.66 s for one call alone, worse than plain sequential (~5.0 s),
not "serialized for free" by anything.

**What closed it.** `ChainHandle` (`pala_seam.py`) now holds a
`threading.RLock` and takes it around every one of its own touches to
`self._reader` — twelve call sites across nine methods, enumerated by
`grep`, not from memory. `RLock` rather than `Lock`: `verify()` calls
`self.container()` directly, and while `container()` does not yet touch
`self._reader` itself (its `build_report` call opens an independent
reader — see finding 2), the moment it is wired to pass `reader=` that
call would need the same lock from the same thread. A regression test
(`test_concurrent_requests_do_not_each_redecode_the_chain`) reproduces
the race on a 5-record fixture via a per-record monkeypatched delay
rather than a large real one, and asserts the decode count stays at
record count under five concurrent HTTP requests.

**What this does not close.** The lock is scoped to this shell's own
access pattern. `AuditReader` itself still documents no thread-safety
contract and still has no lock of its own — a different consumer of the
package, or a future caller here that bypasses `ChainHandle`, would hit
the same race. Worth raising upstream; not detailed further here.

PR: Assault-Consulting/Auditor#54.

## 2. `build_report()`'s own unconditional cost

**Observed**, reading the function directly rather than assumed from its
own `reader=` parameter's docstring: `raw = path.read_bytes()` and the
`iter_records(raw)` walk that follows — computing `body_digest_of(body)`,
a SHA-256 over every record's body — both run **before** the function
checks whether a `reader` was supplied, and neither is skipped when one
was.

**Why it matters.** `reader=` (Assault-Consulting/Palimpsests#198) avoids
a second `AuditReader.open()` and its own full decode when a caller
already holds one open. It does not avoid this separate cost: a full
read of the file into memory, plus a full-body SHA-256 pass, happen on
every `build_report()` call regardless. On the 224 MB / 1,000,004-record
fixture, that is a second 224 MB allocation and roughly a million SHA-256
calls, independent of anything `reader=` changed.

**Status here.** Not addressed by A1, and not currently reachable from
Auditor's own code path in a way that matters yet: `ChainHandle
.container()` does not call `build_report()` with `reader=` at all today
(a separate, already-noted follow-up in `DEVELOPMENT-PLAN.md`'s U14
entry) — so this specific cost is paid unconditionally either way right
now. Worth naming precisely for when that follow-up lands, so it is not
mistaken for a complete fix at that point.

## 3. `verify()` does not keep its own module's claim

**Observed.** `reader.py`'s own module docstring: "record bodies are
decoded lazily and only when a caller asks for records, spans, boots, or
origins — `verify()` is header-only." `verify()` itself calls
`self._referential_advisories()`, which calls `self._decoded_records()`
— a full body decode, unconditionally, every time `verify()` is called.

**Why it matters.** This predates this session's own work here — it is
not something U13/U15 introduced — but it means the one method this
whole investigation keeps measuring the cost of is, by the package's own
documentation, not supposed to have that cost at all. For a project
mapping to Art. 12 and moving toward an IETF submission, a verifier
whose own docstring disagrees with its own behaviour is a defect worth
more than the performance number attached to it.

**Status here.** Nothing to close on this side — this is a fact about
the package's own contract, not about how Auditor calls it.

## 4. An encrypted chain's real cost, restated more precisely

**The original framing overstated this.** An earlier reading of
`decode_record()`'s `if header.key_id == 0 and body:` gate described an
all-encrypted chain as paying "full decode" for a referential-advisories
result that is always empty (since `kind` never resolves without a
cleartext body). That is not quite what the code does.

**What actually happens, read precisely.** The `key_id == 0` gate skips
`decode_tlvs` and kind resolution specifically — the TLV/body-value
decode. It does **not** skip `Header.decode(hb)` or `record_hash(hb)`
(U10), both of which run unconditionally for every record regardless of
encryption. `_decoded_records()` still builds one `DecodedRecord` per
record either way. So the real cost is: a full header parse plus a hash
computation plus a full list of `DecodedRecord` objects, for a
referential-advisories pass that is provably always empty on such a
chain — a smaller claim than "full decode", and still a real one.

**Status here.** Not independently measured against an actual encrypted
fixture — building one needs real key material this investigation did
not set up. The claim above is read from source, not timed. Worth an
actual measurement before treating the magnitude as known.

## 5. `_walk()`'s own memory cost, before any decode

**Observed.** `_walk()` — the header-only container scan `verify()`
correctly does lazily — copies every record's header into its own
`bytes` object (`self._headers.append(bytes(data[off:off+hlen]))`) and
appends a `(start, end)` tuple to `self._body_spans`, for every record,
on construction.

**Estimated, not measured.** For 1,000,004 records at a 156-byte fixed
header: roughly 190 bytes of Python object overhead per header `bytes`
object, plus roughly 112–120 bytes per `(int, int)` span tuple (two
uncached large ints plus tuple overhead) — on the order of 300–330 MB
before a single body is ever decoded. The "cheap 1.9 s scan" this
investigation's own earlier numbers describe is cheap in time; this is
the cost the same scan carries in memory, which those numbers did not
separately name.

**Status here.** An estimate from reading the allocation pattern, not a
`tracemalloc` measurement. Worth confirming with one before treating the
number as more than an order-of-magnitude guess.

## 6. U13/U15 add memory, not CPU, on top of an already-expensive path

**Observed.** `acknowledged_candidates()` (U13, Palimpsests#199) and
`shredded_targets()` (U15, Palimpsests#203), both built and merged this
session, each construct their own full mapping — a `dict` keyed by
every record's `seq` — over `self._decoded_records()`. Within one
`verify()` + `build_report()` call this is not a redecode:
`_decoded_records()` is cached by the time either of these runs, so
the cost is dict/tuple construction, not `Header.decode` or
`decode_tlvs` running again.

**Why it matters anyway.** `_referential_advisories()` already builds
its own `by_seq` mapping independently; these two add a second and a
third, each sized to the record count. On a 1,000,004-record chain that
is real, additional memory — bounded by dict/tuple overhead per record,
not by anything approaching a second decode — layered onto a path that
was already the single most memory-expensive one in the codebase before
either method existed. Neither was benchmarked against the 224 MB /
1,000,004-record fixture that originally OOM'd; whether they meaningfully
move that number, or are noise next to `_walk()`'s and `_decoded_records
()`'s own cost, is not yet known.

**Status here.** Not measured at the scale that matters. Flagged rather
than fixed: reusing `_referential_advisories()`'s own `by_seq` across
all three call sites, or dropping the header-bytes half of its tuple
now that U10 gives every `DecodedRecord` its own cached hash, are real
simplifications — noted and deliberately left unbuilt when U10 landed
(Assault-Consulting/Palimpsests#200's own PR description), for the same
reason repeated here: touching that code again for a saving this small,
without the maintainers in the room, was judged more risk than the win
was worth.

## What this document does not decide

Whether §19's "100 MB / ~1M-record chain verifies in under 10 s" target
is reachable at all in pure CPython, given the sum of every cost named
above plus whatever remains after fixing them, is not answered here. It
depends on profiling this document does not contain — where the time in
the original 24 s actually goes, which of findings 2–6 turn out to
matter at scale and which are noise. That is upstream's own work,
already scoped separately. This document's job was narrower: say
precisely what closed here (finding 1), and say precisely, without
overclaiming or underclaiming, what did not.
