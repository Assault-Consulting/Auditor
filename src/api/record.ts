// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * One record, read rather than judged — the first slice of F9's inspector.
 *
 * Deliberately not all of F7. The spec asks for the record's own hash, a
 * clickable link to its predecessor's, and a raw hex view with field
 * highlighting from the package's field map (U4). `RecordView` now carries
 * `prev_hash` and `index` (C-06b), but not the record's own hash — nothing
 * downstream of the reader's decode step keeps the header bytes computing
 * it needs, which is why that field is a Track-U item (U10) rather than a
 * seam addition. Until it lands, `prevHash` below is shown as a fact with
 * nothing to compare it against: this slice renders it, but the clickable
 * jump and the equality check both wait for C-06c. Rendering a hex view
 * against fields the sidecar does not return would be inventing them on
 * this side of the seam, which is exactly what ADR-0001 rules out.
 */

import type { NamedValue, RecordView } from "./generated/types";

/**
 * Whether this build has a name for the record's type.
 *
 * Not a boolean alongside the raw number, because a screen has to say the
 * same thing whichever way this comes out: an unnamed type is not an error
 * in the file, it is a gap in the verifier reading it (F7's own words:
 * "chain-checked, not interpretable by this verifier version").
 */
export type TypeLabel = { named: true; name: string } | { named: false };

function typeLabelOf(view: RecordView): TypeLabel {
  return view.type_name === null ? { named: false } : { named: true, name: view.type_name };
}

/**
 * Whether this record carries a kind, and whether this build can name it.
 *
 * Three states, not two, because `kind === null` and `kind_name === null`
 * mean different things a reader needs told apart. GENESIS, BOOT and ANCHOR
 * carry no kind at all — `kind` itself is null, by design, not a gap. A kind
 * number present with no name is the actual gap: a value this build has
 * never seen. Collapsing the two would make an ordinary GENESIS record read
 * as something the verifier failed to understand.
 */
export type KindLabel =
  | { has: false }
  | { has: true; named: true; name: string }
  | { has: true; named: false; raw: number };

function kindLabelOf(view: RecordView): KindLabel {
  if (view.kind === null) return { has: false };
  if (view.kind_name === null) return { has: true, named: false, raw: view.kind };
  return { has: true, named: true, name: view.kind_name };
}

/**
 * What the body is, in the four states `RecordView` can actually support.
 *
 * `cleartext` lists which TLV types are present, never their content —
 * decoding the values themselves is the hex-view half of C-06 this slice
 * does not build. `opaque` is `key_id`'s doing: a body is opaque because it
 * is encrypted, never because this reader declined to look at it (L4 — the
 * shell never guesses at what it cannot see).
 */
export type BodyState =
  | { state: "none" }
  | { state: "opaque" }
  | { state: "cleartext"; tlvTypes: number[] }
  | { state: "undecoded" };

function bodyStateOf(view: RecordView): BodyState {
  if (view.body_len === 0) return { state: "none" };
  if (view.key_id !== null) return { state: "opaque" };
  if (view.body_tlv_types !== null) return { state: "cleartext", tlvTypes: view.body_tlv_types };
  return { state: "undecoded" };
}

/** A wall-clock nanosecond field, rendered as an ISO instant. */
function isoOf(ns: number): string {
  return new Date(ns / 1_000_000).toISOString();
}

/** The envelope, resolved into what a card actually prints. */
export interface RecordCard {
  seq: number;
  /** Position within this file. See `RecordView.index`'s own docstring. */
  index: number;
  recordType: number;
  typeLabel: TypeLabel;
  kindLabel: KindLabel;
  bootId: string;
  spanId: string | null;
  parentSpanId: string | null;
  /**
   * The record's OWN CLAIM about its predecessor's hash, or null for a
   * record declaring it has none (GENESIS). Unverified: nothing here
   * confirms it matches the predecessor's actual hash, because this view
   * has no field for that yet (U10 → C-06c). Displayed as a fact, not as
   * a link, until it does.
   */
  prevHash: string | null;
  assuranceTier: NamedValue;
  timeTrust: NamedValue;
  wallClockIso: string;
  monotonicNs: number;
  body: BodyState;
  /**
   * F7's own sentence for an unnamed type, or null for an ordinary record.
   * Set once here rather than re-derived per render, and carried verbatim —
   * the same discipline `browse.ts` keeps for §F7's other fixed wordings.
   */
  note: string | null;
}

const UNRECOGNISED_NOTE = "chain-checked, not interpretable by this verifier version";

export function recordCard(view: RecordView): RecordCard {
  return {
    seq: view.seq,
    index: view.index,
    recordType: view.record_type,
    typeLabel: typeLabelOf(view),
    kindLabel: kindLabelOf(view),
    bootId: view.boot_id,
    spanId: view.span_id,
    parentSpanId: view.parent_span_id,
    prevHash: view.prev_hash,
    assuranceTier: view.assurance_tier,
    timeTrust: view.time_trust,
    wallClockIso: isoOf(view.wall_clock_ns),
    monotonicNs: view.monotonic_ns,
    body: bodyStateOf(view),
    note: view.type_name === null ? UNRECOGNISED_NOTE : null,
  };
}
