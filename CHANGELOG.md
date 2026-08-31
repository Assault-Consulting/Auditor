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
