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

| PR | Content | Days | Blocks |
|---|---|---|---|
| U1 | Drift series per boot as structured advisory output: `d_i = (wall_i − wall_0) − (mono_i − mono_0)`, slope in ppm. Pure arithmetic on existing header fields, O(n), no wire change. | 2 | F6, F12 |
| U2 | Step catalog: each detected discontinuity with magnitude, direction, `seq`, classified slew / step / regression. | 2 | F6, F12 |
| U3 | Per-boot statistics: record counts, uptime by monotonic, anchor cadence and lag distribution, span durations, open-span rate. | 2 | F12 |
| U4 | Header field map exported for rendering, so a hex inspector can highlight fields without knowing offsets. | 1 | F7 |
| U5 | Merkle inclusion proofs for a `seq` range, over the existing RFC 6962 aggregation. | 3 | F13 |
| U6 | Verification-report model as a package dataclass — one owner for the `pala-verification-report/1` schema. | 2 | F11 |
| U7 | `time_trust` / `assurance_tier` constant→name tables exported, following the §10.5 pattern already used for kinds. | 0.5 | F2, F6 |

**Track U total: ~12.5 days.** U7, U4 and U1 are the cheap ones and should
land first — U7 in particular is half a day and removes a whole class of
"the shell re-typed a constant" defects.

Note on U1–U3: these must be **advisory** output, never verdict fields.
The existing `Advisory` channel shape is already fixed for exactly this
kind of extension.

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
| B-05 | Keychain anchor source (`keyring`), three OSes | 2 | B-04, U7 |
| B-06 | UI: verdict triptych, tier-aware wording, not-checked state | 3 | B-03 |
| B-07 | UI: anchor provenance flow — answering link highlighted, absent dimmed, error named | 2 | B-04 |
| B-08 | UI: diagnosis card, seven patterns, each with its visual | 3 | B-03 |
| B-09 | UI: advisory lane, grouped by code, jump targets | 2 | B-03 |
| B-10 | Golden-vector suite: agreement with `palimpsests audit verify` exit codes on every published vector | 2 | B-03 |
| B-11 | Mutation-demo fixture suite: each mutation → its expected pattern and copy | 2 | B-08 |

**Phase 1: ~22.5 days.**

**Exit criterion:** every published test vector and every mutation
fixture produces the correct verdict, the correct diagnosis pattern, and
correct anchor provenance — verified against the CLI, not by eye.

## 5. Phase 2 — Browse

| PR | Content | Days | Needs |
|---|---|---|---|
| C-01 | `/boots`, `/spans`, `/records` (paginated, filtered), `/record/{seq}`, `/origin` | 3 | B-01 |
| C-02 | `/timeline` density buckets, both axes, boot-gap markers | 2 | C-01, U1 |
| C-03 | UI: Chronoscope — date rail with pinned caps, fine strip, axis toggle, wall-gap hatch with the ruler removed inside it, pins row | 5 | C-02 |
| C-04 | UI: accordion compression for empty stretches, with explicit marks | 2 | C-03 |
| C-05 | UI: boot and span lists; unclosed span as first-class evidence | 2 | C-01 |
| C-06 | UI: record inspector, envelope, TLVs, opaque bodies, clickable `prev_hash`, hex view with field highlighting | 3 | C-01, U4 |
| C-07 | UI: SAFETY list and the r2 oversight loop — unacknowledged candidates as the loudest element | 3 | C-01 |
| C-08 | UI: origin card, Recorded badge, `since_seq` jump | 1 | C-01 |
| C-09 | Search bar: free text over `detail`, filter chips, time jump, seq jump, three quick buttons | 3 | C-01 |
| C-10 | Performance pass: virtualised record table, off-thread verify, 100 MB / ~1M-record target | 3 | C-03 |

**Phase 2: ~27 days.**

**Exit criterion:** a 1M-record chain opens, the timeline stays
interactive, and "what happened at 22:41 on 6 Aug" is answerable in under
five interactions.

## 6. Phase 3 — Report

| PR | Content | Days | Needs |
|---|---|---|---|
| D-01 | Report model wired to U6; `pala-verification-report/1` JSON | 2 | U6, B-03 |
| D-02 | PDF renderer, Dossier layout, Proved/Recorded margin badges | 4 | D-01 |
| D-03 | Wording audit: every sentence checked against L4 and the no-overclaim rule | 1 | D-02 |
| D-04 | Determinism test: same file + same anchor → identical bytes except `checked_at` | 1 | D-01 |
| D-05 | Report round-trip test: rebuild the JSON from a fresh reader run and compare | 1 | D-01 |
| D-06 | JSONL export passthrough with range bounds and the derived-not-authoritative notice | 1 | B-01 |

**Phase 3: ~10 days. This is the MVP boundary.**

**MVP total: Phase 0 + 1 + 2 + 3 + Track U(U1,U4,U6,U7) ≈ 73 days**
of focused effort. That number is the honest one. If it has to shrink,
the cut lines are C-04, C-09 and B-05 — in that order — not the tests.

## 7. Phase 4 — evidence artifacts

Where the tool stops being a viewer and starts producing artifacts a third
party can re-check without it.

| PR | Content | Days | Needs |
|---|---|---|---|
| E-01 | Evidence bundle: records + inclusion proofs + verification + manifest + the explicit time-claims section | 5 | U5 |
| E-02 | Independent re-verification harness for bundles: a from-the-spec script with no Auditor code reproduces every claim | 3 | E-01 |
| E-03 | Record health: aggregation and trends over U1–U3 output; the three disciplines enforced in the UI copy | 5 | U1–U3 |
| E-04 | Health summary into the JSON report, labelled advisory, carrying its caveats | 1 | E-03, D-01 |
| E-05 | Local witness log: hash-chained record of checks performed, with the honest statement of what it does and does not prove | 3 | B-03 |

**Phase 4: ~17 days.**

## 8. Phase 5 — beyond MVP

| Item | Notes |
|---|---|
| Watch mode over `TailingReader` | Read-only tail; live verdict, live SAFETY feed, unacknowledged-candidate alert |
| Rekor anchor source | Network. Opens the air-gap layers for the first time — both must be demonstrably enforced before this merges |
| TSA anchor source (RFC 3161) | Same gate |
| Segment sequences | Several files as one logical chain; behaviour when a segment is missing |
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

**R4 — Track U slips and Phase 1 stalls.** Mitigation: B-01…B-04 and
B-06…B-11 depend only on U7 (half a day). U1, U4, U5, U6 block Phase 2
and 3 items, which are later. The plan is already ordered so that a Track
U slip costs Phase 2 time, not Phase 1 time.

**R5 — Scope creep into analytics.** The boundary is written into the
non-goals and repeated in F12's three disciplines. The operative rule: no
analytics PR merges before verify and report are impeccable.

**R6 — Package extraction (`palimpsests-audit`) lands mid-development.**
Mitigation is §4 of the architecture: one seam file. The extraction is a
one-file diff plus a dependency change.

## 10. Definition of done, per phase

A phase closes when all of the following hold:

1. Every PR in the phase is merged with non-author approval.
2. CI green on macOS, Linux and Windows; coverage gate met.
3. `reuse lint` clean.
4. The phase's exit criterion is demonstrated on real fixture data, with
   the demonstration recorded in `CHANGELOG.md`.
5. A live desktop session review has been done for any phase containing
   UI work.
6. No invariant from `FUNCTIONALITY.md` §3 has an exception in the merged
   code — and if one was needed, it is documented as an ADR, not as a
   comment.
