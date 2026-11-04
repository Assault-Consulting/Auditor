// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The records list — C-11. `/records` has paged and filtered since C-01;
 * nothing client-side ever called it for more than one record until now.
 * Filter chips (C-09b) narrow this list; C-10 virtualises it. Neither
 * could have meant anything until it existed.
 */

import { recordCard, type RecordCard } from "./record";
import type { RecordPage } from "./generated/types";

/** One page, resolved for display. */
export interface RecordsPage {
  rows: RecordCard[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  /**
   * With a text filter: records that passed every other filter but have an
   * encrypted body, so their detail could not be searched (C-09d). Null
   * without a text filter. Non-zero means "no match" is not the whole answer.
   */
  unsearched: number | null;
}

/** The sentence a list owes its reader when some bodies could not be searched. */
export function unsearchedLine(page: RecordsPage): string | null {
  const n = page.unsearched;
  if (n === null || n === 0) return null;
  return n === 1
    ? "1 record matching the other filters has an encrypted body and was not searched for this text."
    : `${n} records matching the other filters have encrypted bodies and were not searched for this text.`;
}

export function recordsPage(page: RecordPage): RecordsPage {
  return {
    rows: page.records.map(recordCard),
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    hasMore: page.has_more,
    unsearched: page.unsearched ?? null,
  };
}

/**
 * The offset for the next page, or null when there is none.
 *
 * Deliberately not `current.offset + current.limit`. The endpoint's own
 * description of `offset` is a **seq threshold** — "records with
 * `seq >= offset`" — not a row count, and seq is not guaranteed
 * contiguous: a segment boundary, a filter, or a gap in the chain itself
 * can all make `offset + limit` land past records this page never
 * returned, or short of ones it did. The only threshold guaranteed to
 * start exactly where this page left off is one past the last row it
 * actually carried.
 */
export function nextOffset(page: RecordsPage): number | null {
  if (!page.hasMore) return null;
  const last = page.rows.at(-1);
  return last === undefined ? null : last.seq + 1;
}
