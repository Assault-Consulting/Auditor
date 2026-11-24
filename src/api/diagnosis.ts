// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * A failure described, and where to look next.
 *
 * The package already says what the evidence is consistent with, in its own
 * carefully hedged words — "the evidence is consistent with a writer
 * interrupted mid-write". That sentence is carried verbatim and this module
 * does not paraphrase it, compete with it, or improve on it.
 *
 * What it adds is the part the verifier cannot know: **which investigation
 * to open**. That is a shell concern — it depends on how the deployment is
 * run, where the anchors live, who writes the log — and it is the whole
 * value of §8's claim that the truncated/replaced split is the most useful
 * distinction in the product. A crash between writing and anchoring looks
 * nothing like a replacement, and only the pattern tells an operator which
 * of the two they are looking at.
 *
 * Nothing here says what happened. Every line says what to check.
 */

import { t } from "../i18n";
import type { DiagnosisModel } from "./generated/types";
import { ownEntry } from "./own";

export interface DiagnosisCard {
  pattern: string;
  /** A short name for the shape of the failure, not a verdict about it. */
  title: string;
  /** Where an operator should look, in the order worth looking. */
  whereToLook: string[];
  /** Record this is anchored at, when the pattern has a location. */
  atSeq: number | null;
  /** What the verifier expected to find there. */
  expected: string | null;
  /**
   * For record_violation: the violation's code (U24, palimpsests 0.14) —
   * the machine field, shown as it came; `expected` carries the reason.
   */
  code: string | null;
  /** The verifier's own sentence, carried verbatim. */
  narrative: string;
  /** True when this build has no guidance for the pattern. */
  unrecognised: boolean;
}

/**
 * Per-pattern guidance.
 *
 * Written as questions and places, never as conclusions. "Check whether the
 * writer was restarted" is help; "the writer crashed" is a claim this
 * application has no standing to make.
 */
/**
 * How many places to look each pattern's guidance names; the sentences are
 * the catalogs' (`diagnosis.<pattern>.title`, `diagnosis.<pattern>.look.<n>`).
 */
const GUIDANCE: Record<string, number> = {
  truncated_tail: 3,
  prefix_absent: 2,
  seq_gap: 2,
  chain_break: 2,
  record_violation: 2,
  unanchored_tail: 2,
  not_a_container: 2,
  empty_container: 2,
  declared_continuation: 4,
  continuation_contradicts_manifest: 3,
  replaced_or_rolled_back: 3,
};

/**
 * The card for a diagnosis, or `null` when there was none.
 *
 * An unrecognised pattern is not an error. The package may add one before
 * this build learns about it, and the honest response is to show the
 * verifier's own sentence and say plainly that there is no guidance here —
 * rather than omit the failure, or invent advice for a shape nobody has
 * described yet.
 */
function looks(pattern: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => t(`diagnosis.${pattern}.look.${i + 1}`));
}

export function diagnosisCard(diagnosis: DiagnosisModel | null): DiagnosisCard | null {
  if (diagnosis === null) return null;

  // Own keys only: an open vocabulary can name a pattern that collides
  // with an inherited property ("constructor"), which is not guidance.
  const known = ownEntry(GUIDANCE, diagnosis.pattern);
  if (known === undefined) {
    return {
      pattern: diagnosis.pattern,
      title: t("diagnosis.unknown.title"),
      whereToLook: looks("unknown", 2),
      atSeq: diagnosis.at_seq,
      expected: diagnosis.expected,
      code: diagnosis.code ?? null,
      narrative: diagnosis.narrative,
      unrecognised: true,
    };
  }

  return {
    pattern: diagnosis.pattern,
    title: t(`diagnosis.${diagnosis.pattern}.title`),
    whereToLook: looks(diagnosis.pattern, known),
    atSeq: diagnosis.at_seq,
    expected: diagnosis.expected,
    code: diagnosis.code ?? null,
    narrative: diagnosis.narrative,
    unrecognised: false,
  };
}

/** Every pattern this build has guidance for. Exported for the tests. */
export const KNOWN_PATTERNS: readonly string[] = Object.keys(GUIDANCE);
