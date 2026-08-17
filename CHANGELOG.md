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

- Repository skeleton and the design contract the code will be written
  against: `README.md`, `FUNCTIONALITY.md` (functional specification and
  the seven invariants), `ARCHITECTURE.md` (three processes, the package
  seam, the sidecar API, the two air-gap layers), `DEVELOPMENT-PLAN.md`
  (phases, PR-level breakdown, risks) and `ENVIRONMENT.md` (toolchain,
  scaffold, known CI traps).
- Project governance: `CONTRIBUTING.md`, `GOVERNANCE.md`, `SECURITY.md`,
  `docs/REVIEW.md` (what a reviewer checks) and `docs/PRACTICES.md` (the
  engineering practices carried over from Palimpsests, with the reasoning
  kept).
- `docs/adr/0001-the-shell-renders-verifier-output.md` — the load-bearing
  decision: every PALA-1 fact this application renders comes from a
  verifier call in the `palimpsests` package; nothing here parses,
  decodes, hashes or interprets container bytes.
- `scripts/check_no_wire_parsing.sh` — ADR-0001 made mechanical. Scans
  Python, Rust and TypeScript for wire-parsing primitives outside the seam
  module and fails the build on a hit. Also asserts that
  `sidecar/auditor_sidecar/pala_seam.py` is the only importer of
  `palimpsests`.
- CI workflow with a single `ci-complete` fan-in check for branch
  protection, least-privilege token permissions, and actions pinned by
  commit SHA.
- `REUSE.toml`, declaring the tree Apache-2.0 with a recorded CC0-1.0
  exception for the report and bundle schemas that land in D-01 and E-01.

### Fixed

- `GOVERNANCE.md`, `CONTRIBUTING.md` and `docs/REVIEW.md` each stated that
  `main` is protected and that every change requires an approval from
  someone other than the author. None of that was in force: protection is
  off, there is no second reviewer, and the skeleton was pushed directly to
  `main`. All three now describe the actual posture and mark the
  requirement as standing-but-not-yet-enforced.

### Notes

- Nothing is implemented yet. This entry covers the design contract and
  the project's controls, not behaviour.
- CI is red until A-03 and A-04 land the scaffold its jobs reference. The
  workflow states the target and the scaffold grows into it.
- Branch protection is not yet enabled and there is no second reviewer;
  pull requests are authored and merged by the lead maintainer alone. The
  governance documents describe that state rather than the target, and
  `GOVERNANCE.md` will record the date it changes. No review-coverage figure
  is reported for this period.
