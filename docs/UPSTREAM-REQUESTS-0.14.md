<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Upstream requests for palimpsests 0.14

Three additions Auditor needs for two decided features (R1–R3), and six
requests and questions noticed since (R4–R9):

- **C-09d** — free text over `detail`. §22.3 is decided: MVP.
- **C-06d** — raw hex view with field highlighting (F7).

Each request is a reading of what the reader already holds. None of them
changes a verdict or the wire format. Numbering (U30+) and design are
Palimpsests' call. This document states the need, the rules a consumer
relies on, and how equivalence can be checked — the same shape as U28/U29
(#335).

Checked against `main` at the merge of #335.

**Status (released in 0.14.0):** R1–R3 shipped as U30 and U31 (#337) —
`RecordFields.detail`, `record_bytes_at()` → `RecordBytes(offset, header,
body)`, `header_tlv_spans_at()` and `body_tlv_spans_at()`, all in the
contract test. R5 and R6 shipped too (#347): `render_html` in channel 2,
and the existence note now says what the report checked. Auditor's body
filters moved onto `record_fields_at` in C-17(a); C-06d builds on R2 and
R3. R4 is planned for 0.15 as A5: `decode_shred(dr) -> ShredView`, with
`DecodedRecord.detail` left as rule 4 fixes it.

One note for 0.15, not a request: `report` has no `__all__`, so Auditor's
contract test checks channel 2 against the `INTEGRATION-SURFACE.md` table
rather than against `__all__` as it does for `reader`.

## R1 — `detail` in `RecordFields`

**Need.** Search over `detail` across a chain without decoding every
record.

**Today.** `RecordFields` (U29) carries `kind`, `source` and `outcome`, but
not `detail`. Reading it means `record_at()` on every record, which costs a
full decode: 21.9 s and 2.04 GB at 1M records, measured for the kind filter
on 0.13.1.

**Ask.** Add `detail: str | None` to `RecordFields`, read in place by the
rules `decode_record` applies:

- the first `EVT_DETAIL` wins;
- only on an EVENT or SAFETY body;
- decoded as UTF-8 with `"replace"`;
- `None` for an undecodable header, or an encrypted, empty or malformed
  body.

**Equivalence.** `record_fields_at(i).detail == record_at(i).detail` on
every record of the chains #335 already uses, plus three edge cases:

- two `EVT_DETAIL` TLVs in one body;
- invalid UTF-8;
- `EVT_DETAIL` on a record type that does not carry one.

**Expected cost.** In the order of the U29 kind filter: 5.9 s / 268 MB at
1M, nothing kept.

## R2 — the bytes of a record, as read

**Need.** A hex view shows the evidence, so it must show the bytes in the
file.

**Today.** There is no public accessor for those bytes. The only public
route is `Header.encode()`, and that is a re-encoding. For a non-canonical
or tampered header it shows what the encoder produces rather than what the
file holds — a claim a forensic view must not make. The reader already
returns raw header bytes internally (`_HeaderSeq.__getitem__`,
`body_span`).

**Ask.** `record_bytes_at(index) -> RecordBytes`:

- `offset: int` — the record's position in the file, so a reader can cite
  "byte N";
- `header: bytes` — fixed part plus header TLVs, exactly as stored;
- `body: bytes` — exactly as stored; ciphertext for an encrypted body.

Index rules as for `record_at`. Nothing is cached.

**Equivalence.** On every record:

- `Header.decode(record_bytes_at(i).header)` equals `header_at(i)`;
- `len(body) == header.body_len`;
- on canonical chains, `header == header_at(i).encode()`.

Also needed: a test where the bytes differ from the re-encoding (a
non-canonical header the decoder accepts), to show why the accessor exists
— if the decoder admits such a header at all.

## R3 — where each field sits

**Need.** Highlight every field in the hex view, not only the fixed header.

**Today.** The fixed header has `HEADER_FIELDS` (U4): 16 fields with offset
and length. Header TLVs and body TLVs have no public map. Body spans exist
privately (`_HeaderSeq.body_tlv_spans`).

**Ask.** Two public in-place reads:

- `header_tlv_spans_at(index)`
- `body_tlv_spans_at(index)`

Each returns `list[tuple[type, value_offset, length]]`, offsets relative to
the record's start (so they apply to `RecordBytes` directly). Each returns
`None` exactly when the decoder would reject the TLV list — as the private
body helper already promises.

**Equivalence.**

- For cleartext bodies, the spans reproduce `record_at(i).body_tlvs`:
  types, order and values sliced from `RecordBytes.body`.
- For header TLVs, the spans reproduce the TLVs `Header.decode` lists.
- `None` exactly where `record_at(i).body_tlvs` is `None` for a malformed
  body.

## R4 — `detail` on a KEY_SHRED (noticed in C-15)

**Need.** The inference vectors' `semantics` block states a `detail` for
the KEY_SHRED at seq 6 ("erasure request E-17"). `DecodedRecord.detail` is
decoded on EVENT and SAFETY bodies only (U12's scope), so a reader shows no
detail for that record, and R1 inherits the same rule.

**Question.** Whether `detail` should be decoded on KEY_SHRED bodies too —
or the vectors' statement is about the body's TLVs rather than a field a
reader exposes. Auditor's conformance test records the current behaviour
(`test_conformance_vectors.py`) and will follow either answer.

## R5 — the HTML report in the declared surface (noticed in D-01)

**Need.** Phase 3's D-01 renders the package's report "the JSON and the
HTML, neither rebuilt". `build_report` and `derive_verdict` are channel 2;
`palimpsests.audit.report_html.render_html` is not listed anywhere in
`INTEGRATION-SURFACE.md`, and the module has no `__all__`. Since C-16 the
seam imports only the declared surface, so Auditor shows the JSON and not
the HTML.

**Question.** Whether `render_html` (and `report_html`) should join channel
2 — or the HTML is the CLI's affair and a consumer should not render it.
Either answer settles D-01; nothing is rebuilt here meanwhile.

## R6 — the report's tier-A existence note (noticed in D-01)

**Observation.** A report on a tier-A chain carries
`"existence": {"external_pins": [], "note": "tier A: none available"}`.
Auditor removed the same assumption from its own screen in #69: SCITT
registration (`pala/scitt.py`) does not consult the tier, so a tier-A head
can be registered and receipted, and "none available" reads as a limit of
the tier rather than an absence in this file.

**Question.** Whether the note should say what the report checked — for
example, that no external pin was supplied or found — rather than what tier
A allows. Auditor shows the report as the package wrote it and does not
reword it (ADR-0001; D-03 audits only Auditor's own framing).

## R7 — the verdict for an empty container (noticed in C-17(b))

**Observation.** On 0.14.0 an empty file opens, `verify()` diagnoses
`empty_container` with `chain_ok: true`, and `build_report` gives it the
verdict **`partial`**; the CLI exits 2. The package's own sentence is
careful — "the check passes because there was nothing to check, not because
a log was found intact" — but the verdict word is the one a consumer reads
first, and `partial` is defined as "sound as far as checked". Core
clarification C-8 records Palimpsests' position as `violation`.

**Question.** Whether the verdict for `empty_container` should be
`violation`, as C-8 says, or `partial` is intended.

**Answer (Palimpsests).** C-8 as merged does not give `violation`: a
clarification cannot change a verifier's answer, and the core is frozen
(the r2 wording was corrected in #327). It records that the check passes
vacuously on zero records and that this means nothing was there, never that
a log was found intact. The stronger verdict is a report-format matter:
`pala-verification-report/2` (0.15) adds the verdict `empty`. With an anchor
the verdict is already `violation` — `replaced_or_rolled_back`, "a log was
written and is not here" — and that is why an empty file must open: refusing
it hides a deleted log. The package's own HTML printing "PARTIAL — sound as
far as checked" for an empty file is a rendering defect, fixed upstream.

**What Auditor does (C-17(b)).** Opens it. On report /1 it branches on
`diagnosis.pattern`: for `empty_container` the verdict `partial` is shown as
given, with the diagnosis narrative in place of the general sentence for
`partial`; `replaced_or_rolled_back` on a file with no records renders as
any violation. The special case is one function, removed when report /2
gives the verdict `empty`.

## R8 — the fixed header's field map in the declared surface (noticed in C-06d)

**Need.** C-06d's hex view names every field it highlights. `HEADER_FIELDS`
(U4) and `HeaderField` live in `palimpsests.audit.pala.codec`, outside the
consumer surface — neither is in `reader.__all__` or
`INTEGRATION-SURFACE.md`, and neither is `FIXED_HEADER_LEN`. 0.14 gives the
record's bytes as read and both TLV maps, but not the map for the fixed
bytes those spans sit after.

**Ask.** Re-export `HEADER_FIELDS`, `HeaderField` and `FIXED_HEADER_LEN`
from `reader`, under the contract test.

**Answer (Palimpsests).** Merged (#356), ships in 0.15. The sixteen fields
cover bytes 0–156 contiguously, each with its offset, length and struct
code; `magic`, `format_version` and `header_len` are in the map though they
are not `Header` attributes; every header TLV span starts at or after
`FIXED_HEADER_LEN`. C-06d starts on 0.15.

**R7, the HTML half.** The package's own HTML printing "PARTIAL — sound as
far as checked" for an empty container is fixed in #353, for 0.15. Until
then Auditor withholds that one page, with a sentence saying why (D-01b).

## R9 — the JSONL export in the declared surface (noticed in D-06)

**Need.** Phase 3's D-06 offers the package's JSONL export — `pala-jsonl/1`,
range-bounded, with the "derived, not authoritative" notice — and saves it
through D-07. `palimpsests.audit.export.export_jsonl(data, out, *,
from_seq, to_seq)` does exactly that, but it is in none of the seven
channels of `INTEGRATION-SURFACE.md`, and `audit.export` has no `__all__`.
Since C-16 the seam imports only the declared surface.

**Ask.** Declare `export_jsonl` and the `pala-jsonl/1` format as public —
a channel of their own or beside the report in channel 2 — with an
`__all__` on `audit.export` and a line in the contract test. Or, if the
export is the CLI's affair and a consumer should not produce it, say so,
and D-06 leaves the plan.

## Surface

- R1–R3 go into `reader.__all__`, `INTEGRATION-SURFACE.md` channel 1,
  and the contract test, as U29 did.
- No change to verify, reports, or the wire.

## What Auditor does meanwhile

- **C-09d shipped on 0.13** through the full-decode path the other body
  filters used. Since C-17(a), on 0.14, all of them read `record_fields_at`
  (R1): 12.9–13.7 s and 376 MB at 1M records, against 21.9 s and 2.04 GB.
- **C-06d waits for 0.15.** R2 and R3 shipped in 0.14, but the fixed
  header's map (R8) ships in 0.15; a hex view that could name every TLV and
  none of the header fields would be built twice. Rendering re-encoded bytes
  or computing offsets on this side would break ADR-0001, so nothing is
  built before the release that carries all three.
- **D-06 waits for R9.** Nothing is built on an undeclared module.
