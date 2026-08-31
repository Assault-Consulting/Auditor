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
}

export function recordsPage(page: RecordPage): RecordsPage {
  return {
    rows: page.records.map(recordCard),
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    hasMore: page.has_more,
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
