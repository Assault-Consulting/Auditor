# Schema delta 2026-08 — pala-verification-report/1 (§15 amendments)

Status: **adopted upstream** (Palimpsests PR #168); to be folded into
FUNCTIONALITY.md §15 together with the D-01 draft. Source: the joint
interface audit of the Palimpsests↔Auditor surface, 2026-08-23.

The shape's machine truth now **ships inside the palimpsests wheel**:
`palimpsests/audit/_schemas/pala-verification-report-1.schema.json`
(JSON Schema 2020-12, `additionalProperties: false`). Every rendering
this project produces MUST validate its input against the schema of the
**installed** package version — not against a copy checked into this
repo, which would be a second source of truth.

## Amendments to the §15 shape

1. **`verdict` (top-level, new, required).** `"sound" | "partial" |
   "violation"`, produced ONLY by
   `palimpsests.audit.report.derive_verdict`. A renderer reads the
   field or calls the function; it MUST NOT re-derive the rule. This
   closes the audit's finding K1: the verdict rule previously lived in
   the upstream CLI only, and every rendering would have re-implemented
   the one word that matters.

2. **`container` (top-level, new, required).** §2.4 well-formedness and
   the body↔header digest binding, attested by the report's own walk:
   `{well_formed, malformed, bytes_parsed, bytes_total,
   body_digest_mismatches}`. Closes K2 (a truncated file previously
   yielded a report that read healthier than `pala verify` on the same
   bytes) and K5 (a body swap under an intact header chain was
   invisible to a header-only check). Rendering guidance: when
   `well_formed` is false or `body_digest_mismatches` is non-empty, the
   report page states it in the findings, not a footnote — these are
   verdict-carrying facts.

3. **`anchor.observed_at_ns` semantics.** `null` means the anchor
   source does not carry an observation time (today's file/manual
   sources). Render as "observation time: not recorded by the source",
   never as an error and never as 1970.

## Rules for this project's renderings

- **Golden-test normalization:** normalize away `checked_at` and the
  version-carrying fields `verifier.tool` / `verifier.package` before
  comparing reports. Everything else is deterministic for identical
  inputs — a golden diff outside those fields is a real regression.
- **Live files (copy-then-read):** a chain under active writing may end
  in a partial record. Verify a *copy*; a malformed tail on a live file
  is "a record in flight", not evidence of tampering. The same defect
  in a quiescent copy is a real finding. The UI never shows a tamper
  verdict for a live-file tail.
- **Sidecar startup:** run `palimpsests.audit.pala.selftest.run_selftest()`
  at sidecar start and surface an UNSOUND result to the user before any
  verification is offered. The packaged vectors make this an offline
  check.
- **Conformance tests:** the companion vector set's `semantics` block
  covers a subset of records by design (it grows additively); assert
  against the seqs present, never assume totality.
- **Size envelope:** the upstream reader is in-memory and comfortable to
  ~10^6 records / hundreds of MB; multi-GB retention archives are
  segmented before interactive use. Do not offer an unsegmented multi-GB
  open in the UI without a warning.

Full surface contract upstream: `docs/INTEGRATION-SURFACE.md` in the
Palimpsests repository — the governing text where this delta and §15
disagree until the fold-in.
