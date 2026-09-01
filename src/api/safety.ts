// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * F8 — the SAFETY list, the slice buildable without a decoded body.
 *
 * F8 asks for records "sorted by seq, grouped by kind_name, with detail
 * text and a recurrence count for identical details," plus the r2
 * oversight loop: acknowledged/unacknowledged state for
 * `INCIDENT_CANDIDATE` records, an `OVERSIGHT_ACK`'s operator and
 * deadline, and `KEY_SHRED` resolution. None of the second half is here:
 *
 * - `detail` text (and the recurrence count it would enable) needs
 *   `EVT_DETAIL` — a body TLV value — decoded, and nothing on this side
 *   of the seam decodes TLV values yet. Tracked as U12.
 * - Acknowledged/unacknowledged needs `EVT_REF_SEQ` / `EVT_REF_HASH`
 *   decoded from an ack's body, *and* a candidate's own hash to bind the
 *   reference correctly rather than match on seq alone — matching on
 *   seq alone could call a candidate acknowledged when the ack actually
 *   named a different one, which is worse than not resolving it at all.
 *   The hash half is U10; the resolution itself is U13.
 *
 * What is left — grouping and counting what a record already resolves,
 * its kind — needs nothing this application does not already have.
 */

import { recordCard, type RecordCard, type KindLabel } from "./record";
import type { RecordView } from "./generated/types";

/** One kind's SAFETY records, in seq order. */
export interface SafetyGroup {
  /** The same three states record.ts already keeps apart: named when
   *  this build recognises the kind, raw when it does not, absent when
   *  the record carries none at all. */
  kindLabel: KindLabel;
  records: RecordCard[];
}

/** A stable key for one kind — for a list key, or to compare two labels. */
export function safetyGroupKey(label: KindLabel): string {
  if (!label.has) return "none";
  if (label.named) return `named:${label.name}`;
  return `raw:${label.raw}`;
}

/**
 * Group SAFETY records by kind, each group in seq order, groups
 * ordered by their earliest member — sorting the flat list once and
 * inserting groups on first sight both derive from and preserve that.
 */
export function safetyGroups(views: RecordView[]): SafetyGroup[] {
  const cards = views.map(recordCard).sort((a, b) => a.seq - b.seq);
  const groups = new Map<string, SafetyGroup>();
  for (const card of cards) {
    const key = safetyGroupKey(card.kindLabel);
    let group = groups.get(key);
    if (group === undefined) {
      group = { kindLabel: card.kindLabel, records: [] };
      groups.set(key, group);
    }
    group.records.push(card);
  }
  return [...groups.values()];
}
