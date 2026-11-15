<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Upstream requests for palimpsests 0.15

Four requests and one question (R10–R14), noticed while scoping what
Auditor can build before 0.15 and Phase 4 (evidence artifacts). Same rules
as `UPSTREAM-REQUESTS-0.14.md`: none of them changes a verdict or the wire
format, numbering and design are Palimpsests' call, and each states what
was observed, on which version, and why it matters here.

Checked against **0.14.1** (PyPI) and Palimpsests **`main` at `ed36689`**
(#370), 15 November 2026.

## First, what `main` already answers

Read before asking, so nothing below asks for what is done:

- **The bundle says when a log does not hold together** (#365). On 0.14.1,
  `pala bundle` of a chain with one body altered after writing prints
  "chain verdict inside: sound", exits 0, and its `verification.json`
  carries `chain_ok: true` and no container or body check — while
  `pala verify` on the same file says `violation`. On `main` the bundle
  carries `consistent: false`. Auditor will not build E-01 (the bundle UI)
  on 0.14.1 for that reason; it waits for 0.15.
- **Question one as one answer** — `AuditReader.is_consistent()` and
  `Diagnosis.question` (#367). Auditor's T1 rule is the same rule; on 0.15
  the seam calls the package's instead of combining three fields.
- **The consumer canary** (#368). Auditor's sidecar suite was run here
  against `main` at `ed36689`: **435 passed, 5 skipped, 2 failed** — exactly
  the two tests `.github/consumer-canary/auditor-expected.txt` lists (report
  `/2`'s format string; the verdict `empty`). Nothing unlisted breaks.
  Auditor closed its own canary (C-16(b)) because this one exists.
- **Damaged chains for a consumer's tests** (`palimpsests.audit.testing`,
  #369). Auditor's fixtures that rewrite bytes at found offsets move onto
  it in 0.15.

## R10 — `__all__` on the public channels 3–6

**Observed.** `INTEGRATION-SURFACE.md` lists proofs (channel 3), the bundle
(4), health (5) and conformance (6) as public since 0.10. Their modules —
`pala/proofs.py`, `pala/bundle.py`, `timehealth.py`, `bootstats.py`,
`pala/selftest.py` — declare no `__all__` on 0.14.1 or on `main`.
`report.py` gained one (the 0.14 note); `export.py` has one since R9.

**Why it matters.** Since C-16, Auditor's seam imports only declared names,
and its contract test checks every imported name against the installed
module's `__all__`, so a name the package stops declaring fails on the pin
bump rather than in use. A module with no `__all__` cannot be held to that.
Phase 4 needs three of them: `assemble_bundle` (E-01), `consistency_proof`
/ `chain_root` / `ConsistencyProof` (E-07), and `run_selftest` — which
`INTEGRATION-SURFACE.md` recommends running at sidecar startup, and which
Auditor will.

**Ask.** An `__all__` on each of the five, naming what the channel table
names, under the contract test.

## R11 — a machine's local paths in documents made to be sent

**Observed (0.14.1 and `main`).** Read against a `FileAnchor`, two
documents carry the anchor file's full path on the checking machine:

- the report — `anchor.source_detail`, on report `/2` too; while the same
  report's `anchor.attempts[]` leaves `source_detail` out;
- the bundle — `verification.json`, in `anchor.source_detail` and in every
  `anchor_attempts[].source_detail`.

**Why it matters.** Report `/2` already decided the question for the
segments manifest: "the report holds no path of the machine that ran the
check", the manifest named by its file name. The anchor path is the same
kind of fact — a directory layout, a user name in a home path — in the two
documents whose purpose is to leave the machine: a bundle is "one file a
lawyer attaches". Auditor's own rule (T6) is that local paths stay local,
and it cannot reduce the path itself without rewriting the package's
document, which ADR-0001 rules out.

**Ask.** The same rule as the manifest for the anchor: the file name only,
in the report and in the bundle — or, if a full path is intended there,
say so in the format specs, and Auditor will warn before a save or an
export instead.

## R12 — the bundle on a large chain

**Observed.** `INTEGRATION-SURFACE.md`'s size envelope says
`assemble_bundle` reads the source fully, twice. It takes a path, so a
consumer that already holds the chain open — Auditor's session does,
memory-mapped, with its header index built — cannot hand it the reader or
the mapping, as `build_report(reader=…)` and `export_jsonl` (a mapping, not
a copy) allow.

**Why it matters.** E-01 offers a bundle of a selection from the open
chain. At 1M records Auditor's export streams 767 MB with the shell at
26 MB (D-06); a bundle made from the same session would read the file twice
more beside the mapping already held.

**Ask.** An additive `reader=` (or a mapping) on `assemble_bundle`, as
`build_report` has — or a note that the bundle is meant for selections
small enough that this does not matter, which E-01 would then enforce.

## R13 — the bundle reads time claims at literal offsets

**Observed (0.14.1 and `main`).** `assemble_bundle` reads `seq`,
`time_trust`, `monotonic_ns` and `wall_clock_ns` with
`struct.unpack_from` at 12, 100, 108 and `hb[11]`, from `iter_records`.

**Why it matters, briefly.** This is the U4-followup pattern outside the
codec, where #356's contract test — the field map held to the decoder —
does not reach. The numbers are right today. Raised as a question, not a
defect: `header_at()` or `HEADER_FIELDS` would make a drift fail loudly
here as it now does in the codec.

## R14 — question: when is 0.15 cut?

Not a request. Auditor's next work waits on it: C-18 (report `/2`, the
verdict `empty`, `ShredView`), the surface review's stage 2 (T8–T16), and
E-01 / E-07 (with R10). A rough date — or "after R10–R13 are decided" —
lets the plan say so instead of "when it ships".

## What Auditor does meanwhile

- Runs nothing above on 0.14.1; the pin stays `>=0.14.1,<0.15`.
- D-02 (print and PDF of the package's HTML report) and the live desktop
  check proceed: neither needs anything here.
- On 0.15: C-18 first, then stage 2, then E-01 / E-07 as R10 allows.

---

## Answers (Palimpsests, 15 November 2026)

R10–R13 are done in one pull request, **#373**, CI green including the
consumer canary. Checked here against its head (`8485497`), not taken on
trust:

- **R10.** `pala.proofs`, `pala.bundle`, `timehealth`, `bootstats`,
  `pala.selftest` and `pala.vectors` declare `__all__`, result types and
  format ids included; the package's contract test holds each to the
  surface document. Confirmed by import.
- **R11.** For a file anchor, `anchor.source_detail` is the file's name in
  report `/2` and in the bundle's `verification.json`, attempts included;
  an attempt's error that quoted the path names the file. Confirmed: no
  part of the anchor's directory appears in either. The reader's own
  `Verification.anchor` still carries the full path — local, so T6 applies
  to what Auditor renders from it. In `pala-bundle/1` this is a changed
  value under the same key and format id, said so in the spec; a bundle is
  now the same bytes on any machine.
- **R12.** `assemble_bundle(..., reader=…)`, the rule of `build_report`:
  used as given, never closed, `ValueError` beside `anchor_source`.
  Confirmed: the archive is byte-identical with and without a reader.
  Measuring it found a defect upstream — a range of proofs rebuilt its
  checkpoint's tree for every record — fixed in the same PR. On 10⁶
  records: 1,000 records 63 s / 583 MB → 9 s / 406 MB; 100,000 records
  14 s / 1.3 GB, a 239 MB archive; the whole chain does not fit in 8 GB.
  **A bundle is for a selection**, and E-01 must bound it; a streamed
  whole-chain bundle is not planned for 0.15.
- **R13.** The bundle reads `seq`, `time_trust`, `monotonic_ns`,
  `wall_clock_ns` through `HEADER_FIELDS`; a test moves the map and checks
  the bundle follows. Confirmed in the source.
- **R14.** 0.15 is targeted to be tagged by **24 December 2026**, not
  waiting on R10–R13. Still open before the tag: the support policy, the
  stability class of the serve HTTP surface, the release checks.

Auditor's sidecar suite against #373: 435 passed, 5 skipped, 2 failed — the
same two the canary's ledger lists, which leave it with C-18.

Also in 0.15 since `ed36689`, noted for later: SCITT statements are a public
channel (#371, `StatementRefused` with a `code`); COSE alg `-19` and a
key-type check (#372, refusal code `key_type_mismatch`, which was
`signature_invalid` before); writer durability (#370), nothing for a reader.

**Left for E-01, not asked:** the 9 s at 1,000 records is the whole-file
verification every bundle carries; with the session's reader, already
verified, it should cost less. Measured on 0.15 before the bound is set.
