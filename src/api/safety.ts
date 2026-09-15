// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * F8 — the SAFETY list, grouped by kind, with detail text and its
 * recurrence count.
 *
 * F8 asks for records "sorted by seq, grouped by kind_name, with detail
 * text and a recurrence count for identical details," plus the r2
 * oversight loop: acknowledged/unacknowledged state for
 * `INCIDENT_CANDIDATE` records, an `OVERSIGHT_ACK`'s operator and
 * deadline, and `KEY_SHRED` resolution.
 *
 * `detail` and its recurrence count are on now (U12, released 0.11.0;
 * C-07b) — carried straight through by `recordCard`, nothing recomputed
 * here. Still not here: which ack acknowledged a candidate, and that
 * ack's own operator or deadline — `acknowledged` on each `RecordCard`
 * is membership only (C-07c, partial; `record.ts`'s own docstring has
 * the full account).
 *
 * What grouping itself needs — kind, already resolved per record — was
 * always free; this module's own job is the grouping, not decoding.
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
