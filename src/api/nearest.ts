// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * What a time jump found, in words that cannot be read as more than it is
 * (C-09c).
 *
 * The answer to "what happened at 22:41" is a statement about the
 * writer's clock: the record whose clock reading is nearest. So the line
 * always names that clock, and every qualifier the sidecar sent becomes a
 * caution a reader sees beside it — not a footnote, and never dropped when
 * it is inconvenient.
 */

import type { NearestRecord } from "./generated/types";

export interface NearestLine {
  seq: number;
  /** One sentence: which record, and how far from the instant asked. */
  text: string;
  /** Every qualifier that applies, in the order worth reading. */
  cautions: string[];
}

function spanText(ns: number): string {
  const s = Math.round(Math.abs(ns) / 1e9);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function nearestLine(n: NearestRecord, askedIso: string): NearestLine {
  const clock = `the writer's clock (${n.time_trust.name ?? `value ${n.time_trust.value}`})`;
  // Below one second the distance is reported as exact: the instant was
  // typed to the minute or second, and "0 s before" would read as a
  // measurement this lookup did not make.
  const where =
    Math.abs(n.delta_ns) < 1e9
      ? `at the instant asked, ${askedIso}, by ${clock}`
      : `${spanText(n.delta_ns)} ${n.delta_ns < 0 ? "before" : "after"} ${askedIso}, by ${clock}`;

  const cautions: string[] = [];
  if (!n.wall_follows_seq) {
    cautions.push(
      "In this file the writer's clock does not follow the chain's order, so nearest by the clock is not a position in the history.",
    );
  }
  if (n.boot_clock_stepped) {
    cautions.push("The writer's clock stepped during this record's boot.");
  }
  if (n.equally_near > 0) {
    cautions.push(
      `${n.equally_near} other ${n.equally_near === 1 ? "record is" : "records are"} equally near; the earliest in the chain is shown.`,
    );
  }

  return { seq: n.seq, text: `Nearest record #${n.seq} reads ${where}.`, cautions };
}
