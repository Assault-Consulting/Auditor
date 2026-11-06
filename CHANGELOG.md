<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- C-16(a) — the seam imports only the declared consumer surface
  (`CONSUMER-SURFACE.md` r2). Everything it used from `pala.codec` and
  `pala_writer` now comes from `reader`: `FORMAT_VERSION`, `RT_SAFETY`,
  `KIND_INCIDENT_CANDIDATE`, and `NO_SPAN` / `NO_PREDECESSOR` in place of the
  raw `ZERO16` / `ZERO32` sentinels (the same bytes); `boot_statistics` and
  `step_catalog` come from `reader` too. `check_no_wire_parsing.sh` refuses
  a `palimpsests` import from any module other than `reader`, `anchors`,
  `anchors_pkcs11`, `names` and `report` (channel 2), and
  `tests/test_consumer_surface.py` checks every imported name against the
  installed package's `__all__`, so a name the package stops declaring
  fails on the pin bump rather than in use. The canary against Palimpsests
  `main` (C-16(b)) is prepared as `.github/workflows/canary.yml` and lands
  by upload.

- C-15 — test fixtures onto the published vectors (r2 decision 5).
  `test_conformance_vectors.py` now checks, through `open_chain`: the core
  envelope; the four core demos the vectors carry as plain bytes — a
  truncated tail, a stale anchor, a flipped body bit, a missing GENESIS —
  built by concatenating published bytes, never by writing a header; the
  inference profile's `semantics` block (r2–r6), field by field against
  `RecordView`, with every stated field either checked or listed with its
  reason so a richer vector cannot pass by silence; and the published
  ciphertext, the first real encrypted body under test here — opaque on
  the card, counted by a text search as unsearched. The profile-semantics
  test, skipped since U9 for want of a body-semantics read path, runs: that
  path has existed since C-07b. Three demos need a header written and stay
  with the writer-built mutation suite. Found: the package decodes `detail`
  on EVENT and SAFETY only, so the vectors' KEY_SHRED detail is not shown
  (R4, `docs/UPSTREAM-REQUESTS-0.14.md`).

- C-09d — free text over `detail`, decided into the MVP (§22.3). A phrase
  in double quotes searches every record's detail as a literal,
  case-insensitive substring, ANDed with the chips (`kind:SAFETY "frame
  magic"`); no pattern language, so a query finds the same records on
  every desk. `/records?text=` (1–200 characters). A record with an
  encrypted body cannot be searched: `RecordPage.unsearched` counts those
  that passed every other filter, and the list says how many, so "no
  match" never stands for "could not look". Unquoted words are still
  refused, now with a reason that says to quote them. On 0.13 the search
  decodes every record, as the other body filters do; three requests for
  0.14 are in `docs/UPSTREAM-REQUESTS-0.14.md` (`detail` without a decode,
  for this; a record's bytes as read and its TLV layout, for C-06d).

- C-10b(b) — opening a large chain no longer decodes it. At 1M records a
  session opened in 21.6 s and 2.0 GB before the first answer; now the
  container opens in under a second at 272 MB, and the header index that
  describes it takes about five seconds more, built once per session and
  shared by every structural answer, under 610 MB. The emptiness check uses the
  package's `record_count`; `subject`, `records`, `record`, `timeline`
  and `nearest` read one header index built through `header_at()` and
  decode only the rows they return; SAFETY, acknowledgements, shreds and
  detail counts come from the package's bounded reads. Answers are
  unchanged — checked against the previous seam on every fixture and
  seven mutants of each (10,752 comparisons). Filters on a record's body
  (`kind:`, `source:`, `outcome:`, a record's own hash) still decode every
  record, and `verify` on a chain of tool loops still costs 35.6 s /
  2.4 GB inside the package's own `verify()`; both are findings for
  Palimpsests' U track.
  `tests/test_bounded_paths.py` fails if a browse path decodes the chain.

- C-14 — how a tool result ended, with what that does and does not mean.
  `RecordView.outcome` carries EVT_OUTCOME as the package names it (`ok`,
  `error`, `timeout`, `cancelled`, and r6's `unobserved`), null on every
  other record; `/records?outcome_name=` and the `outcome:` chip filter by
  it. The card gives the profile's own sentence where it has one: `ok` is
  a return, not a confirmed effect, and a reader cannot treat it as "the
  tool did not fail" (note 5); `unobserved` says the recording vantage
  could not see failure; `cancelled` names the three forms of
  abandonment. `error` and `timeout` get no gloss, because the profile
  gives none. The records list marks every outcome but `ok` — the
  baseline, as `parsed-from-wire` is for C-12's mark — and an outcome this
  build cannot name keeps its number and is never read as `ok`.

- C-13b — what palimpsests 0.13 says, rendered. Guidance for the three new
  diagnosis patterns: `declared_continuation` explains why question one
  still answers no for a segment on its own — the ordinary shape of a
  rotated chain — and points at the manifest and the declared retention
  floor; `continuation_contradicts_manifest` asks whether the manifest
  belongs to this chain; `not_a_container` never describes an interrupted
  write. Under the diagnosis, the segments manifest a verdict rested on is
  named with the digest of the bytes the verifier judged and the package's
  reason, verbatim. Wording for the five `continuation_*` advisory codes
  and for `tool_target_not_a_call`, emitted since 0.12 without words here;
  the two continuation mismatches join the notable weight, for the reason
  `reference_hash_mismatch` has it. (Five continuation codes, not the six
  the plan row named: the sixth missing wording was `tool_target_not_a_call`,
  which is not new.) A SEGMENT_CONTINUATION's card shows
  what it declares — segment, retention floor, predecessor head, prior
  root — under the profile's framing that a declaration is not evidence.
  The open screen says that rotated segments (`chain.pala.00001`) are
  listed under "All files" in the dialog.

- C-13a — what palimpsests 0.13 says about segments, through the seam.
  `GET /session/{id}/verify` carries `manifest` (path, status, the SHA-256
  of the bytes the package judged, its reason), null when the verdict
  consulted no second file; a session that verified against a segments
  manifest refuses to answer (409) once that manifest is edited, removed,
  or appears where it was absent — a verdict that read two files is about
  both. `RecordView.continuation` carries what a SEGMENT_CONTINUATION
  declares (segment index, predecessor head, retention floor, prior root),
  the package's own decode, null elsewhere. `/origin` answers from one
  `origin_state_at()` call. The diagnosis pattern is documented as an open
  vocabulary, with 0.13's three new patterns. Requires `palimpsests`
  `>=0.13.1,<0.14`; the guidance and wording that render the new patterns
  and codes are C-13b.

- C-10a — the three claims §19 bundled as one performance line, taken
  apart. "Verify runs off the UI thread; the window never blocks" was
  already true (every route is a plain `def`, which Starlette threadpools;
  the frontend already calls it via `fetch`) and now has a test proving
  it: `test_concurrency.py` monkeypatches a 0.3 s delay onto `verify` and
  confirms a concurrent `/health` call answers in well under it, rather
  than queuing behind the request already in flight. The Open button
  never read the `"opening"` state `ChainState` has carried since Phase
  1 — `chainLine` already rendered "Opening {path}…" as the footnote, but
  the button itself kept saying "Open a chain…" and stayed clickable,
  so a slow open looked identical to a stuck one and a second click could
  start a second concurrent one; fixed to match Verify's own
  disabled-and-relabelled pattern. "Record table virtualised" is
  documented rather than built again: C-11's ≤50-row pagination already
  bounds render cost independent of chain size, the same property
  virtualisation exists to provide, and a discrete page is arguably the
  better fit for a review tool than a continuously loading one — the
  reasoning is in `DEVELOPMENT-PLAN.md`. What's left unmet is measured,
  not assumed: a 100k-record/22.4 MB fixture verified in 4.9 s at 460 MB
  peak RSS (≈20.6× the file's size); a 224 MB/1,000,004-record fixture —
  past §19's own "100 MB / ~1M-record" mark — exceeded 3.9 GB of RAM and
  was killed by the OS mid-verify. The cause is `AuditReader.records()`'s
  `_decoded_records()`, an eager list comprehension masquerading as a
  generator (confirmed: fetching only the *first* record from a fresh
  1M-record reader took as long as fetching all of them) — entirely
  inside the package, tracked as U14 rather than worked around here.
- The SAFETY list (C-07a): a new `GET /session/{id}/safety` endpoint and
  the client, view-model (`api/safety.ts`) and UI over it — grouped by
  kind, sorted by seq, on fields `_record_view` already resolves
  (`INCIDENT_CANDIDATE`/`OVERSIGHT_ACK` `kind_name` needed no new
  decoding). Detail text and the r2 oversight loop's acknowledged/
  unacknowledged state are not here: both need a body TLV *value*
  decoded, which nothing on this side of the seam does yet, and
  acknowledgement specifically also needs a candidate's own hash to bind
  a reference correctly rather than match on `seq` alone — matching on
  `seq` alone could call a candidate acknowledged when the ack actually
  named a different one. Two new Track-U items track the gap: U12
  (`detail`) and U13 (r2 resolution, depends on U10). A real bug was
  caught building this: the route's first draft accepted a `limit` query
  parameter that `Session.safety()` never used, silently ignored;
  removed rather than wired through, since this answer is cached once
  per session with no key for a caller-chosen limit to live in.
- The records list (C-11): `/records` has paged and filtered since C-01;
  nothing client-side ever called it for more than one record until now.
  Paginated, clickable rows drive the same `select` the search bar and
  the origin card's jump already use. "Next page" asks for one past the
  last row's own seq, never `offset + limit` — the endpoint's `offset` is
  a seq threshold, not a row count, and a gap or a filter can make the
  two disagree; `nextOffset` in `api/records.ts` covers why. Found while
  scoping C-09's split: neither C-09b's filter chips nor C-10's
  virtualisation could mean anything without a list to narrow or
  virtualise, and no item had built one — `DEVELOPMENT-PLAN.md` now
  corrects C-10's dependency the same way C-08's was corrected earlier.
- Search bar, the seq-jump slice (C-09a): `#1447` syntax, replacing the
  interim numeric-only field C-06a stood in with. Two of F10's three
  quick buttons (first record, next warning); the third, anchor, needs a
  record's own hash not available yet (U10, C-06c). Anything else typed
  into the bar — a filter chip, free text, a time — is named plainly as
  not read yet rather than silently ignored. Filter chips, free text and
  time jump are not this PR: they presuppose a records-list view that
  does not exist anywhere in the app yet, a fact `DEVELOPMENT-PLAN.md`
  did not itemise until now, and free text is separately blocked on
  `FUNCTIONALITY.md` §22's own open question about its MVP status.
- Origin card (C-08): the `/origin` endpoint has answered since C-01; this
  adds the client, the view-model (`api/origin.ts`) and the UI. F9 asks
  for two different sentences on a null origin — "not stated in this
  file" and, after a MODEL_UNLOAD, "no model active" — and `origin_at()`
  cannot currently tell the sidecar which one applies, confirmed by
  reading the reader source directly. Both render the one sentence the
  data supports until that's fixed upstream (U11). `since_seq` is the
  first real jump target in the app: it re-selects the declaring record
  through the same `select` the record lookup uses.
- `RecordView.index` and `RecordView.prev_hash` (C-06b). Both were already
  on the reader's own objects — `DecodedRecord.index`, `Header.prev_hash` —
  and `_record_view` simply was not copying them through. `prev_hash`
  resolves PALA-1's thirty-two-zero-byte "no predecessor" convention to
  `null`, the same choice `span_id` already makes for "no span," confirmed
  against `palimpsests.audit.pala.incremental`'s own GENESIS check rather
  than assumed. The record card shows both; `prev_hash` as a fact, not yet
  a link — there is nothing here yet to compare it against (waits on U10).
- The record card (C-06a): `GET /session/{id}/record/{seq}` was already
  there from C-01; this adds the client, the view-model (`api/record.ts`)
  and the UI to actually look one up. Resolves the three ambiguous-null
  pairs `RecordView` carries — an unnamed type versus F7's fixed sentence
  for one, a kind that does not exist versus one this build cannot name,
  and a body that is absent, opaque, cleartext or undecoded — rather than
  collapsing any of them. An interim "open record #" field stands in for
  the seq-jump button until C-09 exists.
- Repository skeleton and the design contract the code is written against:
  `README.md`, `ARCHITECTURE.md`, `DEVELOPMENT-PLAN.md` and the governance
  set (`CONTRIBUTING.md`, `GOVERNANCE.md`, `SECURITY.md`,
  `docs/REVIEW.md`).
- `docs/adr/0001-the-shell-renders-verifier-output.md` — every PALA-1 fact
  this application renders comes from a verifier call in the `palimpsests`
  package; nothing here parses, decodes, hashes or interprets container
  bytes.
- `docs/adr/0002-the-bearer-token-is-the-boundary.md` — the per-launch
  bearer token is the sidecar's trust boundary; the CORS allowlist narrows
  browser access and is never relied on as protection.
- `scripts/check_no_wire_parsing.sh` — ADR-0001 made mechanical. Scans
  Python, Rust and TypeScript for wire-parsing primitives outside the seam
  module, reports how many files it examined, and fails the build on a hit.
- CI workflow: three-OS matrix, an `inventory` job that gates each check on
  the component it examines, and a single `ci-complete` fan-in context for
  branch protection.
- `scripts/coverage_gate.py` — statement ≥ 90 and branch ≥ 80 enforced
  together, which `--cov-fail-under` cannot do.
- Sidecar (A-04): the `palimpsests` seam, a loopback-only FastAPI service,
  a per-launch bearer token gate, and `/health`.
- Frontend and desktop shell (A-02, A-03): Vite, React, strict TypeScript,
  a Tauri 2 shell with a real Content Security Policy, and design tokens
  that encode the Proved / Recorded / Not checked distinction.
- `REUSE.toml` and `LICENSES/Apache-2.0.txt`; `reuse lint` runs in CI.

### Changed

- **Branch protection is enabled.** A repository ruleset on `main`, active
  from 17 August 2026, blocks direct pushes and force pushes, requires one
  approval from someone other than the author, requires `ci-complete` and an
  up-to-date branch, dismisses stale approvals, and has an empty bypass list
  so it applies to maintainers. `GOVERNANCE.md` records the measurement
  window; `CONTRIBUTING.md` and `docs/REVIEW.md` no longer describe a
  bootstrap exception.

### Fixed

- `GOVERNANCE.md`, `CONTRIBUTING.md` and `docs/REVIEW.md` had each stated
  that `main` was protected and that every change required a non-author
  approval, while none of it was in force. They were corrected to describe
  the actual posture, and are corrected again here now that it is.
- The ADR-0001 scan was examining **zero** Rust and TypeScript files while
  reporting success: `\|` is a literal pipe in ERE, and pathspecs of the
  form `src/**/*.rs` do not match `src/peek.rs`. Rebuilt on `git ls-files`,
  and it now reports the file count so an empty set is visible.
- The sidecar's token refusal returned 500 rather than 401. An
  `HTTPException` raised inside middleware does not reach the application's
  exception handlers.

### Notes

- The verification features are not implemented. Phase 1 opens a chain and
  answers the three questions; nothing before that produces a verification
  result.
- Pull requests #1 through #5 and the fifteen bootstrap commits predate the
  ruleset and were merged without a second approver. Pull request #6 is the
  first to require, and receive, a non-author approval. No review-coverage
  figure is reported for the earlier period.
