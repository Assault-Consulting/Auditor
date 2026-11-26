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

import { fixedNote } from "./fixed";
import { t, tn } from "../i18n";
import { ownEntry } from "./own";
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

/**
 * Wording per code.
 *
 * Not a closed set, and that is deliberate. FUNCTIONALITY.md §9 lists nine
 * codes; the installed package also emits `span_unclosed` and
 * `span_unopened`, which the specification does not mention — checked
 * against 0.9.0 rather than taken from the document. A lane built on the
 * document's list would have rendered those two as blank rows.
 */
/**
 * Each advisory code this build has words for, and its weight. The title
 * and note are the catalogs' (`advisory.<code>.title`, `advisory.<code>.note`).
 */
const WORDING: Record<string, "notable" | "ordinary"> = {
  mono_regression_in_boot: "ordinary",
  wall_regression_in_boot: "ordinary",
  mid_boot_time_trust_change: "ordinary",
  anchor_never_written: "ordinary",
  span_unclosed: "ordinary",
  span_unopened: "ordinary",
  reference_unresolved: "ordinary",
  reference_hash_mismatch: "notable",
  ack_target_not_a_candidate: "ordinary",
  shred_target_unresolved: "ordinary",
  shred_target_key_mismatch: "notable",
  tool_target_not_a_call: "ordinary",
  continuation_malformed: "ordinary",
  continuation_predecessor_mismatch: "notable",
  continuation_index_not_increasing: "ordinary",
  continuation_index_gap: "ordinary",
  continuation_prior_root_mismatch: "notable",
  boot_ended_without_close: "ordinary",
  reports_refused: "ordinary",
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
    const known = ownEntry(WORDING, code);
    return {
      code,
      title: known !== undefined ? t(`advisory.${code}.title`) : code,
      note: known !== undefined ? t(`advisory.${code}.note`) : t("advisory.unknown.note"),
      count: items.length,
      items,
      unrecognised: known === undefined,
      weight: known ?? "ordinary",
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
    return t("advisory.line.none", { note: fixedNote(advisory.note_id, advisory.note) ?? "" });
  }
  // The note is the package's fixed sentence, shown by name (R19).
  return tn("advisory.line.some", advisory.count, { note: fixedNote(advisory.note_id, advisory.note) ?? "" });
}

/** Every code this build has wording for. Exported for the tests. */
export const KNOWN_CODES: readonly string[] = Object.keys(WORDING);
