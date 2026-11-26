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
import { fixedBasis, fixedNote } from "./fixed";
import { CATALOGS } from "../i18n";
import { KNOWN_STATUSES } from "./manifest";
import { VERDICT_MEANING } from "./report";
import { KNOWN_REFUSALS } from "./scitt";
import { KNOWN_TAIL_KINDS } from "./watch";

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

  it("every tail event the watch can report has words (channel 9)", () => {
    expect(sorted(KNOWN_TAIL_KINDS)).toEqual(sorted(vocabulary.tail_event_kinds));
  });

  it("every reason a statement is refused has words (channel 8)", () => {
    expect(sorted(KNOWN_REFUSALS)).toEqual(sorted(vocabulary.statement_refusal_codes));
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

group("the package's fixed sentences, by name (R19)", () => {
  const en = CATALOGS.en!;
  const notes = vocabulary.notes as Record<string, string>;
  const bases = vocabulary.health_bases as Record<string, string>;

  it("are in English exactly as the package writes them", () => {
    for (const [id, text] of Object.entries(notes)) expect(en[`fixed.note.${id}`], id).toBe(text);
    for (const [id, text] of Object.entries(bases)) expect(en[`fixed.basis.${id}`], id).toBe(text);
  });

  it("has no catalog key for a name the package does not have", () => {
    const stale = Object.keys(en).filter(
      (k) =>
        (k.startsWith("fixed.note.") && !(k.slice(11) in notes)) ||
        (k.startsWith("fixed.basis.") && !(k.slice(12) in bases)),
    );
    expect(stale).toEqual([]);
  });

  it("shows a name by its catalog entry and anything else as the package wrote it", () => {
    expect(fixedNote("advisory", "whatever the text")).toBe(en["fixed.note.advisory"]);
    // A report from 0.15.0 carries no name: its text, as written.
    expect(fixedNote(undefined, "advisory items do not affect the verdict")).toBe(
      "advisory items do not affect the verdict",
    );
    // A name added after this build: still the text, never a key.
    expect(fixedBasis("a_new_basis", "a new clock")).toBe("a new clock");
    expect(fixedNote("constructor", "x")).toBe("x");
  });
});
