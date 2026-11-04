<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Upstream requests for palimpsests 0.14

Three additions Auditor needs for two decided features:

- **C-09d** — free text over `detail`. §22.3 is decided: MVP.
- **C-06d** — raw hex view with field highlighting (F7).

Each request is a reading of what the reader already holds. None of them
changes a verdict or the wire format. Numbering (U30+) and design are
Palimpsests' call. This document states the need, the rules a consumer
relies on, and how equivalence can be checked — the same shape as U28/U29
(#335).

Checked against `main` at the merge of #335.

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

## Surface

- All three go into `reader.__all__`, `INTEGRATION-SURFACE.md` channel 1,
  and the contract test, as U29 did.
- No change to verify, reports, or the wire.

## What Auditor does meanwhile

- **C-09d ships on 0.13** through the same full-decode path the other body
  filters use (`_records_by_body`): correct on every chain, slow on large
  ones. It moves to `record_fields_at` with R1, alongside `kind:`,
  `source:` and `outcome:` (planned C-17).
- **C-06d waits for R2 and R3.** Rendering re-encoded bytes or computing
  offsets on this side would break ADR-0001, so nothing is built before
  the release that carries them.
