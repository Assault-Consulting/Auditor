// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The three questions, turned into three answers a screen can render.
 *
 * A pure function over what the sidecar returned, kept out of the component
 * so the wording is testable — and in this product the wording *is* the
 * behaviour. A panel that says the wrong sentence about a truncated file is
 * not a styling defect.
 *
 * The rule this module exists to enforce, from docs/API.md and
 * FUNCTIONALITY.md §6:
 *
 *   **`chain_ok` alone is not the answer to question one.**
 *
 * A container cut mid-record reports `chain_ok: true` — every record the
 * reader could read does link to its predecessor — with the truncation
 * carried in `diagnosis`. Rendering `chain_ok` on its own would put a green
 * tick on a cut file: truthful about the field, misleading about the file.
 */

import type {
  ChainSubject,
  VerificationResponse,
} from "./generated/types";

/**
 * What a panel is allowed to say.
 *
 * `not-checked` is not a failure and `unavailable` is not either. L6 keeps
 * absent, unreadable and failed apart at the API; the same three-way
 * distinction has to survive all the way to the screen or the API's care was
 * wasted at the last step.
 */
export type Standing =
  /** The question was asked and answered yes. */
  | "answered-yes"
  /** The question was asked and answered no. */
  | "answered-no"
  /** Nothing asked it. Never rendered as a pass (L7). */
  | "not-checked"
  /** Nothing on this platform could answer it. Not a failure of the log. */
  | "unavailable";

export interface Panel {
  index: "01" | "02" | "03";
  question: string;
  standing: Standing;
  /** One line, in the tool's own voice. */
  answer: string;
  /** What kind of claim the answer is — Proved, Recorded, or neither. */
  basis: string;
  /** The verifier's own sentence, when it produced one. Never rewritten. */
  narrative?: string;
}

/** The tier names a chain carries, deduplicated and ready to put in a sentence. */
function tierPhrase(subject: ChainSubject): string {
  const names = subject.assurance_tiers.map((t) => t.name ?? `tier ${t.value}`);
  if (names.length === 0) return "an unstated tier";
  if (names.length === 1) return `tier ${names[0]}`;
  // More than one tier means the platform guarantee changed mid-chain, and
  // the sentence has to say so rather than pick a winner.
  return `mixed tiers ${names.join(", ")}`;
}

/** Whether every record was written under tier A — the floor. */
function isTierAOnly(subject: ChainSubject): boolean {
  return (
    subject.assurance_tiers.length === 1 && subject.assurance_tiers[0]?.value === 0
  );
}

/**
 * Question one: is what I hold internally consistent?
 *
 * Answerable always — it needs no key and no anchor, only the bytes. Which
 * is why it is the one question that never returns `not-checked`.
 */
function consistency(v: VerificationResponse): Panel {
  const question = "Is what I hold internally consistent?";
  const basis = "Proved — hash chain, no key required";

  // BOTH conditions. See the module docstring: chain_ok is true for a
  // truncated container.
  if (v.chain.chain_ok && v.diagnosis === null) {
    return {
      index: "01",
      question,
      standing: "answered-yes",
      answer: `${v.chain.count} records, each linked to the one before it.`,
      basis,
    };
  }

  const failed = !v.chain.chain_ok;
  return {
    index: "01",
    question,
    standing: "answered-no",
    answer: failed
      ? `${v.chain.count} records read; the chain does not hold.`
      : `${v.chain.count} records read and linked, but the file is not whole.`,
    basis,
    narrative: v.diagnosis?.narrative,
  };
}

/**
 * Question two: is what I hold all of it?
 *
 * The only question that can go unasked, and the answer must say so. Null is
 * "not checked", never a pass — and the wording never lets it read as one.
 */
function completeness(v: VerificationResponse, subject: ChainSubject): Panel {
  const question = "Is what I hold all of it?";
  const complete = v.completeness.complete_to_anchor;

  if (complete === null) {
    // Two ways to get here, and they call for different sentences: no
    // profile at all, or a profile whose every source was absent. The
    // second is an operator who configured an anchor and got nothing —
    // telling them "no anchor supplied" would send them to fix something
    // that is not broken.
    const tried = v.anchor_attempts.length;
    return {
      index: "02",
      question,
      standing: "not-checked",
      answer:
        tried === 0
          ? "Not checked — no anchor was supplied."
          : `Not checked — ${tried} anchor ${tried === 1 ? "source" : "sources"} were consulted and none answered.`,
      basis: "No answer without an anchor from outside this file",
    };
  }

  const from = v.anchor
    ? `${v.anchor.source_kind} — ${v.anchor.source_detail}`
    : "an anchor";

  if (complete) {
    return {
      index: "02",
      question,
      standing: "answered-yes",
      answer: isTierAOnly(subject)
        ? `Complete to the head held by ${from}. At tier A that means complete against a local anchor store, nothing more.`
        : `Complete to the head held by ${from}.`,
      basis: `Proved against ${from}`,
    };
  }

  const lag = v.completeness.anchor_lag;
  return {
    index: "02",
    question,
    standing: "answered-no",
    answer:
      lag !== null && lag > 0
        ? `${lag} records sit beyond the head held by ${from}.`
        : `The head held by ${from} does not name a record in this chain.`,
    basis: `Checked against ${from}`,
    narrative: v.completeness.anchor_reason ?? undefined,
  };
}

/**
 * Question three: did this history exist at time T?
 *
 * At tier A there is no external evidence to have. That is honest and it is
 * not a defect in the log — it is a property of the platform it was written
 * on, and the panel is the standing argument for a tier upgrade rather than
 * an error to be cleared.
 */
function existence(subject: ChainSubject): Panel {
  const question = "Did this history exist at time T?";
  const clocks = subject.time_trust_values.map((t) => t.name ?? `value ${t.value}`);
  const clock =
    clocks.length === 1
      ? `the writer's clock (${clocks[0]})`
      : `the writer's clock, which changed status mid-chain (${clocks.join(", ")})`;

  return {
    index: "03",
    question,
    standing: "unavailable",
    answer: `No external evidence in this file. Order is proved; the times are what ${clock} recorded.`,
    basis: `Recorded — ${tierPhrase(subject)}, no witness present`,
  };
}

/** The three panels, in the order the questions can be answered. */
export function triptych(
  v: VerificationResponse,
  subject: ChainSubject,
): [Panel, Panel, Panel] {
  return [consistency(v), completeness(v, subject), existence(subject)];
}
