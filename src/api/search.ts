// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * F10 — search and jumps, the slice buildable without a records list.
 *
 * F10 specifies "one bar, four behaviours" (free text over `detail`, filter
 * chips, time jump, seq jump) plus three quick buttons (next warning, first
 * record, anchor). This module is deliberately not all of it:
 *
 * - Free text is `FUNCTIONALITY.md` §22's own open question ("is free-text
 *   search over `detail` MVP or fast-follow?") — undecided, and there is no
 *   `detail` field on a record to search yet regardless (that is C-06d's
 *   decoded-body territory). Building it would answer a product question
 *   this module has no authority to answer.
 * - Filter chips (`kind:`, `type:`, `span:`, `boot:`, `tier:`, date range)
 *   narrow *which records a list shows* — and this application has no
 *   records-list view to narrow. `/records` supports it server-side since
 *   C-01; nothing client-side renders more than one record at a time yet.
 *   Tracked in `DEVELOPMENT-PLAN.md` as a real gap, not silently deferred.
 * - Time jump needs the nearest record to a wall-clock instant, which
 *   `/records` cannot answer today — offset is by seq, not by time.
 * - The **anchor** quick button needs a record's own hash to know which
 *   record the configured anchor's head names, which does not exist on
 *   this side of the seam yet (U10, C-06c).
 *
 * What is left — seq jump and two of the three quick buttons — needs
 * nothing this application does not already have.
 */

import type { AdvisoryItemModel } from "./generated/types";

/** What the bar was asked to do, once parsed. */
export type SearchOutcome =
  | { kind: "seq"; seq: number }
  | { kind: "unsupported"; raw: string };

const SEQ_SYNTAX = /^#(\d+)$/;

/**
 * Parse the bar's input against F10's own syntax.
 *
 * `null` for blank input — there is nothing to search for, not a failed
 * search. Anything that is not exactly `#<digits>` is reported as
 * `unsupported` rather than silently ignored or guessed at: a filter chip
 * or a time jump typed into this bar today would otherwise look accepted
 * and then do nothing, which is worse than saying plainly that this slice
 * does not read it yet.
 */
export function parseSearch(raw: string): SearchOutcome | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const match = SEQ_SYNTAX.exec(trimmed);
  if (match) return { kind: "seq", seq: Number(match[1]) };
  return { kind: "unsupported", raw: trimmed };
}

/**
 * The next advisory item's `seq`, strictly after `afterSeq` — or the
 * first one, if there is no later item or nothing is currently selected.
 *
 * Wraps rather than dead-ending at the last warning: a button that stops
 * responding once a reader has clicked past the final item would look
 * broken rather than finished. Items with no `at_seq` are not jump
 * targets and are skipped, the same reason a diagnosis with no location
 * renders no "at record" line.
 */
export function nextWarning(items: AdvisoryItemModel[], afterSeq: number | null): number | null {
  const seqs = items
    .map((item) => item.at_seq)
    .filter((seq): seq is number => seq !== null)
    .sort((a, b) => a - b);
  if (seqs.length === 0) return null;
  if (afterSeq === null) return seqs[0]!;
  return seqs.find((seq) => seq > afterSeq) ?? seqs[0]!;
}
