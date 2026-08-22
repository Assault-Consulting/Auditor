// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The diagnosis card.
 *
 * Two things matter and both are about restraint: that the card adds *where
 * to look* rather than restating what the verifier already said, and that it
 * never turns a shape of evidence into a claim about a person.
 */

import { describe as group, expect, it } from "vitest";

import type { DiagnosisModel } from "./generated/types";
import { KNOWN_PATTERNS, diagnosisCard } from "./diagnosis";

/** Narratives copied from a real verifier run, not invented for the test. */
const TRUNCATED: DiagnosisModel = {
  pattern: "truncated_tail",
  at_seq: null,
  expected: "a record ending exactly at end-of-file",
  narrative:
    "The container ends in the middle of a record; the evidence is consistent with a writer interrupted mid-write.",
};

const REPLACED: DiagnosisModel = {
  pattern: "replaced_or_rolled_back",
  at_seq: null,
  expected: "the anchored head present somewhere in the chain",
  narrative:
    "The anchored head names no record in this chain; the evidence is consistent with the log having been replaced or rolled back.",
};

const PREFIX: DiagnosisModel = {
  pattern: "prefix_absent",
  at_seq: 0,
  expected: "a GENESIS record at position 0",
  narrative:
    "The chain's prefix is absent — its first record is not a GENESIS; the evidence is consistent with an incomplete copy.",
};

group("no diagnosis, no card", () => {
  it("returns null rather than an empty card", () => {
    // An empty card would occupy the screen and say nothing, which reads as
    // a failure with no detail rather than as no failure.
    expect(diagnosisCard(null)).toBeNull();
  });
});

group("the verifier's sentence is carried, not rewritten", () => {
  it.each([TRUNCATED, REPLACED, PREFIX])("keeps %s verbatim", (d) => {
    expect(diagnosisCard(d)?.narrative).toBe(d.narrative);
  });

  it("keeps the location and the expectation", () => {
    const card = diagnosisCard(PREFIX);
    expect(card?.atSeq).toBe(0);
    expect(card?.expected).toBe("a GENESIS record at position 0");
  });
});

group("the two patterns that matter most are told apart", () => {
  it("sends a truncated tail to look for a live writer and a later segment", () => {
    // §8: a crash between writing and anchoring looks nothing like a
    // replacement, and only the pattern says which investigation to open.
    const where = diagnosisCard(TRUNCATED)?.whereToLook.join(" ") ?? "";
    expect(where).toContain("still running");
    expect(where).toContain("later segment");
  });

  it("sends a replaced head to check the anchor before the log", () => {
    // A stale entry in an anchor store is far more common than a replaced
    // log, and saying so first is what keeps this from being an accusation.
    const where = diagnosisCard(REPLACED)?.whereToLook.join(" ") ?? "";
    expect(where).toContain("different deployment");
    expect(where).toContain("stale entry");
  });

  it("gives them different guidance entirely", () => {
    // If a shared line ever appears in both, the distinction has started to
    // blur — and the distinction is the point.
    const a = diagnosisCard(TRUNCATED)?.whereToLook ?? [];
    const b = diagnosisCard(REPLACED)?.whereToLook ?? [];
    expect(a.some((line) => b.includes(line))).toBe(false);
  });
});

group("every known pattern is usable", () => {
  it.each(KNOWN_PATTERNS)("%s has a title and somewhere to look", (pattern) => {
    const card = diagnosisCard({
      pattern,
      at_seq: null,
      expected: null,
      narrative: "…",
    });
    expect(card?.title).not.toBe("");
    expect(card?.whereToLook.length).toBeGreaterThan(0);
    expect(card?.unrecognised).toBe(false);
  });

  it("covers the seven the specification lists", () => {
    // FUNCTIONALITY.md §8 names seven. A pattern arriving with no guidance
    // is handled, but a pattern the specification already lists arriving
    // with none would just be an omission.
    expect(KNOWN_PATTERNS).toHaveLength(7);
  });
});

group("an unknown pattern is handled, not hidden", () => {
  const FUTURE: DiagnosisModel = {
    pattern: "something_this_build_has_never_heard_of",
    at_seq: 42,
    expected: null,
    narrative: "A newer verifier described this failure.",
  };

  it("still produces a card", () => {
    // Omitting the failure because we have no advice would be the worst
    // possible response: the screen would show no diagnosis at all.
    expect(diagnosisCard(FUTURE)).not.toBeNull();
  });

  it("says plainly that there is no guidance", () => {
    expect(diagnosisCard(FUTURE)?.unrecognised).toBe(true);
    expect(diagnosisCard(FUTURE)?.title).toContain("no guidance");
  });

  it("still carries the verifier's sentence and location", () => {
    const card = diagnosisCard(FUTURE);
    expect(card?.narrative).toBe(FUTURE.narrative);
    expect(card?.atSeq).toBe(42);
  });

  it("invents no advice for a shape nobody has described", () => {
    const where = diagnosisCard(FUTURE)?.whereToLook.join(" ") ?? "";
    expect(where).toContain("authoritative");
    expect(where).toContain("older than the writer");
  });
});

group("guidance asks, it does not conclude", () => {
  it.each(KNOWN_PATTERNS)("%s attributes nothing to anyone", (pattern) => {
    // L4. The package's narrative is exempt — it is carried verbatim and is
    // its own careful wording. Every line below is ours.
    const card = diagnosisCard({ pattern, at_seq: null, expected: null, narrative: "…" });
    const ours = `${card?.title} ${card?.whereToLook.join(" ")}`.toLowerCase();
    for (const forbidden of ["tamper", "malicious", "attack", "fraud", "deliberate", "someone deleted"]) {
      expect(ours).not.toContain(forbidden);
    }
  });

  it("never states that the log was replaced, only that the anchor is not in it", () => {
    // The pattern is named replaced_or_rolled_back; the title must not
    // repeat that as a finding. The verifier hedges; so does the card.
    const title = diagnosisCard(REPLACED)?.title ?? "";
    expect(title).toBe("The anchored head is not in this chain");
  });
});
