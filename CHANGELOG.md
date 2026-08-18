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
