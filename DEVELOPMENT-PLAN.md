<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Development plan

Scope reference: `FUNCTIONALITY.md`. Structure reference: `ARCHITECTURE.md`.

## 0. How to read this plan

Effort is stated in **working days of focused effort**, never calendar
dates. This is a small team with more than one project, so a plan pinned to
dates is wrong by week two; a plan pinned to effort stays usable however
the calendar moves.

Work is ordered by **dependency**, not by visibility. Track U comes first
because half the later phases cannot be built without it, not because it
demos well. Where a dependency and an impressive screenshot disagree, the
dependency wins.

Every phase ends with an exit criterion that can fail. A phase without a
falsifiable exit criterion is a wish, and none are written that way here.

**What this plan does not model.** Of the fifteen branches merged through
Phase 0 and the first half of Phase 1, **six were not in it** — governance
corrections, the plan-versus-specification sync, the branch verification
script, a fix to that script, and two rounds of CI robustness after an Ubuntu
mirror took down five runs in a day. Forty per cent.

Almost none of that was scope creep. Most of it was either correcting a claim
this plan or its sibling documents made about themselves, or repairing
something that was blocking every other item. But the estimates below cover
only the numbered work, so a phase costed at 22.5 days has historically taken
closer to 30. That figure is stated here rather than folded into the
estimates, because inflating each item would hide which ones are actually
expensive.

**An estimate that turns out to describe the wrong work is replaced by a
question mark, not by a smaller number.** Phase 3 is the first case: U6
closed upstream and the package now produces the report this plan had Auditor
building. Substituting an invented figure would be the same overclaim in the
other direction.

## 1. Governance — inherited, not re-decided

Same discipline as Palimpsests, because a compliance tool with sloppy
provenance is self-refuting:

- Every change via a **non-draft PR** with **non-author review**
  (Oleksandr). No direct commits to `main`, including docs.
- DCO sign-off on every commit.
- REUSE-compliant headers on every file; `reuse lint` in CI.
- `ruff` pinned to the exact version CI runs. Local and CI must agree
  byte-for-byte on lint.
- Coverage gate on the sidecar: statement ≥ 90, branch ≥ 80, same as
  upstream.
- Release tagging by the non-author of the version-bump PR, satisfying
  two-person review.
- Commits, comments, docs and PR text in English. Working discussion in
  Ukrainian.

## 2. Track U — upstream, in `Assault-Consulting/Palimpsests`

These are prerequisites, not nice-to-haves: building them in the shell
violates invariant L1. Each is an ordinary PR into the upstream repo, and
each is independently useful there (the CLI and any third-party verifier
get them too).

An item becomes usable here at its **release**, not at its merge: Auditor
installs `palimpsests` from PyPI, and Palimpsests cuts releases on its own
schedule rather than this project's.

| PR | Content | Days | Blocks |
|---|---|---|---|
| U1 | Drift series per boot as structured advisory output: `d_i = (wall_i − wall_0) − (mono_i − mono_0)`, slope in ppm. Pure arithmetic on existing header fields, O(n), no wire change. | 2 | F6, F12 |
| U2 | Step catalog: each detected discontinuity with magnitude, direction, `seq`, classified slew / step / regression. | 2 | F6, F12 |
| U3 | Per-boot statistics: record counts, uptime by monotonic, anchor cadence and lag distribution, span durations, open-span rate. | 2 | F12 |
| U4 | Header field map exported for rendering, so a hex inspector can highlight fields without knowing offsets. | 1 | F7 |
| U5 | Merkle inclusion proofs for a `seq` range, over the existing RFC 6962 aggregation. | 3 | F13 |
| U6 | Verification-report model as a package dataclass — one owner for the `pala-verification-report/1` schema. | 2 | F11 |
| U7 | `time_trust` / `assurance_tier` constant→name tables exported, following the §10.5 pattern already used for kinds. | 0.5 | F2, F6 |
| U9 | Ship the published vectors — core and inference-profile — in the distribution, behind one accessor. A vector set reachable only by cloning the repository is checkable only by those who least need to check it, which is the opposite of what publishing one is for. Cheap, and it unblocks the conformance half of B-10. | 1 | B-10(b) |
| U8 | Evidence-bundle assembly as a library command (`pala bundle`): records + inclusion proofs + verification + manifest + the explicit time-claims section. By this plan's own Track-U criterion — independently useful without the shell (any CLI user or third-party tool gets it) — assembly belongs upstream; the shell invokes and presents (E-01). | 4 | E-01 |
| U10 | A record's own hash, on `DecodedRecord`. `Header.prev_hash` and `Header.body_digest` are already there; the record's own hash is not, because nothing downstream of `decode_record` keeps the header bytes `pala.record_hash(header_bytes)` needs. Computed once during decode, from bytes the reader already has and discards, and cached on the dataclass — not re-derived by any caller. Confirmed against the installed 0.10.0 wheel by reading `palimpsests.audit.reader` directly rather than assumed. | 1 | C-06c |
| U11 | `origin_at()` to distinguish "never declared" from "declared, then unloaded". Read directly rather than assumed: a `KIND_MODEL_UNLOAD` sets the running origin to `None`, exactly the value it starts at before any `MODEL_LOAD` — the two collapse. F9 asks for different wording for each ("not stated in this file" vs "no model active"); producing that distinction on this side of the seam would mean re-walking records for the last unload ourselves, the second-implementation mistake ADR-0001 rules out. | 1 | C-08(b) |
| U12 | `detail` decoded from `EVT_DETAIL` onto `DecodedRecord`, the same way `origin_at()` already decodes named TLV fields into `OriginView` rather than leaving them as raw bytes. Confirmed present and readable: the reader's own `body_tlvs` already carries `(type, value)` pairs for a cleartext body, and `EVT_DETAIL = 4` is a published constant — nothing to discover, only to expose. Blocks F8's detail text and its recurrence count, and separately unblocks half of C-09d (free text still needs §22.3 decided). | 1 | C-07b, C-09d(b) |
| U13 | Acknowledged/unacknowledged state for `INCIDENT_CANDIDATE` records — `AuditReader.acknowledged_candidates()`, hash-verified through the same resolution `_check_reference` already used for the *broken*-reference advisory codes. **Built and merged to Palimpsests `main`** (Assault-Consulting/Palimpsests#199), not yet released — this repository installs from PyPI, so it stays unusable here until a release is cut. The `U10` dependency in the original scoping was wrong, confirmed by actually building this: the package resolves a target's hash from the raw header bytes it already holds (`self._headers`), never from a `DecodedRecord.record_hash` field — U10 remains needed only for showing a record's own hash in Auditor's UI (C-06c), not for this resolution. | 1 | C-07c(a) |
| U15 | The rest of the r2 oversight loop `U13`'s original scope named but did not build: an `OVERSIGHT_ACK`'s `operator_id` and deadline delta, and `KEY_SHRED` target resolution. Not investigated to the depth `U13`'s acknowledged-state half was — the writer accepts `disposition`/`operator_id` (confirmed: `PalaWriter.oversight_ack`'s signature), but whether the reader already exposes them per-record, or a further reader-side accessor is needed the way `acknowledged_candidates()` was, has not been checked against source. | ? | C-07c(b) |
| U14 | Record-decode and verify performance at the scale §19 itself targets. `AuditReader.records()`'s underlying `_decoded_records()` is not the incremental generator its `yield from` syntax suggests — it is an eager list comprehension over every header, computed in full before the first item is yielded, cached afterward. Measured, not assumed: on a synthetic 100k-record / 22.4 MB chain, `open_chain` plus `ChainHandle.verify` (header verify plus `build_report`'s body-digest walk) together cost 4.9 s and reached a peak RSS of 460 MB — roughly 20.6× the file's own size. At 224 MB / 1,000,004 records — a chain slightly *larger* than §19's own "100 MB / ~1M-record" target — the same flow exceeded 3.9 GB of RAM and was killed by the OS before finishing. One partial mitigation is **built and merged** (Assault-Consulting/Palimpsests#198): `build_report()` now accepts an already-open reader, so a caller who already paid the decode once does not pay it a second time inside `build_report`'s own separately-opened reader — Auditor's own `ChainHandle.container()` does not call it with `reader=` yet, a small follow-up once the release lands (§5 below). The actual cause — `_decoded_records()`'s eager, eventually-shared-but-not-yet-incremental cache — has a worked design (a lock-protected generator that decodes and caches one record per index, so an early-exiting caller like `origin_at` or a single-record lookup pays only for what it reads, while a full walk still gets the same shared cache it has today) but touches six call sites including the r2/r3 advisory resolution `U13`/`U15` depend on, and introduces the first concurrency primitive this class has needed — deliberately left unbuilt rather than rushed, matching the package's own documented stance (`docs/INTEGRATION-SURFACE.md`: "a streaming reader is backlog, not promise"). | ? | C-10b |

**Track U total: ~21.5 days plus U14 and U15** (~17.5 without U8, which
blocks only Phase 4). U14 and U15 carry no number: neither is a feature
to scope but an investigation whose shape is not yet known — inventing
a duration would be the same overclaim C-06d's `?` already refuses to
make. U7, U4 and U1 are the cheap ones and should land first — U7 in
particular is half a day and removes a whole class of "the shell
re-typed a constant" defects.

Note on U1–U3: these must be **advisory** output, never verdict fields.
The existing `Advisory` channel shape is already fixed for exactly this
kind of extension.

**Status against 0.10.0 and after.** U1–U4, U6, U7 and U9 are released;
U5 and U8 are in the wheel as `proofs` and `bundle`. U13's acknowledged-
state half and U14's reader-reuse mitigation are merged to Palimpsests
`main` but not yet released — built directly, from this side, once the
gap each closes was found (§5 below has the full account). Three further
upstream items have landed since the 0.10.0 release that this plan did
not ask for and cannot ignore: PKCS#11 anchors, writer rotation, and
SCITT registration. Each is accounted for where it lands — the first two
in §5, the third in §5 and Phase 4.

## 3. Phase 0 — scaffold

Target: a window that opens, a frontend that renders, a sidecar that
boots and answers `/health`, green CI on three OSes. Nothing about PALA-1
yet.

| PR | Content | Days |
|---|---|---|
| A-01 | Repo skeleton: `README`, `FUNCTIONALITY.md`, `ARCHITECTURE.md`, `ENVIRONMENT.md`, `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `GOVERNANCE`, `REUSE.toml`, `.gitignore`, `.gitattributes` | 1 |
| A-02 | Frontend: Vite 5 + React 18 + TS 5, fixed dev port 1420, `tsconfig` strict | 1 |
| A-03 | Tauri 2 shell: `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, placeholder icon generator | 1 |
| A-04 | Sidecar: FastAPI on `127.0.0.1:8771`, `/health`, `pyproject.toml`, ruff + pytest config | 1 |
| A-05 | CI: 3-OS matrix, ruff, pytest, coverage gate, `reuse lint` | 1 |
| A-06 | Sidecar lifecycle from Tauri: spawn, per-launch bearer token, health poll, graceful shutdown, orphan cleanup | 2 |
| A-07 | Generated typed API client from the sidecar OpenAPI schema; the frontend calls `/health` through it | 1 |

**Phase 0: ~8 days.** Known CI traps to encode from the start, all of
which have cost a red build before: build the frontend *before*
`cargo check` (the context macro embeds `frontendDist` at compile time);
generate `icon.ico` even when bundling is off; do not add an empty
`.setup(|_app| Ok(()))`; install the Linux webkit/appindicator/rsvg
system packages explicitly.

**Exit criterion:** green CI on macOS, Linux and Windows; the app starts
and shows the sidecar version and the `palimpsests` version it links
against.

## 4. Phase 1 — Verify

The product's minimum viable claim: open a file, get an honest verdict.

| PR | Content | Days | Needs |
|---|---|---|---|
| B-01 | `pala_seam.py` — the single import surface; session store; `POST /session`, file digest, subject metadata | 2 | — |
| B-02 | The no-parsing CI test (§20.2) | 0.5 | B-01 |
| B-03 | `GET /verify` returning `Verification` verbatim; per-(session, profile) cache | 2 | B-01 |
| B-04 | Anchor profiles: manual, file; `ChainedAnchorSource` composition; `/anchors/*` endpoints | 2 | B-03 |
| B-10 | Agreement suite against `palimpsests pala verify` (§20.1a), plus the conformance half skipped pending U9 (§20.1b) | 2 | B-03 |
| B-05 | Keychain anchor source (`keyring`), three OSes | 2 | B-04 |
| B-06a | Frontend can open a file: Tauri dialog permission, drag-drop, the capability argued on its own PR | 1 | A-06 |
| B-06b | Typed client for `/session` and `/verify`; session state in the frontend | 1.5 | B-06a, A-07 |
| B-06c | UI: verdict triptych, tier-aware wording, not-checked state | 2.5 | B-06b, U7 *released* |
| B-07 | UI: anchor provenance flow — answering link highlighted, absent dimmed, error named | 2 | B-04, B-06b |
| B-08 | UI: diagnosis card, seven patterns, each with its visual | 3 | B-06b |
| B-09 | UI: advisory lane, grouped by code, jump targets | 2 | B-06b |
| B-11 | Mutation-demo fixture suite: each mutation → its expected pattern and copy | 2 | B-08 |

**Phase 1: ~22.5 days**, thirteen items rather than eleven. Three changes to
the order and the granularity, each with a reason:

- **B-10 moved to the front.** It depends only on B-03, and it *is* the
  phase's exit criterion. Running it first makes that criterion continuously
  true instead of a final gate, and it means four UI blocks are built on a
  base that has been compared with an independent runner rather than assumed.
- **B-05 no longer waits on U7.** A keychain anchor source has nothing to do
  with tier and time-trust name tables; the dependency was wrong.
- **B-06 split into three.** As one item it silently contained a security
  change — the desktop shell has `core:default` and nothing else, so a file
  dialog means a new Tauri permission, and `CONTRIBUTING.md` requires each
  permission to be argued on the pull request that introduces it. Bundling
  that with typography would give a reviewer no way to tell them apart. The
  middle piece is the frontend actually *using* the generated client, which
  the plan had no item for at all: today the frontend can render a boot
  screen and nothing else.

Note the dependency wording on B-06c: **U7 released**, not merged. Auditor
installs `palimpsests` from PyPI, so an upstream item becomes usable here at
its release rather than at its merge. Palimpsests cuts releases on its own
schedule, and this plan should not pretend otherwise.

**Exit criterion:** every mutation fixture produces the correct verdict, the
correct diagnosis pattern and correct anchor provenance, agreeing with
`palimpsests pala verify` — checked by a runner, not by eye.

The published vectors are **not** part of this criterion, and saying so is
the point. They are the independent authority (§20.1b) and they are not
shipped in the distribution, so conformance cannot be established from an
installed package until U9 is released. Folding them in would make the
criterion unmeetable through no fault of the phase; leaving them out
silently would let "verified against the CLI" pass for conformance, which it
is not — the CLI shares the library. The skipped test names the gap on every
run.

## 5. Phase 2 — Browse

| PR | Content | Days | Needs |
|---|---|---|---|
| C-01 | `/boots`, `/spans`, `/records` (paginated, filtered), `/record/{seq}`, `/origin` | 3 | B-01 |
| C-02 | `/timeline` density buckets, both axes, boot-gap markers | 2 | C-01, U1 |
| C-03 | UI: Chronoscope — date rail with pinned caps, fine strip, axis toggle, wall-gap hatch with the ruler removed inside it, pins row | 5 | C-02 |
| C-04 | UI: accordion compression for empty stretches, with explicit marks | 2 | C-03 |
| C-05 | UI: boot and span lists; unclosed span as first-class evidence | 2 | C-01 |
| C-06a | UI: the record card — envelope, tier and trust badges, type/kind name resolution, body presence state (none / opaque / cleartext / undecoded). An interim `seq` lookup field stands in for the seq-jump button until C-09 exists. | 1.5 | C-01 |
| C-06b | `prev_hash` and container `index` on `RecordView`. Both are already on the reader's own objects — `Header.prev_hash`, `DecodedRecord.index` — and are not upstream work at all, just two fields `_record_view` was not copying through. Unlocks the predecessor jump; the record's own hash still waits on U10. | 0.5 | C-06a |
| C-06c | Clickable `prev_hash` and the record's own hash, rendered once C-06b and U10 are both there. | 1 | C-06b, U10 *released* |
| C-06d | Raw hex view with field highlighting, from U4's field map. The remaining, and largest, piece of F7 — nobody has designed it yet, hence `?` rather than a number carried over from an estimate that covered the whole of C-06 before it was known to need three PRs upstream and down. | ? | C-06a, U4 |
| C-07a | UI: the SAFETY list, grouped by kind and sorted by seq — the slice buildable on what a record already resolves. No detail text, no acknowledgement state. | 1 | C-01 |
| C-07b | Detail text and the recurrence count it enables, once `EVT_DETAIL` is decoded. | ? | U12 *released* |
| C-07c | The r2 oversight loop: acknowledged/unacknowledged state for `INCIDENT_CANDIDATE` records, an `OVERSIGHT_ACK`'s operator and deadline, `KEY_SHRED` resolution. **Display only** in the MVP — recording a disposition is the Phase-5 item below, behind its own ADR. `U10` dropped from the dependency: confirmed while building `U13` that resolution never needed a record's own hash exposed here, only the header bytes the package already holds internally. | ? | U13 *merged*, U15 |
| C-08 | UI: origin card, Recorded badge, `since_seq` jump | 1 | C-01, C-06a |
| C-09a | Search bar: seq jump (`#1447`), two of three quick buttons (first record, next warning). Unsupported input named plainly rather than silently ignored. | 1 | C-01, C-06a |
| C-09b | Filter chips: `kind:`, `type:`, `span:`, `boot:`, `tier:`, date range — wired onto C-11's list. `span:`/`boot:` need no backend change (spans and boots are already fetched in full); `type:` needs a name→int mapping investigated but not built (§5 below); `kind:`/`tier:`/date range need new `/records` query parameters that do not exist yet. | ? | C-11 |
| C-09c | Time jump (nearest record to a wall-clock instant) and the anchor quick button (needs a record's own hash — U10, C-06c). | ? | C-06c, C-09b |
| C-09d | Free text over `detail`. Blocked on `FUNCTIONALITY.md` §22.3, an open product question this plan has no authority to answer, and — until U12 releases — on there being no `detail` field on a record to search at all. | ? | §22.3 decided, U12 *released* |
| C-11 | The records list: paginated, clickable rows driving the same `select` the search bar and origin jump already use. Neither C-09b's chips nor C-10's virtualisation could mean anything without it, and no item built one — a real gap the plan had not itemised, found while scoping C-09's own split. | 1 | C-01 |
| C-10a | The three claims §19 bundled as one line, taken apart. "Off-thread verify, window never blocks" — already true, confirmed with a concurrency test rather than left as an assumption. The opening screen's own state model already had an `"opening"` variant `chainLine` rendered correctly; the Open button just never read it, so a slow open looked identical to a stuck one and a second click started a second one — fixed. "Record table virtualised" — C-11's ≤50-row pagination already bounds render cost independent of chain size; a literal virtual-scroll would add nothing this screen does not already have, and reads worse for a forensic review tool than paging does (§C-10 prose below). | 0.5 | C-03, C-11 |
| C-10b | The "100 MB / ~1M-record chain verifies in under 10 s" half of §19 — the only claim of the three actually unmet, and not fixable here (U14). | ? | U14 *merged (partial)* |
| B-12 | `pkcs11` as a fourth anchor source kind, behind the `[pkcs11]` extra | 1 | — |

**Phase 2: ~22.5 days plus C-06d, C-07b, C-07c, C-09b, C-09c, C-09d and
C-10b** — 27 as planned, plus B-12 and C-11 (§below), minus the 4.5 days
C-09's, C-07's and C-10's own splits found they did not need (three
guesses — two three-day, one three-day — each became a small `a` slice
plus question marks). The seven question marks left are not the same
kind of unknown: C-06d is an unstarted design; C-07b and C-07c are gated
on upstream work this plan has now scoped (U12, and U13 plus U15 —
U10 dropped from C-07c's own dependency, §5 below); C-09b
is gated on C-11 landing and partly on the same type-name investigation
C-06's split opened; C-09c on an upstream release (U10); C-09d on a
product decision (§22.3) this plan cannot make by itself; C-10b on a
newly scoped upstream performance item (U14).

**Exit criterion:** a 1M-record chain opens, the timeline stays
interactive, and "what happened at 22:41 on 6 Aug" is answerable in under
five interactions.

### Three upstream changes since 0.10.0 that this phase has to account for

**B-12 — a fourth anchor kind exists.** ADR-0004 landed `Pkcs11Anchor` and
`Pkcs11AnchorStore`: the head as a `CKO_DATA` object on a token the host can
read but cannot silently rewrite. Both speak the existing `AnchorSource` /
`AnchorStore` seams and inherit the failure semantics already rendered here —
absent returns `None`, present-but-unreadable raises `AnchorSourceError` with
the source identity attached — so the provenance view needs no new outcome
and no new colour.

What it needs is for `_anchor_source` to stop refusing the kind, and for two
descriptions to stop enumerating three. `AnchorSourceSpec.kind` and
`AnchorAttemptModel.source_kind` both read *"'manual', 'file' or
'keychain'"*. That is the fourth time a field description in this repository
has become narrower than its field, after `chain_ok`, `total`, and
`buckets`/`start`.

Behind the `[pkcs11]` extra, per §1.5: a plain install must not require
`python-pkcs11`. The tier claim stays the package's — ADR-0004 calls this the
tier-B *mechanism*, and a tier-B *claim* needs a real token. Auditor renders
whichever tier the records carry and never upgrades one.

**Rotation makes three of C-05's span states routine.** `RotationPolicy` and
the record-boundary cut mean a long-lived chain now arrives as a sequence of
segments by default rather than by accident.

C-05 derived `began-earlier`, `spans-the-file` and the orphan placement from
first principles: the payload has a parent field and a file has edges. They
are now the ordinary shape of a rotated chain, which raises two things from
hypothetical to expected — a fixture built from a genuinely rotated chain, so
those states are exercised against bytes the writer produced rather than
hand-made `SpanView` objects; and §C-09's and §22's "several files as one
chain", which the drop handler currently answers by opening the first and
saying so. That was an honest refusal while segments were hypothetical. It is
a gap now.

**The pins row's wording rests on an assumption that is now checkable.** It
reads *"At tier A there is none to have — the absence is a property of the
platform, not a gap in the record."*

SCITT registration landed upstream — a chain head as a COSE_Sign1 Signed
Statement, with receipts, against RFC 9943 — and `scitt.py` does not mention
tier at all. So whether an external witness is available may not be a
property of the tier, and that sentence may be asserting a limit the
mechanism does not have.

Before Phase 4 renders any pin, the sentence is verified or replaced. It is
currently the only claim in this application that says something is
*impossible* rather than *absent*, and it was written from an assumption
rather than from the package.

### C-06 was one PR costed before anyone had read what `RecordView` carries

The three-day estimate assumed the sidecar could already answer everything
F7 asks for. It cannot. `RecordView` has `body_tlv_types` — which TLV types
are present, never their values — and no field at all for either hash.
Building the clickable `prev_hash` link the estimate priced at no extra cost
would have meant inventing the field on this side of the seam, which ADR-0001
exists to rule out.

Split into four rather than costed down, for the same reason Phase 1's B-06
was split rather than shrunk: a security-relevant seam addition (C-06b), an
upstream item (U10 → C-06c), and an unstarted design (C-06d) are three
different kinds of work, and one PR covering all of them would give a
reviewer no way to tell which kind they were approving.

Two of the three gaps turned out to be free. `Header.prev_hash` and
`DecodedRecord.index` are already on the reader's own objects — confirmed by
reading `palimpsests.audit.reader` against the installed 0.10.0 wheel rather
than assumed from the spec — so `_record_view` was simply not copying them
through. The record's own hash is the real gap: nothing downstream of
`decode_record` retains the header bytes `pala.record_hash()` needs, which is
why it is U10 and not a fourth free field.

**C-08's dependency was also wrong, the same way B-05's was.** F9 renders the
origin card "on any selected record" (§13 of `FUNCTIONALITY.md`), and nothing
before C-06a gave this application a record to select. The table listed C-08
as needing only C-01 because C-01 supplies the endpoint — but an endpoint is
not a selection mechanism, and C-08 built against C-01 alone would have had
no record to be a card *of*. Corrected above to `C-01, C-06a`.

**Status.** C-06a is merged. C-06b is this PR: `RecordView` gains `index`
and `prev_hash` (the latter resolved through the same ZERO-convention
`span_id` already uses, confirmed against
`palimpsests.audit.pala.incremental`'s own GENESIS check rather than
assumed), and the card displays both — `prevHash` as a fact, not yet a
link, because there is still nothing on this side of the seam to compare it
against. C-06c is next and is blocked on U10's release, not on anything
left to design here.

(That status paragraph, and the count in §6 below, were themselves written
inside C-06a's own PR and had already called C-06b "merged" — it was not;
that PR was C-06a. Both are corrected here.)

### C-08 is merged — one wording gap, tracked as U11

Origin inspection otherwise needed no seam changes: `/session/{id}/origin`
has answered since C-01, and the card is a straightforward reading of what
it returns. The gap is narrower than C-06's and did not earn a formal
split — one sentence F9 asks for ("no model active" after a MODEL_UNLOAD)
that `origin_at()` cannot currently produce, confirmed by reading the
reader source directly rather than assumed (§2, U11). Until U11 lands, a
MODEL_UNLOAD and "nothing declared yet" render the same honest sentence,
"not stated in this file", because the data cannot currently tell a reader
which one it is.

### C-09 was one PR costed before anyone counted what F10 actually needs

Three days assumed "search bar" was one thing. Reading F10 and its own
open question against what exists today says otherwise:

- **Free text is `FUNCTIONALITY.md` §22's own unresolved question** — "is
  free-text search over `detail` MVP or fast-follow?" — not a gap this
  plan can close by building one answer into the app. It is also
  unbuildable regardless of that answer: no record carries a `detail`
  field yet (C-06d).
- **Filter chips presuppose a records list.** `kind:`, `type:`, `span:`,
  `boot:`, `tier:` and date range all narrow *which records a list
  shows* — and this application renders one selected record at a time,
  never a list of them. `/records` has supported paging and three of
  those filters since C-01; nothing client-side has called it for more
  than a single record. This is a real gap the plan did not itemise
  anywhere, not a deferral — there is no "C-something: the records list"
  item for C-09b to depend on, and one is needed before filter chips mean
  anything.
- **Time jump** needs the record nearest a wall-clock instant, which
  `/records`' offset (by seq, not by time) cannot answer.
- **The anchor quick button** needs a record's own hash to know which
  record a configured anchor names — the same U10/C-06c gap `prevHash`
  is waiting on, not a new one.

What needed neither a records list, a product decision, nor an upstream
release: seq jump (`#1447`, F10's own syntax) and two of the three quick
buttons. Built as C-09a. Typing anything else into the bar — a filter
chip, free text, a time — is named plainly as not read yet rather than
silently ignored, the same discipline `record-note` and `origin-none`
already keep for what this build cannot show.

### C-11 — the item nothing else's dependency had actually named

C-09's split found the missing records list and stopped there, needing it
only to explain why C-09b could not be scoped. Adding it as its own item
surfaced a second place the plan had already made the same mistake C-08's
dependency did: **C-10's "virtualised record table" needs a table.**
Nothing built one. C-10 has depended on C-03 since it was written —
correct, C-10 needs the Chronoscope's data path — but a table to
virtualise is a second, unstated dependency, the same shape of error as
C-08 needing C-06a and not just C-01. Corrected above to `C-03, C-11`.

C-11 itself needed nothing new: `/records` has paged and filtered since
C-01, and the view is a straightforward reading of what it returns, reusing
`recordCard` per row rather than a second mapping. The one design decision
worth naming is pagination itself — `offset` is documented as a **seq
threshold** ("records with `seq >= offset`"), not a row count, so "next
page" cannot be `offset + limit`: a gap, a segment boundary, or a filter
can all make that number land short of or past what this page actually
returned. The only threshold guaranteed correct is one past the last row
the page carried, which is what `nextOffset` computes. "Previous page" has
no backward equivalent to derive — the endpoint is forward-only by
design — so it is answered by remembering the offsets already visited
rather than computing a new one.

### C-07 was one PR costed before anyone confirmed what F8's data needs

Three days assumed "SAFETY list and the r2 oversight loop" was buildable
against what the seam already resolves. Reading the reader source
directly, the way U10 and U11 were confirmed, found otherwise.

**Grouping and counting by kind need nothing new.** `kind_name` is
already resolved per record — `INCIDENT_CANDIDATE` (102) and
`OVERSIGHT_ACK` (103) are recognised kind values on `SAFETY` bodies the
same way `MODEL_LOAD`/`MODEL_UNLOAD` are on `EVENT` bodies — so a list
sorted by seq and grouped by kind is a straightforward reading of what
`_record_view` already returns. Built as C-07a.

**Detail text is not.** F8 asks for "detail text and a recurrence count
for identical details" on every SAFETY record. Nothing on this side of
the seam decodes a body TLV *value* — `_record_view` reports
`body_tlv_types`, the set of types present, and stops there by design
(§5, C-06). `EVT_DETAIL` (TLV type 4) is a published, generically usable
field — this is not a design question the way C-06d's hex view is, it is
a single named field the package should expose the way `origin_at()`
already exposes `role` and the two digests. New Track-U item: U12.

**The r2 oversight loop needs two things, not one.** Resolving whether an
`INCIDENT_CANDIDATE` has been acknowledged means decoding an
`OVERSIGHT_ACK`'s `EVT_REF_SEQ` / `EVT_REF_HASH` and matching them
against the candidate they name. Matching on `seq` alone would be a
**wrong** answer on occasion, not an incomplete one: an ack whose
`ref_hash` does not match the candidate at that seq is exactly the
`reference_hash_mismatch` case `FUNCTIONALITY.md` §9 already names, and
rendering it as a valid acknowledgement would be the overclaim this
codebase spends its effort refusing to make elsewhere. Correct resolution
needs the candidate's own hash — U10, still blocked on an upstream
release — so U13 depends on it rather than duplicating it.

The package is already doing an equivalent hash-verified match somewhere
in its own `verify()` path: `PalaWriter.oversight_ack`'s docstring states
plainly that "whether `candidate_seq`/`candidate_hash` name a real
candidate is the reader's referential-integrity check, reported as an
advisory" — which is how `reference_unresolved` and
`reference_hash_mismatch` get produced today. What does not exist is the
*positive* case: a candidate with a correctly matching ack produces no
advisory at all, because nothing is wrong, and silence is not the same
signal as "acknowledged". U13 asks for that resolution exposed directly,
the same shape of request U10 already is — not new package behaviour,
new package surface. Built as C-07c, behind U10 and U13 both.

(That last dependency was wrong in a way only building U13 surfaced:
it needed no record hash exposed on `DecodedRecord` at all, only the
header bytes the package already holds internally — the same
distinction that made B-05's `U7` dependency and C-08's `C-01`-only
dependency wrong earlier in this document. U13 split and its
acknowledged-state half is built; this section's own later subsection
has the full account.)

The `"safety": {"unacknowledged_candidates": 0, ...}` block in
`FUNCTIONALITY.md`'s report JSON (§11) is not evidence this is already
computed here — it is the illustrative shape of `pala-verification-
report/1`, which Phase 3's D-01 renders from the package's own
`build_report`, once U6's report model actually carries it. Whether it
does is worth confirming when D-01 is scoped, not assumed now.

A real bug was found and fixed while building C-07a, worth naming since
it is the kind this codebase is built to catch: the first draft of
`/safety` accepted a `limit` query parameter shaped like `/records`'s,
wired nowhere — `Session.safety()` never took it, so it was silently
ignored. The fix was not to wire it through but to remove it: `/safety`'s
answer is cached once per session the way boots and spans are, and a
caller-visible limit on a cache with no key for it would have let a
second caller silently receive the first caller's limit. A test asserting
the parameter actually narrowed the response is what caught it — asserted
`== 2`, got back all four.

### C-10 was one line bundling three separate claims, only one unmet

§19's actual sentence — "the timeline stays interactive, with the
record table virtualised. Verify runs off the UI thread; the window
never blocks" — reads as one requirement. It is three, and they needed
three different kinds of attention: one already true, one a small gap
between an existing state model and the screen reading it, one a real
performance ceiling this repository cannot move.

**"Verify runs off the UI thread; the window never blocks" — already
true, now proven rather than assumed.** Every route in `main.py` is a
plain `def`; Starlette runs a sync path operation in a worker thread
rather than on the event loop, and the frontend's own calls are already
`fetch`-based, which never blocks the window's own thread waiting on a
promise. Both were true by construction and neither had a test standing
behind either half of that sentence. `test_concurrency.py` makes it
one: a monkeypatched 0.3 s delay on `verify` and a concurrent `/health`
call, issued after `verify` has started, that must answer in well under
the delay. It does — proving the sidecar serves a second request from a
different worker thread rather than queuing it behind the one already in
flight, deterministically and in well under a second, with no real large
fixture involved.

**The opening screen's own gap.** `ChainState` has had an `"opening"`
variant since Phase 1, and `chainLine` already renders it correctly —
"Opening {path}…" — as the page's footnote. Nobody had wired the Open
button itself to it: the button's own label never changed, and,
unlike Verify's `disabled={!canVerify}`, nothing stopped a second click
from starting a second concurrent open while the first was still
running. Fixed to match Verify's own pattern: disabled and relabelled
"Opening…" for the state that already existed and was already computing
the right sentence one element away.

**"Record table virtualised" — a judgement call, made and written down
rather than left implicit.** C-11's list renders at most
`RECORDS_PAGE_SIZE` (50) rows regardless of how large the chain is —
DOM cost bounded by the page size, not the record count, which is the
property virtualisation exists to provide. It achieves this through
pagination rather than a continuously scrollable virtual-scroll
component, and the two are not the same interaction, but for this
screen specifically pagination is arguably the better fit, not merely
an adequate substitute: a discrete page is a stable reference ("page 3,
record #150") in a way a scroll position is not, and a continuously
loading feed reads more like a live monitor than the careful, nothing-
moves-until-asked review surface the rest of this application is built
to be (`styles.css`'s own words: "a forensic tool that animates while
you read it is a tool arguing with its own content"). Building a second,
literal virtual-scroll list alongside it would cost real engineering for
a DOM-size problem C-11 does not have.

**"100 MB / ~1M records verifies in under 10 s" — the one claim
actually unmet, and measured rather than guessed.** A synthetic
100,000-record / 22.4 MB fixture, built with the package's own writer,
timed through `open_chain` and `ChainHandle.verify` (the header walk
plus `build_report`'s body-digest pass): 4.9 s total, peak RSS 460 MB —
about 20.6× the file's own size. A second fixture at 224 MB /
1,000,004 records — past §19's own "100 MB / ~1M-record" mark, not
short of it — exceeded 3.9 GB of RAM on the machine this was run on and
was killed by the OS mid-`verify`, never producing a verdict at all.

The cause, read from the package rather than inferred: `AuditReader
.records()` is written as `yield from self._decoded_records()`, which
looks incremental and is not. `_decoded_records()` is a single list
comprehension over every header, built in full — confirmed directly:
asking for only the *first* record from a fresh reader on the
1,000,004-record file took 24 s, the same as asking for all of them,
because the first `yield` cannot happen until the whole list exists.
`AuditReader.verify()` pays an equivalent cost independently rather than
reusing that decode. Three concurrent calls (`records`, `safety`,
`timeline`) issued against one freshly opened session were also timed,
in case the frontend's own parallel fetches on chain-open were
compounding this — they were not: three calls together took about as
long as one, consistent with CPython's GIL serialising the underlying
CPU-bound work rather than tripling it, so no fix was made where none
was shown to be needed.

None of this is buildable in `pala_seam.py`. A faster or genuinely
incremental decode, and whatever `build_report` is doing to reach a
20×-of-file-size memory footprint, are both entirely inside the
package's own reading path — reimplementing either here would be
exactly the second-implementation mistake ADR-0001 exists to rule out,
on the single riskiest place in this codebase for it to happen
unnoticed. Tracked as U14, with the numbers above rather than an
estimate: what closes the gap is not yet known well enough to cost it,
the same honesty C-06d's `?` already asks for a design nobody has done
yet.

Built as C-10a: the concurrency test, the Open-button fix, and this
section's documented case for pagination over virtual-scroll. C-10b —
the actual scale target — waits on U14.

### U14 was investigated past the point of scoping it, into building part of it

Reading U14's cause precisely — `_referential_advisories()` needing
every record's kind, `_decoded_records()` never letting that cost be
partial — surfaced two things worth doing upstream rather than only
writing down. Both landed in Palimpsests directly, not filed and left
for later.

**A real correctness bug, found by reading what `_safety_section` did
with the same hash-verified resolution `_check_reference` already had.**
`build_report`'s `safety.unacknowledged_candidates` matched an
`OVERSIGHT_ACK` to its candidate on `EVT_REF_SEQ` alone — no hash check.
An ack naming the right seq with the wrong `EVT_REF_HASH` counted its
candidate acknowledged in the report, the same file whose
`advisory.items` was already saying that exact reference was broken
(`reference_hash_mismatch`). Fixed upstream by extracting the hash
check `_check_reference` already did into a shared `_hash_verified_target`,
and exposing a new public `AuditReader.acknowledged_candidates()` built
on it — Assault-Consulting/Palimpsests#199, merged. This is U13's
acknowledged-state half, done rather than merely scoped, and it is
*where* U13's original `U10` dependency turned out wrong: the hash
check resolves against `self._headers`, bytes the reader already holds,
never against a `DecodedRecord.record_hash` field — the thing U10 would
have added. Corrected above; U13 no longer needs it.

**`build_report`'s own duplicate decode, found while tracing why
Auditor's verify flow paid U14's cost twice.** `ChainHandle.verify()`
asks its own session reader to verify, then separately asks
`build_report` for the body-digest walk — and `build_report` always
opened a second, independent `AuditReader`, with no way to know the
caller already had one warm. `build_report` now accepts `reader=`
(Assault-Consulting/Palimpsests#198, merged) so a caller holding an
open reader is not charged the decode again. This halves the redundant
half of U14's cost; it does not touch the cost itself, and Auditor's
own `ChainHandle.container()` does not pass `reader=` yet — a small,
safe follow-up once a release carries the parameter, not built now
because the parameter is not usable from an unreleased dependency.

**The actual cost — `_decoded_records()`'s eager decode — was designed,
not built.** A lock-protected generator that decodes and caches one
record per index would let an early-exiting caller (`origin_at`, a
single-record lookup) pay only for what it reads, while a full walk
keeps today's shared, cache-once behaviour. Worked through in enough
detail to be confident it is correct — including why a naive lazy
rewrite is not enough on its own, since `origin_at`'s real usage
pattern (repeated lookups at different seqs as a user browses) wants
early-exit *and* a shared cache across calls, not one or the other.
Left unbuilt on purpose: it is the first concurrency primitive this
class would need, it touches all six of `_decoded_records()`'s current
callers including the r2/r3 resolution `U13`/`U15` depend on, and the
package's own `docs/INTEGRATION-SURFACE.md` already calls this "backlog,
not promise" — a design existing is not the same as it being this
plan's call to build without the maintainers in the room. U14 stays a
`?` for that reason, not because the shape is unknown anymore.

## 6. Phase 3 — Report

**Rewritten after U6 closed upstream.** The original six items assumed
Auditor built the attestation document. It does not: `pala report` and
`palimpsests.audit.report_html.render_html` produce the JSON and the HTML,
and ADR-0001 gives the package what a report *is*. Building a second one here
would be the body-digest mistake again — a second implementation is a second
thing to be wrong.

Checked rather than assumed: `render_html` emits one self-contained page —
no `<script>`, no `<link>`, no `@import`, no outbound URL — so embedding it
costs nothing against the air-gap invariant.

| PR | Content | Days | Needs |
|---|---|---|---|
| D-01 | Render the package's report through the seam; the JSON and the HTML, neither rebuilt | 1 | U6, B-03 |
| D-02 | Print and PDF: whether that HTML is fit to print, and what a PDF path costs | ? | D-01 |
| D-03 | Wording audit against L4 and the no-overclaim rule. Now audits *our* framing around the document; if the package's own wording overclaims, that is an upstream issue and is raised there | 1 | D-01 |
| D-04 | Determinism test: same file + same anchor → identical bytes except `checked_at`. Now a check on the package's output rather than on ours | 1 | D-01 |
| D-06 | JSONL export passthrough with range bounds and the derived-not-authoritative notice | 1 | B-01 |
| D-07 | Export surface: where a file lands, and whether the digest travels with it | ? | D-01 |

D-05 is dropped. The round-trip it tested — rebuild the JSON from a fresh
reader run and compare — is upstream's own guarantee once the report has one
schema owner, and re-checking it here would test their code with our test.

**Phase 3: revised downward, and the figure is deliberately not restated.**
D-02 and D-07 carry `?` because nobody has looked at the printed page yet.
Replacing ten days with a smaller invented number would be the same overclaim
the original estimate made in the other direction.

**MVP total: not restated either, for the same reason.** It was ~73 days on
an estimate that no longer describes Phase 3. The honest statement is that
Phase 0 and Phase 1 are closed, Phase 2 stands at eleven of twenty-one
items — the twenty-one counting four splits now (C-06 into four, C-09
into four, C-07 into three, C-10 into two), eleven merged through
C-07a, C-10a proposed in this PR — and Phase 3 is unquantified until
D-02 and D-07 have been looked at. If the work has to shrink, the cut
lines are C-09b onward and B-05 — not the tests.

## 7. Phase 4 — evidence artifacts

Where the tool stops being a viewer and starts producing artifacts a third
party can re-check without it.

| PR | Content | Days | Needs |
|---|---|---|---|
| E-01 | Evidence bundle UI: invoke the upstream `pala bundle` (U8) through the seam; present the manifest and the time-claims section. Assembly itself lives upstream — building it here would violate the Track-U criterion and, over time, invariant L1. | 1.5 | U5, U8 |
| E-02 | Independent re-verification harness for bundles: a from-the-spec script with no Auditor code reproduces every claim. (Cleaner still now that assembly is upstream: the harness checks an artifact no line of this repo produced.) | 3 | E-01 |
| E-03 | Record health: aggregation and trends over U1–U3 output; the three disciplines enforced in the UI copy | 5 | U1–U3 |
| E-04 | Health summary into the JSON report, labelled advisory, carrying its caveats | 1 | E-03, D-01 |
| E-05 | Local witness log: hash-chained record of checks performed, with the honest statement of what it does and does not prove | 3 | B-03 |
| E-06 | SCITT receipts as external evidence: present a registered head and its receipt as a pin, through the seam. Registration and receipt verification are upstream's (`pala/scitt.py`); the shell displays and never mints. Gated on the pins-row sentence in §5 being verified first — a row that renders a pin while the copy says none can exist is worse than either alone. | ? | §5 pins check |

**Phase 4: ~13.5 days plus E-06** (and U8's 4 days upstream — net neutral,
honestly placed). E-06 carries `?` for the same reason Phase 3's two items
do: nobody has read the receipt format against what a pin needs to show.

## 8. Phase 5 — beyond MVP

| Item | Notes |
|---|---|
| Watch mode over `TailingReader` | Read-only tail; live verdict, live SAFETY feed, unacknowledged-candidate alert |
| Oversight disposition (the one write) | A human records a disposition for a candidate **from the screen** — the operational form of Art. 14 human oversight. This is the single place the reader shell touches writing, and it must never do so by producing wire bytes: the shell sends a disposition command to a live engine's sidecar API, and the *runtime's* writer emits the `OVERSIGHT_ACK` record with an operator id from the local profile. Gated on Watch mode and on a dedicated ADR (ADR-0003 candidate): the read/write boundary is crossed by a documented decision, never by drift |
| Rekor anchor source | Network. Opens the air-gap layers for the first time — both must be demonstrably enforced before this merges |
| TSA anchor source (RFC 3161) | Same gate |
| Segment sequences | Several files as one logical chain; behaviour when a segment is missing. **Promoted in urgency by upstream rotation** (§5): this is now the ordinary shape of a long-lived chain rather than a possibility, and the drop handler's "only the first was opened" is a gap rather than a deferral |
| Signed installers | macOS notarisation + Windows code signing; needs certificates, which is procurement, not engineering |
| `uk` localisation pass | Strings are externalised from A-02; this is the translation and review pass |

## 9. Risks, and what is actually done about each

**R1 — The shell drifts into being a second format implementation.**
Highest-consequence risk in the project. Mitigation is mechanical, not
cultural: one seam module, and a CI test that fails the build on any wire
primitive outside it (B-02, landing in the first week of Phase 1).

**R2 — Overclaim.** Someone will read a green verdict as certification
whatever the documentation says. Mitigation: D-03 is a scheduled PR,
not a review comment; the report's own wording states it is an
attestation of a check; the product name deliberately says "Auditor"
(the role) and not "AI Auditor" (the claim).

**R3 — UI cannot be visually verified in CI.** The 3-OS matrix proves
compilation and tests, nothing about appearance. Mitigation: frontend
tests run against recorded sidecar responses so logic is testable
headlessly; a live desktop session is a scheduled manual gate at the
close of each UI phase, not an ad-hoc check.

**R4 — Track U slips and Phase 1 stalls.** Mitigation: exactly one Phase 1
item depends on Track U at all — B-06c, on U7 being *released*. Everything
else in the phase is buildable against the shipped 0.8 surface. U1, U4, U5,
U6 and U9 block Phase 2, 3 and 4 items, which are later.

This is stronger than it was: the plan previously listed B-05 as needing U7,
which was simply wrong — a keychain anchor source has nothing to do with
name tables — and the error would have idled two days of unblocked work
behind an upstream release.

**R5 — Scope creep into analytics.** The boundary is written into the
non-goals and repeated in F12's three disciplines. The operative rule: no
analytics PR merges before verify and report are impeccable.

**R6 — Package extraction (`palimpsests-audit`) lands mid-development.**
Mitigation is §4 of the architecture: one seam file. The extraction is a
one-file diff plus a dependency change.

**R7 — The disposition write path erodes the read-only boundary.** Once
one write exists, the next one looks cheap. Mitigation: the write is a
*command to the engine*, never bytes from the shell (the runtime's writer
emits the record); it lands behind a dedicated ADR; and the boundary
statement in `FUNCTIONALITY.md` gains an explicit "the one exception"
clause so any second exception is visibly a rule change, not a precedent.

**R8 — This plan describes work upstream has already done.** New, and it
has now happened once: Phase 3 was six items and ten days for a report the
package produces. It was not caught by review; it was caught by reading the
upstream log while updating the pinned version.

Mitigation is a habit rather than a gate, and it is stated as one: **before
starting a phase, read the upstream changelog and commit log since the
pinned release**, and account for anything that touches the phase's subject.
The failure is silent in both directions — building what exists, and
missing a mechanism that changes what a screen may claim — so it is not
something a green CI run will ever raise.

## 10. Definition of done, per phase

A phase closes when all of the following hold:

1. Every PR in the phase is merged with non-author approval — enforced by
   the ruleset on `main` since 17 August 2026, so this is a fact about the
   history rather than an aspiration. The bootstrap period, when it was
   neither, is bounded in *Review and merge* in `GOVERNANCE.md`.
2. CI green on macOS, Linux and Windows; coverage gate met.
3. `reuse lint` clean.
4. The phase's exit criterion is demonstrated on real fixture data, with
   the demonstration recorded in `CHANGELOG.md`.
5. A live desktop session review has been done for any phase containing
   UI work.
6. No invariant from `FUNCTIONALITY.md` §3 has an exception in the merged
   code — and if one was needed, it is documented as an ADR, not as a
   comment.
7. The upstream log since the pinned release has been read, and anything
   touching the phase's subject is accounted for in the plan before the
   phase is called closed (R8).
