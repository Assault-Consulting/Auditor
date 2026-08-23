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

import type { DiagnosisModel } from "./generated/types";

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
  /** The verifier's own sentence, carried verbatim. */
  narrative: string;
  /** True when this build has no guidance for the pattern. */
  unrecognised: boolean;
}

interface Guidance {
  title: string;
  whereToLook: string[];
}

/**
 * Per-pattern guidance.
 *
 * Written as questions and places, never as conclusions. "Check whether the
 * writer was restarted" is help; "the writer crashed" is a claim this
 * application has no standing to make.
 */
const GUIDANCE: Record<string, Guidance> = {
  truncated_tail: {
    title: "The file ends mid-record",
    whereToLook: [
      "Whether the writing process was still running when this file was copied — a live log ends mid-record by definition, and the rule is to verify a copy rather than the file being written.",
      "The host's own logs around the end of this file, for a restart or a power loss.",
      "Whether a later segment of the same chain exists; a truncated tail is often only the end of one file, not the end of the history.",
    ],
  },
  prefix_absent: {
    title: "The chain does not start at its beginning",
    whereToLook: [
      "Whether an earlier segment of this chain exists — the first record here is not a GENESIS, so something precedes it.",
      "How this file was extracted: a copy taken from an offset, or a partial transfer, produces exactly this.",
    ],
  },
  seq_gap: {
    title: "A sequence number is missing",
    whereToLook: [
      "Whether records were dropped under load — the writer records shedding explicitly, so look for a SHED record near the gap.",
      "Whether two segments were concatenated with something missing between them.",
    ],
  },
  chain_break: {
    title: "A record does not name its predecessor",
    whereToLook: [
      "The record at the break and the one before it — everything earlier still verifies, so the history up to that point stands.",
      "Whether two chains were spliced: a break at a boundary where the boot identifier also changes is a different situation from one inside a boot.",
    ],
  },
  record_violation: {
    title: "One record breaks a rule the format requires",
    whereToLook: [
      "The named record; the chain around it is intact, so this is about that record rather than the history.",
      "Which writer version produced it — a violation confined to one record is more often a writer defect than anything else.",
    ],
  },
  unanchored_tail: {
    title: "Records exist past the anchored head",
    whereToLook: [
      "When the anchor was last written — records after it are not evidence of a problem, only of an anchor that has not caught up.",
      "The anchor's own cadence: if it lags routinely, this is the normal state of the system rather than an event.",
    ],
  },
  replaced_or_rolled_back: {
    title: "The anchored head is not in this chain",
    whereToLook: [
      "Whether the anchor belongs to this chain at all — an anchor from a different deployment produces this exactly.",
      "Whether the file was restored from a backup taken before the anchored head.",
      "The anchor source that answered: a stale entry in a store is far more common than a replaced log, and the provenance panel names which source it came from.",
    ],
  },
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
export function diagnosisCard(diagnosis: DiagnosisModel | null): DiagnosisCard | null {
  if (diagnosis === null) return null;

  const known = GUIDANCE[diagnosis.pattern];
  if (known === undefined) {
    return {
      pattern: diagnosis.pattern,
      title: "A failure this build has no guidance for",
      whereToLook: [
        "The verifier's own description below — it is authoritative, and this application simply has nothing to add to it.",
        "Whether this reader is older than the writer that produced the file; a newer verifier may name a pattern this one does not know.",
      ],
      atSeq: diagnosis.at_seq,
      expected: diagnosis.expected,
      narrative: diagnosis.narrative,
      unrecognised: true,
    };
  }

  return {
    pattern: diagnosis.pattern,
    title: known.title,
    whereToLook: known.whereToLook,
    atSeq: diagnosis.at_seq,
    expected: diagnosis.expected,
    narrative: diagnosis.narrative,
    unrecognised: false,
  };
}

/** Every pattern this build has guidance for. Exported for the tests. */
export const KNOWN_PATTERNS: readonly string[] = Object.keys(GUIDANCE);
