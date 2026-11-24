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
 * truncation in `container.well_formed`. And the field covers headers only: a
 * body swapped under an intact chain leaves it true as well, which is why
 * the response carries a separate `container` block.
 *
 * **Nor is `diagnosis` the answer to it.** The package gives one diagnosis
 * for all three questions, and some of its patterns are about question two
 * (an anchor the chain has outrun, or one that names nothing in it).
 * Question one is the package's `consistent` — `is_consistent()`, the rule
 * `pala verify --json` calls `consistency.ok` (T10, 0.15) — and the
 * diagnosis's `question`, also the package's, decides under which panel its
 * sentence is shown. No list of patterns is kept here.
 */

import { t, tn } from "../i18n";
import { count } from "./plural";
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
  // Tier names are the package's, shown as it gives them (L-03).
  const names = subject.assurance_tiers.map((x) => x.name ?? t("verdict.tier.value", { value: x.value }));
  if (names.length === 0) return t("verdict.tier.unstated");
  if (names.length === 1) return t("verdict.tier.one", { name: names[0]! });
  // More than one tier means the platform guarantee changed mid-chain, and
  // the sentence has to say so rather than pick a winner.
  return t("verdict.tier.mixed", { names: names.join(", ") });
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
  const question = t("verdict.q1.question");
  const basis = t("verdict.q1.basis");
  const mismatches = v.container.body_digest_mismatches;

  if (mismatches.length > 0) {
    // Named first, and named as records rather than as a conclusion. The
    // package's own wording for this is in the report's verdict; nothing
    // here says who or why.
    const where =
      mismatches.length === 1
        ? t("verdict.q1.mismatch.one", { seq: mismatches[0]! })
        : t("verdict.q1.mismatch.many", {
            records: count(mismatches.length, "record"),
            seqs: mismatches.map((s) => `#${s}`).join(", "),
          });
    return {
      index: "01",
      question,
      standing: "answered-no",
      answer: t("verdict.q1.mismatch", { where }),
      basis,
      narrative: v.diagnosis?.narrative,
    };
  }

  // A file with no records (C-17b): nothing to link, so neither "linked"
  // nor "does not hold" is true of it. Since 0.14 such a file opens and the
  // package names it — not_a_container, empty_container, or, read against an
  // anchor, replaced_or_rolled_back (a log was written and is not here). The
  // sentence says what the file is not; the package's own sits beside it.
  if (v.chain.count === 0) {
    return {
      index: "01",
      question,
      standing: "answered-no",
      answer:
        v.diagnosis?.pattern === "not_a_container"
          ? t("verdict.q1.not_a_container")
          : t("verdict.q1.empty"),
      basis,
      narrative: v.diagnosis?.narrative,
    };
  }

  // The package's answer, not the diagnosis (see the module docstring).
  // chain_ok alone is true for a truncated container and a swapped body.
  const d = v.diagnosis;
  const about = d?.question ?? null;
  // The sentence is shown here unless the package places it under question
  // two. A pattern it does not place is shown here, said to be unguided.
  const own = d !== null && about !== "completeness" ? d.narrative : undefined;
  if (v.consistent) {
    const records = count(v.chain.count, "record");
    const linked = t("verdict.q1.linked", { records });
    if (d === null || about === "completeness") {
      return { index: "01", question, standing: "answered-yes", answer: linked, basis };
    }
    if (about === "consistency") {
      // Not reached on 0.15 — such a diagnosis comes with an inconsistent
      // file — but when the two disagree, the narrower no is not overruled.
      return {
        index: "01",
        question,
        standing: "answered-no",
        answer: t("verdict.q1.not_whole", { records }),
        basis,
        narrative: own,
      };
    }
    // A pattern this build of the package does not place: the answer stands,
    // and the verifier's sentence is shown as what it is.
    return {
      index: "01",
      question,
      standing: "answered-yes",
      answer: t("verdict.q1.unguided", { linked }),
      basis,
      narrative: own,
    };
  }

  const failed = !v.chain.chain_ok;
  return {
    index: "01",
    question,
    standing: "answered-no",
    answer: failed
      ? t("verdict.q1.no_hold", { records: count(v.chain.count, "record") })
      : t("verdict.q1.not_whole", { records: count(v.chain.count, "record") }),
    basis,
    narrative: own,
  };
}

/**
 * Question two: is what I hold all of it?
 *
 * The only question that can go unasked, and the answer must say so. Null is
 * "not checked", never a pass — and the wording never lets it read as one.
 */
function completeness(v: VerificationResponse, subject: ChainSubject): Panel {
  const question = t("verdict.q2.question");
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
          ? t("verdict.q2.no_anchor")
          : tn("verdict.q2.none_answered", tried),
      basis: t("verdict.q2.basis.none"),
    };
  }

  const from = v.anchor
    ? t("verdict.q2.from", { kind: v.anchor.source_kind, detail: v.anchor.source_detail })
    : t("verdict.q2.an_anchor");

  // A file with no records proves nothing complete. Its head is the empty
  // chain's — thirty-two zero bytes — and an anchor holding that head
  // "matches", which is true of nothing. Not a no either: nothing is missing
  // that the file can show. Report /2 (0.15) names this verdict `empty`;
  // this panel is computed from the facts, so it says so here.
  if (complete && v.chain.count === 0) {
    return {
      index: "02",
      question,
      standing: "not-checked",
      answer: t("verdict.q2.empty", { from }),
      basis: t("verdict.q2.basis.read", { from }),
    };
  }

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
          ? t("verdict.q2.complete.host_local", { from })
          : t("verdict.q2.complete", { from }),
      basis: t("verdict.q2.basis.proved", { from }),
    };
  }

  const lag = v.completeness.anchor_lag;
  return {
    index: "02",
    question,
    standing: "answered-no",
    answer:
      lag !== null && lag > 0
        ? tn("verdict.q2.lag", lag, { from })
        : t("verdict.q2.not_in_chain", { from }),
    basis: t("verdict.q2.basis.checked", { from }),
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
  const question = t("verdict.q3.question");
  const clocks = subject.time_trust_values.map((x) => x.name ?? t("verdict.q3.clock.value", { value: x.value }));
  const clock =
    clocks.length === 1
      ? t("verdict.q3.clock.one", { clock: clocks[0]! })
      : t("verdict.q3.clock.changed", { clocks: clocks.join(", ") });

  return {
    index: "03",
    question,
    standing: "unavailable",
    answer: t("verdict.q3.answer", { clock }),
    basis: t("verdict.q3.basis", { tier: tierPhrase(subject) }),
  };
}

/** The three panels, in the order the questions can be answered. */
export function triptych(
  v: VerificationResponse,
  subject: ChainSubject,
): [Panel, Panel, Panel] {
  return [consistency(v), completeness(v, subject), existence(subject)];
}
