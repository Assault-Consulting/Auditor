// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The raw view of one record — C-06d, F7's last line.
 *
 * Every name and every boundary drawn here is the package's: the bytes are
 * `record_bytes_at`, the fixed header's fields are `HEADER_FIELDS`, the TLVs
 * are the package's spans (`docs/API.md`, `/record/{seq}/bytes`). This module
 * only lays them out sixteen to a row. It never reads a byte for its value,
 * never works out where anything starts, and a byte no span covers is shown
 * unnamed rather than guessed at (L1, ADR-0001).
 */

import type { RecordBytesView } from "./generated/types";

/** Which part of the record a span names. */
export type Zone = "field" | "header-tlv" | "body-tlv";

/** One named stretch of bytes, from the record's first byte. */
export interface Segment {
  id: number;
  zone: Zone;
  label: string;
  start: number;
  /** One past the last byte. */
  end: number;
}

/** One byte on screen: two hex digits and the segment that names it, if any. */
export interface Cell {
  at: number;
  hex: string;
  segment: number | null;
  /** The first byte of its segment, so adjacent fields read as two. */
  opens: boolean;
  inBody: boolean;
}

export interface HexRow {
  /** From the record's first byte. */
  at: number;
  cells: Cell[];
}

export interface HexView {
  rows: HexRow[];
  segments: Segment[];
  /** Where the record sits in the file, and how long its header is. */
  fileOffset: number;
  headerLen: number;
  /** Sentences the view must carry, in order. Empty when there is nothing to qualify. */
  notes: string[];
}

export const BYTES_PER_ROW = 16;

/** The package gives a TLV's type as a number and no name for it; it is shown as given. */
export function tlvLabel(type: number): string {
  return `TLV ${type} (0x${type.toString(16).padStart(4, "0")})`;
}

function pairs(hex: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(hex.slice(i, i + 2));
  return out;
}

/**
 * The view, built from the sidecar's answer alone.
 *
 * Where spans overlap — they should not, and nothing here checks that they
 * do not — the first one listed names the byte: the fixed header's fields,
 * then the header's TLVs, then the body's.
 */
export function hexView(v: RecordBytesView): HexView {
  const header = pairs(v.header_hex);
  const body = pairs(v.body_hex);
  const headerLen = header.length;
  const bytes = [...header, ...body];

  const segments: Segment[] = [];
  for (const f of v.header_fields ?? []) {
    segments.push({
      id: segments.length,
      zone: "field",
      label: f.name,
      start: f.offset,
      end: f.offset + f.length,
    });
  }
  for (const t of v.header_tlvs ?? []) {
    segments.push({
      id: segments.length,
      zone: "header-tlv",
      label: tlvLabel(t.type),
      start: t.value_offset,
      end: t.value_offset + t.length,
    });
  }
  for (const t of v.body_tlvs ?? []) {
    segments.push({
      id: segments.length,
      zone: "body-tlv",
      label: tlvLabel(t.type),
      start: t.value_offset,
      end: t.value_offset + t.length,
    });
  }

  const owner: (number | null)[] = bytes.map(() => null);
  for (const s of segments) {
    for (let i = Math.max(0, s.start); i < Math.min(s.end, bytes.length); i++) {
      if (owner[i] === null) owner[i] = s.id;
    }
  }

  const rows: HexRow[] = [];
  for (let at = 0; at < bytes.length; at += BYTES_PER_ROW) {
    rows.push({
      at,
      cells: bytes.slice(at, at + BYTES_PER_ROW).map((hex, k) => ({
        at: at + k,
        hex,
        segment: owner[at + k] ?? null,
        opens: (owner[at + k] ?? null) !== null && owner[at + k] !== (owner[at + k - 1] ?? null),
        inBody: at + k >= headerLen,
      })),
    });
  }

  const notes: string[] = [];
  if (v.header_fields === null) {
    notes.push(
      "The package does not interpret this header, so no field is named: the bytes are shown as the file holds them.",
    );
  }
  if (v.body_len > 0 && v.body_tlvs === null) {
    notes.push(
      "The package gives no TLV layout for this body; its bytes are shown as stored, unnamed.",
    );
  }
  if (v.body_shown < v.body_len) {
    notes.push(
      `The first ${v.body_shown} of the body's ${v.body_len} bytes are shown; the rest are in the file, not drawn here.`,
    );
  }
  if (segments.length > 0) {
    notes.push("A byte no span covers is shown unnamed: the package names TLV values, not the bytes that introduce them.");
  }

  return { rows, segments, fileOffset: v.offset, headerLen, notes };
}

/** An offset as the view prints it: four hex digits, wider when it must be. */
export function offsetLabel(at: number): string {
  return at.toString(16).padStart(4, "0");
}
