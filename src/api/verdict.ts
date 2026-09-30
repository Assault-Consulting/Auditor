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
 * True twice over. A container cut mid-record reports `chain_ok: true` —
 * every record the reader could read does link to its predecessor — with the
 * truncation carried in `diagnosis`. And the field covers headers only: a
 * body swapped under an intact chain leaves it true as well, which is why
 * the response carries a separate `container` block.
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
  /**
   * Nothing in this file can answer it — no witness is present. Not a
   * failure of the log, and not a claim that nothing could: the absence
   * is the file's, not the platform's.
   */
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

/**
 * Anchor sources that live on the same host as the log they vouch for.
 *
 * A file anchor and a keychain entry sit beside the chain; at tier A nothing
 * stops the host that can rewrite the log from rewriting them too. A manual
 * head (handed over by someone else) and a PKCS#11 token (a private object
 * behind a PIN) do not share that exposure, so they do not get the caveat.
 */
const HOST_LOCAL_SOURCES: ReadonlySet<string> = new Set(["file", "keychain"]);

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
 *
 * **Three conditions, not one.** The audit of 2026-08 (finding K5) found
 * that `chain_ok` covers headers only: a body swapped under an intact
 * header chain leaves it true with no diagnosis, which put a green panel on
 * a file whose contents had changed. Still true of the reader path on 0.10,
 * so the sidecar now reports a `container` block from the package's report
 * builder, and question one is answered from both.
 *
 * A mismatched body is reported before a truncation, because it is the more
 * specific finding: a cut file is missing its end, while a body that does
 * not match its digest is a record that is not what its own header says.
 */
function consistency(v: VerificationResponse): Panel {
  const question = "Is what I hold internally consistent?";
  const basis = "Proved — hash chain and body digests, no key required";
  const mismatches = v.container.body_digest_mismatches;

  if (mismatches.length > 0) {
    // Named first, and named as records rather than as a conclusion. The
    // package's own wording for this is in the report's verdict; nothing
    // here says who or why.
    const where =
      mismatches.length === 1
        ? `record #${mismatches[0]}`
        : `${mismatches.length} records (${mismatches.map((s) => `#${s}`).join(", ")})`;
    return {
      index: "01",
      question,
      standing: "answered-no",
      answer: `The headers link, but ${where} no longer match the body digest their own header carries.`,
      basis,
      narrative: v.diagnosis?.narrative,
    };
  }

  // BOTH remaining conditions. See the module docstring: chain_ok is true
  // for a truncated container.
  if (v.chain.chain_ok && v.diagnosis === null) {
    return {
      index: "01",
      question,
      standing: "answered-yes",
      answer: `${v.chain.count} records, each linked to the one before it and matching its own body digest.`,
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
      // The caveat is about WHERE the head was kept, not about the tier
      // alone. It used to fire for any tier-A chain and call the anchor "a
      // local anchor store" — wrong for a head pasted from an independent
      // party (manual) or read from a token (pkcs11). The real limit is
      // narrower and stated as such: a head kept on the same host as a
      // tier-A log (a file, the OS keychain) can be rewritten with it.
      answer:
        isTierAOnly(subject) && v.anchor !== null && HOST_LOCAL_SOURCES.has(v.anchor.source_kind)
          ? `Complete to the head held by ${from}. At tier A a head kept on the same host as the log can be rewritten with it — this is complete against that store, nothing more.`
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
 * Answered from what this file carries, and only that: no witness is present
 * in it. That is not a defect in the log, and it is not a claim that none
 * could exist — an external witness (a SCITT receipt over a published head,
 * for instance) is tier-independent, checked against palimpsests 0.12.0.
 * The panel reports an absence; it never asserts an impossibility.
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
