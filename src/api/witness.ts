// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The local witness log, as the screen says it — E-05, F14, ADR-0003.
 *
 * The log is Auditor's own record of the checks it ran. Every sentence here
 * says what it shows and, in the same breath, what it does not: the claim
 * and its residual are one statement (`docs/PRACTICES.md` §4.4).
 */

import { t, tn } from "../i18n";
import type { WitnessCheckView, WitnessEntryView, WitnessMark } from "./generated/types";

/** What the log does and does not show. Always on screen beside it. */
export const witnessLimits = (): string => t("witness.limits");

export interface Line {
  text: string;
  /** Said with the ochre rule: the log did not take this check, or does not link. */
  failed: boolean;
}

/** One sentence under a check, about where it went in the log. */
export function witnessLine(mark: WitnessMark | null | undefined): Line | null {
  if (mark === null || mark === undefined) return null;
  if (mark.error !== null) {
    return { text: t("witness.not_written", { error: mark.error }), failed: true };
  }
  return { text: t("witness.written", { n: mark.n }), failed: false };
}

/** The panel's first line: does the log link, from its first entry? */
export function witnessStatus(v: WitnessCheckView): Line {
  if (v.broken_at !== null) {
    const before =
      v.entries === 1
        ? t("witness.before.one")
        : v.entries > 1
          ? t("witness.before.many", { n: v.entries })
          : t("witness.before.none");
    return {
      text: t("witness.broken", { line: v.broken_at, reason: v.reason ?? "", before }),
      failed: true,
    };
  }
  if (v.entries === 0) return { text: t("witness.empty"), failed: false };
  return {
    text: tn("witness.links", v.entries),
    failed: false,
  };
}

export interface WitnessRow {
  n: number;
  /** This machine's clock, ISO, UTC. A claim, and labelled one. */
  when: string;
  file: string;
  head: string;
  against: string;
}

function iso(ns: number | null | undefined): string {
  if (ns === null || ns === undefined) return "—";
  return new Date(Math.floor(ns / 1e6)).toISOString().replace(".000Z", "Z");
}

function short(hex: string | null | undefined): string {
  return typeof hex === "string" && hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : (hex ?? "—");
}

/** The last entries, newest first, in the words the table uses. */
export function witnessRows(tail: WitnessEntryView[]): WitnessRow[] {
  return [...tail].reverse().map((e) => {
    const name = e.subject?.["name"];
    let against = t("witness.against.none");
    if (e.anchor !== null && e.anchor !== undefined) {
      const kind = e.anchor["source_kind"];
      const done =
        e.complete_to_anchor === true
          ? t("witness.against.complete")
          : e.complete_to_anchor === false
            ? t("witness.against.not_complete")
            : t("witness.against.not_checked");
      against = t("witness.against", { kind: typeof kind === "string" ? kind : t("witness.against.anchor"), done });
    } else if (e.profile !== null && e.profile !== undefined && e.profile !== "none") {
      against = t("witness.against.no_answer", { profile: e.profile });
    }
    return {
      n: e.n,
      when: iso(e.checked_at_wall_ns),
      file: typeof name === "string" ? name : "—",
      head: short(e.head),
      against,
    };
  });
}
