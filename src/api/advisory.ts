// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The advisory lane: things worth a human's attention that change no verdict.
 *
 * L5 is the whole constraint. An advisory item never changes the verdict
 * badge, never changes a report's pass line, never changes an exit code. The
 * API already keeps them in their own key and ships the sentence "advisory
 * items do not affect the verdict" inside the payload rather than leaving it
 * to a UI. This module has to keep them apart in the last place it can still
 * go wrong — the wording, and the ordering.
 *
 * The temptation here runs the opposite way to everywhere else in this
 * application. Elsewhere the risk is overclaiming; here it is **making a
 * quiet thing loud**. A lane that shouts is a lane whose items get read as
 * findings, and then L5 is broken by presentation while the data stayed
 * correct.
 *
 * Codes are grouped, not listed flat: five occurrences of one condition is
 * one thing to look at, and a flat list of five makes it look like five.
 */

import type { AdvisoryItemModel, AdvisoryModel } from "./generated/types";

export interface AdvisoryGroup {
  code: string;
  /** A sentence for the code, or the code itself when this build knows none. */
  title: string;
  /** What the condition means, without saying what caused it. */
  note: string;
  count: number;
  items: AdvisoryItemModel[];
  /** True when this build has no wording for the code. */
  unrecognised: boolean;
  /**
   * Relative weight *within the lane*, never against a verdict.
   *
   * §9 asks for one distinction only: `reference_hash_mismatch` reads
   * stronger than `reference_unresolved`, because the package separates them
   * for exactly that reason — an unresolved reference may simply point
   * outside the file you happen to hold, while a mismatched hash is about
   * two things that should agree and do not.
   */
  weight: "notable" | "ordinary";
}

interface Wording {
  title: string;
  note: string;
  weight?: "notable";
}

/**
 * Wording per code.
 *
 * Not a closed set, and that is deliberate. FUNCTIONALITY.md §9 lists nine
 * codes; the installed package also emits `span_unclosed` and
 * `span_unopened`, which the specification does not mention — checked
 * against 0.9.0 rather than taken from the document. A lane built on the
 * document's list would have rendered those two as blank rows.
 */
const WORDING: Record<string, Wording> = {
  // Header-only conditions.
  mono_regression_in_boot: {
    title: "The monotonic clock moved backwards within a boot",
    note: "Monotonic time is not supposed to go back inside one boot. Worth knowing before reading any duration from this stretch.",
  },
  wall_regression_in_boot: {
    title: "The wall clock moved backwards within a boot",
    note: "A correction, a manual change and a synchronisation step all look like this. Chain order is unaffected — it was never based on the wall clock.",
  },
  mid_boot_time_trust_change: {
    title: "The clock's trust level changed mid-boot",
    note: "Records before and after the change carry different qualifications on their wall-clock times, so a single sentence about this boot's timing would not be true of all of it.",
  },
  anchor_never_written: {
    title: "No anchor record was ever written",
    note: "Nothing in this chain records a head having been anchored. Question two can still be answered from an anchor kept outside the file.",
  },
  // Span conditions the package emits and §9 does not list.
  span_unclosed: {
    title: "A span was opened and never closed",
    note: "First-class evidence rather than a fault: a span left open is what an interrupted operation looks like, and the record of it is intact.",
  },
  span_unopened: {
    title: "A span was closed without an opening record",
    note: "The opening record is not in this file. An earlier segment of the same chain is the usual explanation.",
  },
  // Referential conditions, r2 oversight semantics.
  reference_unresolved: {
    title: "A record points at a record that is not here",
    note: "The target may be in another segment of the same chain. Unresolved is not the same as missing.",
  },
  reference_hash_mismatch: {
    title: "A reference names a record whose hash does not match",
    note: "Two things that should agree do not: the reference carries a hash, and the record it names hashes to something else.",
    weight: "notable",
  },
  ack_target_not_a_candidate: {
    title: "An acknowledgement points at something that is not an incident candidate",
    note: "The oversight loop expects an acknowledgement to name a candidate. This one names a different kind of record.",
  },
  shred_target_unresolved: {
    title: "A key-shred record names a record that is not here",
    note: "The target may be in another segment. The shred itself is recorded either way.",
  },
  shred_target_key_mismatch: {
    title: "A key-shred record names a record encrypted under a different key",
    note: "The shred claims a key that the named record does not use.",
    weight: "notable",
  },
  // r3: a tool result must bind to its call. Emitted since 0.12; this build
  // had no words for it until 0.13 was read against the list in full.
  tool_target_not_a_call: {
    title: "A tool result or loop guard names a record that is not a tool call",
    note: "The reference resolves, and its hash matches, but the record it names is of another kind than the result or guard expects.",
  },
  // Segment continuation, inference profile r6 (palimpsests 0.13). The two
  // mismatches are notable for the reason reference_hash_mismatch is: each
  // is two things that should agree and do not — a declared predecessor
  // against the record's own prev_hash, a declared root against the root
  // recomputed from the records themselves.
  continuation_malformed: {
    title: "A segment continuation record is missing a declared field",
    note: "A SEGMENT_CONTINUATION should carry four declarations at fixed widths. This one does not, so nothing it declares is shown.",
  },
  continuation_predecessor_mismatch: {
    title: "A continuation declares a predecessor its own header does not name",
    note: "The declared previous head and the record's own prev_hash should be the same value. They are not.",
    weight: "notable",
  },
  continuation_index_not_increasing: {
    title: "Segment indices do not increase",
    note: "Each continuation declares its segment's place in the chain; a later one declares the same place or an earlier one.",
  },
  continuation_index_gap: {
    title: "Segment indices skip a number",
    note: "With the whole chain present from its beginning, consecutive continuations should declare consecutive segment numbers. These do not.",
  },
  continuation_prior_root_mismatch: {
    title: "A continuation declares a root the records before it do not produce",
    note: "The reader recomputed the root of every record before the continuation, and it differs from the root the writer declared at the cut.",
    weight: "notable",
  },
};

/**
 * Group the items by code, notable weights first.
 *
 * Within a weight, order is by descending count and then by code, so the
 * lane is stable between runs — a list that reshuffles on every check is one
 * nobody can compare against last week's.
 */
export function advisoryGroups(advisory: AdvisoryModel): AdvisoryGroup[] {
  const byCode = new Map<string, AdvisoryItemModel[]>();
  for (const item of advisory.items) {
    const existing = byCode.get(item.code);
    if (existing === undefined) byCode.set(item.code, [item]);
    else existing.push(item);
  }

  const groups: AdvisoryGroup[] = [...byCode.entries()].map(([code, items]) => {
    const known = WORDING[code];
    return {
      code,
      title: known?.title ?? code,
      note:
        known?.note ??
        "This build has no description for this advisory code. The items below are the package's own.",
      count: items.length,
      items,
      unrecognised: known === undefined,
      weight: known?.weight ?? "ordinary",
    };
  });

  return groups.sort((a, b) => {
    if (a.weight !== b.weight) return a.weight === "notable" ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.code.localeCompare(b.code);
  });
}

/**
 * The lane's one line.
 *
 * Carries the payload's own note rather than a sentence of ours, because the
 * API put it there precisely so a UI could not soften or drop it.
 */
export function advisoryLine(advisory: AdvisoryModel): string {
  if (advisory.count === 0) {
    // Said plainly rather than by hiding the lane. "No advisory items" is
    // information; an absent section is ambiguous between that and a lane
    // nobody implemented.
    return `No advisory items — ${advisory.note}.`;
  }
  const n = advisory.count;
  return `${n} advisory ${n === 1 ? "item" : "items"} — ${advisory.note}.`;
}

/** Every code this build has wording for. Exported for the tests. */
export const KNOWN_CODES: readonly string[] = Object.keys(WORDING);
