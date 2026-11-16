// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The local witness log, as the screen says it — E-05, F14, ADR-0003.
 *
 * The log is Auditor's own record of the checks it ran. Every sentence here
 * says what it shows and, in the same breath, what it does not: the claim
 * and its residual are one statement (`docs/PRACTICES.md` §4.4).
 */

import type { WitnessCheckView, WitnessEntryView, WitnessMark } from "./generated/types";

/** What the log does and does not show. Always on screen beside it. */
export const WITNESS_LIMITS =
  "The witness log shows that this desk saw this head at this point in its own sequence, " +
  "and makes a later change to an entry visible. It shows nothing about the world: its " +
  "clock is this machine's, a log cut at its end still links, and whoever controls this " +
  "machine can write a new one. Note its head somewhere else to make a cut visible.";

export interface Line {
  text: string;
  /** Said with the ochre rule: the log did not take this check, or does not link. */
  failed: boolean;
}

/** One sentence under a check, about where it went in the log. */
export function witnessLine(mark: WitnessMark | null | undefined): Line | null {
  if (mark === null || mark === undefined) return null;
  if (mark.error !== null) {
    return { text: `Not written to the witness log: ${mark.error}`, failed: true };
  }
  return { text: `Written to this desk's witness log as entry ${mark.n}.`, failed: false };
}

/** The panel's first line: does the log link, from its first entry? */
export function witnessStatus(v: WitnessCheckView): Line {
  if (v.broken_at !== null) {
    const before =
      v.entries === 1 ? "The first entry links" : v.entries > 1 ? `The first ${v.entries} entries link` : "No entry links";
    return {
      text: `The witness log does not link at line ${v.broken_at}: ${v.reason}. ${before}; nothing is added to it until it does.`,
      failed: true,
    };
  }
  if (v.entries === 0) return { text: "The witness log has no entries yet.", failed: false };
  return {
    text: `${v.entries} ${v.entries === 1 ? "entry links" : "entries link"}, each to the one before it.`,
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
    let against = "no anchor";
    if (e.anchor !== null && e.anchor !== undefined) {
      const kind = e.anchor["source_kind"];
      const done =
        e.complete_to_anchor === true ? "complete" : e.complete_to_anchor === false ? "not complete" : "not checked";
      against = `${typeof kind === "string" ? kind : "anchor"} — ${done}`;
    } else if (e.profile !== null && e.profile !== undefined && e.profile !== "none") {
      against = `${e.profile} — no source answered`;
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
