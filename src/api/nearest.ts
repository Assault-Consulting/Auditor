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

import { t, tn } from "../i18n";
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
  if (s < 60) return t("record.span.s", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("record.span.min", { m, s: s % 60 });
  const h = Math.floor(m / 60);
  if (h < 48) return t("record.span.h", { h, m: m % 60 });
  return t("record.span.d", { d: Math.floor(h / 24), h: h % 24 });
}

export function nearestLine(n: NearestRecord, askedIso: string): NearestLine {
  const clock = t("nearest.clock", {
    trust: n.time_trust.name ?? t("nearest.value", { value: n.time_trust.value }),
  });
  // Below one second the distance is reported as exact: the instant was
  // typed to the minute or second, and "0 s before" would read as a
  // measurement this lookup did not make.
  const where =
    Math.abs(n.delta_ns) < 1e9
      ? t("nearest.exact", { asked: askedIso, clock })
      : t(n.delta_ns < 0 ? "nearest.before" : "nearest.after", { span: spanText(n.delta_ns), asked: askedIso, clock });

  const cautions: string[] = [];
  if (!n.wall_follows_seq) {
    cautions.push(
      t("nearest.not_ordered"),
    );
  }
  if (n.boot_clock_stepped) {
    cautions.push(t("nearest.stepped"));
  }
  if (n.equally_near > 0) {
    cautions.push(
      tn("nearest.equal", n.equally_near),
    );
  }

  return { seq: n.seq, text: t("nearest.line", { seq: n.seq, where }), cautions };
}
