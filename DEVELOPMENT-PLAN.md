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
| Report format `/2` — verdict `empty` | **0.15.0** | C-18 ✓ |
| R10 — `__all__` on channels 3–6 | **0.15.0** | E-01, E-07, selftest |
| R11 — anchor file named, not pathed, in report `/2` and bundle | **0.15.0** | E-01; T6 holds for what leaves |
| R12 — `assemble_bundle(reader=…)`; a bundle is for a selection | **0.15.0** | E-01 (with a bound) |
| R13 — the bundle reads time claims through `HEADER_FIELDS` | **0.15.0** | — |
| **0.15.0 — released 22 Nov 2026** (profile r9) | ✓ pinned `>=0.15,<0.16` | C-18, stage 2, Phase 4 |
| Profile r8 — the writer's own `WRITER_OPEN` (13) / `WRITER_CLOSE` (12); advisory `boot_ended_without_close` | **0.15.0** | T18 ✓ |
| `EVT_SOURCE` 2 `derived-from-telemetry` (r7); digests over RFC 8785 | **0.15.0** | T19 ✓, T20 ✓ |
| R15 `build_report(health=True)` · R16 `SegmentCheck.declared_*` · R17 `TailingReader` (channel 9, provisional) | **0.15.0** | E-04, segment panel, F15 |
| Profile r9 — `REPORTS_REFUSED` (14), advisory `reports_refused`; `decode_shred` (R4) | **0.15.0** | card ✓, advisory ✓ |

## Phases

| Phase | State |
|---|---|
| 0 — scaffold (A-01…A-07) | ✓ closed |
| 1 — verify (B-01…B-11, B-12) | ✓ closed |
| 2 — browse (C-01…C-12) | ✓ closed (C-06d on 0.14.1) |
| 0.13–0.15 follow-up (C-13…C-19) | ✓; C-16(b) closed unbuilt |
| 3 — report (D-01…D-07) | ✓ closed (D-02 last) |
| 4 — evidence artifacts (E-01…E-07) | started 16 Nov 2026: E-05 ✓; E-01, E-07 on 0.15 |
| 5 — beyond MVP | not started |

**Phase 2's exit criterion** — a 1M-record chain opens, the timeline stays
interactive, "what happened at 22:41 on 6 Aug" in under five interactions —
is met as far as a script can say (C-10b, C-09c). Whether the window *feels*
interactive is the live desktop check below, not yet done.

## Open items

| Id | What | Days | Needs |
|---|---|---|---|
| ✓ C-06d | Raw hex view: `GET /session/{id}/record/{seq}/bytes` gives the record's bytes as read (`record_bytes_at`) with `HEADER_FIELDS` and both TLV span lists; the record card's **bytes** lays them out sixteen to a row, every name and boundary the package's, a byte no span covers unnamed. Header and body together — the body's map came in the same release, so (a)/(b) did not need splitting. A body is cut at 4 KiB and says so | 1 | 0.14.1 (R8) |
| ✗ C-16(b) | The canary against Palimpsests `main`. **Closed unbuilt (T7, 15 Nov 2026).** A workflow file cannot be committed through the tool this work uses, and what the canary would catch early is caught at the bump: the C-16 contract test fails on any name the package stops declaring, the pin's upper bound keeps an unread release out, and C-18's rule is to pin only after the suite runs green on the candidate. Palimpsests now runs this repository's sidecar suite against its every commit (#368), with a ledger of intended breaks — the canary exists, upstream. Reopen if a release ever lands broken past those | — | — |
| ✓ C-18 | 0.15: report `/2` and its verdict `empty`; remove the report /1 gloss override for `empty_container` (`api/report.ts`); R4's `ShredView` for a KEY_SHRED's `detail`; pin `>=0.15,<0.16` after the suite runs green on the candidate | 1 | 0.15 |
| ✓ D-02 | Print and PDF of the package's HTML. **Print…** in the Report block: the shell opens the page in a window of its own from a `data:` URL (opaque origin, the app's CSP written in, no capability names the window) and asks the OS to print it once loaded; PDF is the OS dialog's offer. A page over 1.4 MB (WebView2's 2 MB `data:` limit, base64) is refused with a sentence pointing at **Save HTML…** | 0.5 | D-01 |
| ✓ C-19 | 0.14.1: pin `>=0.14.1,<0.15`; R7 — the package's HTML is shown for an empty container too (the withheld page is gone; the JSON block's gloss override stays until report /2) | — | 0.14.1 |
| ✓ D-06 | **The record export, streamed.** `GET /session/{id}/export` carries `export_jsonl`'s `pala-jsonl/1` out as it is written — from a thread of its own, on a read-only mapping of the file (the package's ask: a mapping, not a copy), in blocks of ~256 KB through a queue of 16 (~4 MB in flight). The shell's `export_records` runs the save dialog, reads the response itself over loopback (no HTTP library: status, headers, chunked or close-framed body), writes it to the file as it arrives with its SHA-256 on the way, checks the last line is the summary (a cut-short stream leaves no file), and writes `.sha256` beside it. The webview names a session and a range only. **Measured at 1M records:** 767 MB in 48.6 s; the shell held 26 MB; the sidecar's peak, 674 MB, is the session's header index (C-10b) — held whole, the export alone took 1.7 GB. Byte-identical to `export_jsonl` for the same file. | 1.5 | 0.14.1 (R9) |
| E-01 | Evidence bundle UI over `assemble_bundle(reader=…)` from the session. **Bounded selection** — a bundle carries a proof path per record and outgrows its source (R12: 1,000 records 9 s / 406 MB; 100,000 records 14 s / 1.3 GB; the whole of 10⁶ does not fit in 8 GB); the bound is set by measuring on 0.15 | 1.5 | 0.15 (R10, R12) |
| E-02 | Re-verification harness for bundles, from the spec, with no Auditor code | 3 | E-01 |
| ◐ E-03 | Record health over U1–U3, with F12's three disciplines. **Built on 0.14.1:** `/record-health` (step catalog, boot statistics with anchor gaps, wall gaps between boots, SAFETY by kind × boot, recurring details) and the **Record health** panel, every block under its basis (proved / monotonic / recorded), no threshold, no verdict word. **Left:** drift per boot (U1, 0.15 via R10); warnings against origin events; baseline change — §22.4's thresholds stay open | 5 | 0.15 for drift |
| ✓ E-04 | Health summary in the report, labelled advisory — **decided by R15 (Palimpsests #380, 0.15):** `build_report(health=True)`; Auditor shows the report's own `health` section beside E-03's series, and makes no document of its own | 1 | 0.15 |
| ✓ E-05 | Local witness log: `auditor-witness/1`, JSON Lines, each entry the SHA-256 of the one before (ADR-0003, `docs/WITNESS-LOG.md`). One entry per first `/verify` of a session and profile, holding the package's facts, never a verdict; `GET /witness` walks it; a log that does not link is not appended to and the check says so. The panel says what it shows and what it does not — a cut tail still links. `scripts/check_witness_log.py` checks a log with nothing from this repository | 3 | — |
| E-06 | SCITT receipts as pins, displayed, never minted | ? | — |
| E-07 | Prefix-consistency proofs (`consistency_proof`, `chain_root`) | ? | 0.15 (R10) |
| Phase 5 | Watch mode; the one write (oversight disposition, behind its own ADR); Rekor and TSA anchors (network, air-gap first); ~~segment sequences~~ (✓ 18 Nov 2026, §22.1); signed installers; `uk` pass. **Watch mode (F15)** is planned against 0.15: `TailingReader` is channel 9, provisional (R17) — pin the minor | — | — |

**Next, in order:** the live desktop check on the Windows installer (F-01);
E-01 (bundle, bounded selection — T15, T22) and E-07 (consistency proofs);
then watch mode (F15, R17 — provisional, its own phase). Done on 0.15
(23 Nov 2026): C-18 and stage 2 T8–T14, T16; the addendum's T18–T21.

## 0.15 addendum (T18–T23, 19 Nov 2026)

`TASK-AUDITOR-0.15-ADDENDUM.uk.md` continues the surface review's T1–T17.
On 0.15 the sidecar suite fails 40 tests: the 2 known (report `/2`, verdict
`empty` — T8) and 38 from profile r8. Palimpsests' canary ledger lists them;
a line goes when its test passes again.

| # | Task | Size | What | Before the tag |
|---|---|---|---|---|
| ✓ 1 | T8 + T18 (tests) | M | fixtures that test records by number build with `lifecycle=False`; at least one stays in the default mode and its numbers are rewritten; vector counts read from the vectors | feature-detected, so the same suite runs on 0.14.1 and on `main` |
| ✓ 2 | T18 (product) | M | `WRITER_OPEN` / `WRITER_CLOSE` in the list and the record card (`detail` = writer and version); `boot_ended_without_close` worded — not a violation, verdict unchanged; record health shows closed, unclosed and last boot; anchor advice: anchor after the writer stops | names and texts; shown once 0.15 writes them |
| ✓ 3 | T19, T21 (R16) | S | `derived-from-telemetry`: the pair was written when the export arrived, not at the call; the segment panel says a missing segment's declared range and head | texts; R16 on 0.15 |
| ✓ 4 | T21 (R15 → E-04) | M | the report's own `health` section | 0.15 |
| 5 | T20, T22 | S | origin panel: a new origin at the 0.14 → 0.15 boundary is a digest-rule change, not a configuration change; file anchor named, not pathed; E-01's bounded selection; SCITT `key_type_mismatch` (19 codes); T12's exceptions removed | texts; code on 0.15 |
| 6 | T21 (R17 → F15) | L | watch mode — a phase of its own, pinned to the minor | 0.15 |

T23 (`docs/SERVE-SURFACE.md`) is reference only: Auditor never calls serve.

## Done recently

Segment sets (18 Nov 2026, §22.1): **Open a segment set…** (or a dropped
`segments.json`) checks the set with the package's `verify_segment_set` —
consistent and complete kept apart, every segment with what was found of
it, each present one opened as a chain of its own. Asked of the package
later: the manifest's declared range and head for a segment that is gone
(`SegmentCheck` carries neither), so the screen can say what is missing,
not only that something is.

F-01 (16 Nov 2026): an unsigned Windows installer from CI
(`.github/workflows/installers.yml`) — the sidecar frozen with PyInstaller
and bundled through Tauri's `externalBin`, driven end to end before the
installer is built (`sidecar/tests/smoke_frozen_sidecar.py`); the shell
starts the bundled binary when there is one, without a console window.
macOS and Linux installers follow the same shape when they are wanted.

The usability and accessibility review (16 Nov 2026, `docs/UX-REVIEW.md`):
Nielsen's ten and WCAG 2.2 AA, the layout redone for the window, axe-core
from 83 violations to none. Left open there: a screen-reader pass, the
Chronoscope's interaction (F6), closing a file.

The surface review's stage 1 (15 Nov 2026): T1 — question one answered from
`chain_ok`, a well-formed container and no body digest mismatch, the
diagnosis only routing its sentence; T2 — the empty chain's head is "not
checked"; T3 — the export shows its own summary's `consistent`; T4 — the
report names the sidecar's build; T5/T16 — documents re-read against
0.14.1, exit code 1 is `VIOLATION`; T6 — local paths stay local; T7 —
C-16(b) closed. C-06d — the raw view, every boundary the package's.
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
  a 1M-record chain, the export dialog writing a large export (D-06), the
  export's summary line (T3), **Print…** and the PDF it saves (D-02 — no window in CI at all), and the raw view (C-06d — checked in a headless
  browser against the sidecar; the window is what is left).
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
