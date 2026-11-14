<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Development plan

Scope: `FUNCTIONALITY.md`. Structure: `ARCHITECTURE.md`. Upstream requests:
`docs/UPSTREAM-REQUESTS-0.14.md`. What changed and why: `CHANGELOG.md`.

**This is the short plan.** The long one — every item's full account, the
splits of C-06, C-07, C-09 and C-10, the B-12 notes, the U14 investigation,
and the measurements behind them — stopped being worth re-sending with every
change at 83 KB. It is kept whole in git, at the last commit that had it:

    git show adcfbdf:DEVELOPMENT-PLAN.md

Rows below keep their ids, so anything citing one (a commit, a test, the
changelog) still finds it here, and its history there.

## How to read it

`✓` merged (or, in Track U, released); `◐` partly merged; no mark, not
landed. Effort in working days of focused effort, never dates. Work is
ordered by dependency, not visibility. A wrong estimate becomes `?`, never a
smaller number.

## Governance

Non-draft PR, non-author review, DCO sign-off, REUSE headers, `ruff` pinned
to CI's version, sidecar coverage ≥ 90 statement / ≥ 80 branch, release
tagged by the non-author of the bump. **No stacked PRs:** a PR starts from
`main` after the previous one merges. English in the repository, Ukrainian
in discussion.

## Track U — upstream, in Palimpsests

Usable here at its **release**, not its merge. From U16 on, Palimpsests
plans and costs the work (`CONSUMER-SURFACE.md` r2); this table keeps only
status and what it unblocks.

| Item | Status | Unblocks |
|---|---|---|
| ✓ U1–U13, U15 | released by 0.12.0 | Phases 1–2 |
| ✓ U14, U16, U17, U22, U23, U25 | released in 0.13.0 | C-10b, C-13 |
| ✓ U19 + U20 | released in 0.13.1 | C-13, C-14, C-16 |
| ✓ U18, U21, U24, U26, U28–U31 | released in 0.14.0 | C-17, D-01b |
| R4 — `decode_shred → ShredView` | planned, 0.15 (A5) | a KEY_SHRED's `detail` |
| R7 — HTML gloss for an empty container | merged (#353), **0.14.1** | C-19 ✓ |
| R8 — `HEADER_FIELDS` from `reader` | merged (#356), **0.14.1** | C-06d |
| R9 — `export_jsonl`, `pala-jsonl/1`, channel 2 | merged (#357), **0.14.1** | D-06 ✓ |
| U27 — `WRITER-SURFACE.md` | before 1.0 | C-15's writer-built fixtures |
| Report format `/2` — verdict `empty` | announced, 0.15 | C-18 |

## Phases

| Phase | State |
|---|---|
| 0 — scaffold (A-01…A-07) | ✓ closed |
| 1 — verify (B-01…B-11, B-12) | ✓ closed |
| 2 — browse (C-01…C-12) | 21 of 22; C-06d buildable on 0.14.1 (R8) |
| 0.13–0.14.1 follow-up (C-13…C-19) | ✓ except C-16(b) and C-18 (0.15) |
| 3 — report (D-01…D-07) | D-01, D-03, D-04, D-06, D-07 ✓; D-02 `?` |
| 4 — evidence artifacts (E-01…E-07) | not started |
| 5 — beyond MVP | not started |

**Phase 2's exit criterion** — a 1M-record chain opens, the timeline stays
interactive, "what happened at 22:41 on 6 Aug" in under five interactions —
is met as far as a script can say (C-10b, C-09c). Whether the window *feels*
interactive is the live desktop check below, not yet done.

## Open items

| Id | What | Days | Needs |
|---|---|---|---|
| C-06d | Raw hex view: the record's bytes as read, every header field and TLV highlighted from the package's maps — (a) header in the MVP, (b) body as fast-follow | ? | 0.14.1 (R8) |
| ◐ C-16(b) | The canary: the sidecar suite against Palimpsests `main`, outside `ci-complete`. Prepared as `canary.yml`; a workflow file cannot be committed through the tool this work uses | 0.5 | upload by hand |
| C-18 | 0.15: report `/2` and its verdict `empty`; remove the report /1 gloss override for `empty_container` (`api/report.ts`); R4's `ShredView` for a KEY_SHRED's `detail`; pin `>=0.15,<0.16` after the suite runs green on the candidate | 1 | 0.15 |
| D-02 | Print and PDF of the package's HTML | ? | D-01 |
| ✓ C-19 | 0.14.1: pin `>=0.14.1,<0.15`; R7 — the package's HTML is shown for an empty container too (the withheld page is gone; the JSON block's gloss override stays until report /2) | — | 0.14.1 |
| ✓ D-06 | **The record export, streamed.** `GET /session/{id}/export` carries `export_jsonl`'s `pala-jsonl/1` out as it is written — from a thread of its own, on a read-only mapping of the file (the package's ask: a mapping, not a copy), in blocks of ~256 KB through a queue of 16 (~4 MB in flight). The shell's `export_records` runs the save dialog, reads the response itself over loopback (no HTTP library: status, headers, chunked or close-framed body), writes it to the file as it arrives with its SHA-256 on the way, checks the last line is the summary (a cut-short stream leaves no file), and writes `.sha256` beside it. The webview names a session and a range only. **Measured at 1M records:** 767 MB in 48.6 s; the shell held 26 MB; the sidecar's peak, 674 MB, is the session's header index (C-10b) — held whole, the export alone took 1.7 GB. Byte-identical to `export_jsonl` for the same file. | 1.5 | 0.14.1 (R9) |
| E-01 | Evidence bundle UI over `pala bundle` | 1.5 | — |
| E-02 | Re-verification harness for bundles, from the spec, with no Auditor code | 3 | E-01 |
| E-03 | Record health over U1–U3, with F12's three disciplines | 5 | — |
| E-04 | Health summary in the report, labelled advisory | 1 | E-03 |
| E-05 | Local witness log, hash-chained, saying what it does and does not prove | 3 | — |
| E-06 | SCITT receipts as pins, displayed, never minted | ? | — |
| E-07 | Prefix-consistency proofs | ? | — |
| Phase 5 | Watch mode; the one write (oversight disposition, behind its own ADR); Rekor and TSA anchors (network, air-gap first); segment sequences; signed installers; `uk` pass | — | — |

**Next, in order:** the live desktop check; C-06d on 0.14.1; C-16(b) by
upload; C-18 on 0.15. Phase 4 starts by decision, not by default.

## Done recently

C-17(a) — body filters read fields in place on 0.14 (1M records: 13.7 s /
376 MB, was 21.9 s / 2.04 GB), held to the old walk over 1,032 comparisons.
C-17(b) — violation codes; a file with no records opens and the package
names it (an empty file against an anchor is a deleted log); own-keys
lookups for every table of package-supplied names. D-07 — save where the
user chose, SHA-256 beside it; both dialogs off the main thread. D-01b — the
package's HTML report, sandboxed, savable. D-06 — the record export,
streamed by the shell straight to the chosen file (1M records: 767 MB, the
shell at 26 MB). D-03 — the wording audit, kept as `src/wording.test.ts`;
three overclaims of our own removed.

## Risks

- **R1** — the shell drifts into a second format implementation. One seam;
  `check_no_wire_parsing.sh` and the C-16 contract test fail the build.
- **R2** — overclaim. D-03's test; the report says it attests a check.
- **R3** — CI cannot see a window. A live desktop session closes every UI
  phase. **Outstanding:** both file dialogs (D-07's fix), the framed HTML
  report under the shell's CSP (D-01b), empty and non-chain files (C-17b),
  a 1M-record chain, and the export dialog writing a large export (D-06).
- **R4** — Track U slips. Only what a release carries is built on.
- **R5** — scope creep into analytics. Nothing about record content.
- **R6** — the package is split into `palimpsests-audit`. A one-file change.
- **R7** — the one write erodes read-only. A command to the engine, behind
  an ADR, never bytes from the shell.
- **R8** — this plan describes work upstream has done. Read the upstream
  log since the pinned release before starting a phase.

## Definition of done, per phase

1. Every PR merged with non-author approval (ruleset on `main` since
   17 Aug 2026).
2. CI green on macOS, Linux, Windows; coverage gate met; `reuse lint` clean.
3. The exit criterion demonstrated on real fixture data, recorded in
   `CHANGELOG.md`.
4. A live desktop session for any phase with UI work.
5. No exception to `FUNCTIONALITY.md` §3's invariants, unless as an ADR.
6. The upstream log since the pinned release read and accounted for (R8).
