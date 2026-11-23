// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * T11. Every table of sentences held to the package's own vocabulary.
 *
 * `generated/vocabulary.json` is written from the installed package by
 * scripts/generate_api_client.py, and CI regenerates and diffs it. So a word
 * a new palimpsests adds — a diagnosis pattern, an advisory code, a verdict,
 * a manifest status — first makes that file stale, and once regenerated,
 * fails here until the window has a sentence for it. Never shown unguided.
 *
 * Both directions: a word the package no longer has is a stale sentence.
 */

import { describe as group, expect, it } from "vitest";

import { KNOWN_CODES } from "./advisory";
import { KNOWN_PATTERNS } from "./diagnosis";
import vocabulary from "./generated/vocabulary.json";
import { KNOWN_STATUSES } from "./manifest";
import { VERDICT_MEANING } from "./report";

const sorted = (xs: Iterable<string>) => [...xs].sort();

group("the UI's tables are the package's vocabularies", () => {
  it("every diagnosis pattern has guidance", () => {
    expect(sorted(KNOWN_PATTERNS)).toEqual(sorted(vocabulary.diagnosis_patterns));
  });

  it("every advisory code has wording", () => {
    expect(sorted(KNOWN_CODES)).toEqual(sorted(vocabulary.advisory_codes));
  });

  it("every verdict has its meaning", () => {
    expect(sorted(Object.keys(VERDICT_MEANING))).toEqual(sorted(vocabulary.verdicts));
  });

  it("every manifest status has a sentence", () => {
    expect(sorted(KNOWN_STATUSES)).toEqual(sorted(vocabulary.manifest_statuses));
  });

  it("places every pattern under a question, or under none on purpose", () => {
    expect(sorted(Object.keys(vocabulary.diagnosis_questions))).toEqual(
      sorted(vocabulary.diagnosis_patterns),
    );
    for (const q of Object.values(vocabulary.diagnosis_questions)) {
      expect([null, "consistency", "completeness"]).toContain(q);
    }
  });
});
