<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# ADR-0001: The shell renders verifier output; it never parses wire bytes

- **Status:** Accepted
- **Date:** 2026-08-17
- **Scope:** Whole repository
- **Related:** `FUNCTIONALITY.md` §3 (L1), `ARCHITECTURE.md` §3

## Context

Auditor displays facts about a PALA-1 container: sequence numbers, hashes,
boot and span structure, verdicts. Every one of those facts has two
possible origins — a call into the `palimpsests` verifier, or a few lines
of code in this repository that reach into the bytes directly.

The second option is always locally cheaper. Reading a `seq` is a
`struct.unpack` at a known offset. Rendering a record hash is one
`sha256`. Highlighting a header field in a hex view is arithmetic on
constants that are, after all, frozen. Each individual case is trivially
correct and saves a round trip.

The aggregate is a second implementation of PALA-1 — one with no
specification of its own, no test vectors, no differential test against
the reference implementation, and no independent verifier checking it. It
will drift. When it drifts, the failure mode is not a crash: it is a tool
that displays "valid" for a chain the verifier rejects, inside a product
whose entire proposition is that its answers can be trusted.

The upstream project spent considerable effort making the format
falsifiable: a frozen specification, published test vectors regenerated
and byte-compared in CI, two independent verifiers written from the prose
alone, and a differential test pitting the production codec against a
standalone reference. A shell that parses bytes sits outside all of it.

The `AuditReader` docstring already states the intended discipline —
"Every fact a shell renders comes from `AuditReader`; shells never parse
wire bytes." This ADR makes that binding on this repository and makes it
mechanically enforced.

## Decision

**Every PALA-1 fact this application renders is obtained from a
`palimpsests` verifier call.** No component of this repository — Python,
Rust or TypeScript — parses, decodes, hashes or interprets container bytes.

Three consequences are accepted deliberately:

1. **One seam.** All imports of `palimpsests.*` live in
   `sidecar/auditor_sidecar/pala_seam.py`. Nothing else imports the
   package. When the audit subsystem is extracted into the
   `palimpsests-audit` distribution, exactly one file changes.

2. **Missing capability is an upstream PR, not a local workaround.** When
   the shell needs something the package does not expose — a drift series,
   a header field map for the hex inspector, Merkle inclusion proofs for a
   range — the answer is a pull request against Palimpsests, where the
   logic is differential-testable and where the CLI and every third-party
   verifier gets it too. These are tracked as Track U in
   `DEVELOPMENT-PLAN.md`. This is slower, and it is the point.

3. **Mechanical enforcement.** A CI test scans this repository's sources
   for wire-parsing primitives — `struct.`, `unpack`, `MAGIC`,
   `record_hash`, direct `sha256` over container data, literal byte
   offsets — outside the seam module, and fails the build on a hit. A
   contract test additionally compares the sidecar's serialised output to
   a direct `AuditReader` call in the same process, catching any field the
   sidecar invented rather than passed through.

## Alternatives considered

**Parse in the sidecar, verify in the package.** Rejected. It sounds like
a division of labour and is in fact the drift scenario with extra steps:
the moment the sidecar decodes a header to build a table, its decoding and
the verifier's decoding are two implementations that must agree, with
nothing checking that they do.

**Reimplement the reader in Rust for performance.** Rejected on the same
grounds, more strongly: it would be a third implementation, in a language
where the reference implementation does not exist, maintained by the party
with the least incentive to find its own divergences. The measured
constraint is I/O and rendering, not decode speed; the package already
does one pass and decodes bodies lazily.

**Rely on review discipline rather than a CI check.** Rejected. The
violation always arrives as a small, locally-reasonable helper inside a
larger PR, and it arrives when the deadline is close. A grep in CI costs
nothing and does not get tired.

## Consequences

- Auditor cannot render a fact the package cannot produce. Where that
  bites, the fix is upstream and benefits every consumer.
- The package's public surface, not this application's convenience,
  determines the roadmap order. Track U is therefore a prerequisite, not
  a nice-to-have.
- A whole class of divergence bugs cannot occur, and the claim "this tool
  shows what the verifier says" is true by construction rather than by
  assertion — which is the only form of that claim worth making in a
  product about trustworthy records.
- Reversing this decision requires a superseding ADR and a lead-maintainer
  decision. It is not a per-PR argument.
