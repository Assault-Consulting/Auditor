// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * D-03 — the wording audit, kept as a test.
 *
 * Every string this application can put on the screen is collected from the
 * TypeScript syntax tree — string literals, templates and JSX text, never
 * comments — across `src/`, generated code and tests aside. Two rules hold
 * for all of it:
 *
 * - **L4, description never intent.** No sentence of ours says a file was
 *   tampered with, forged, attacked or corrupted. The package's own
 *   narratives are carried verbatim and are not in this source tree.
 * - **No overclaim.** Words that certify — verified, valid, compliant,
 *   proves, intact — appear only in the sentences listed below, each with
 *   its reason: negations ("certifies nothing"), and the inference profile's
 *   own sentences, quoted verbatim because rewording them would make a
 *   second, weaker claim.
 *
 * A new sentence that needs one of those words is a decision, made here in
 * the open, not a string that slips through a review.
 */

import ts from "typescript";
import { describe as group, expect, it } from "vitest";

/**
 * Every source file under `src/`, as text — Vite's own glob, so no Node API
 * and no new dependency. Tests and the generated client are left out: neither
 * is something the screen says.
 */
const SOURCES = import.meta.glob(
  ["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./**/*.test.tsx", "!./api/generated/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

interface Shown {
  where: string;
  text: string;
}

function shownStrings(): Shown[] {
  const out: Shown[] = [];
  for (const [file, source] of Object.entries(SOURCES)) {
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      let text: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node))
        text = node.head.text + node.templateSpans.map((s) => `\${…}${s.literal.text}`).join("");
      else if (ts.isJsxText(node)) text = node.text.replace(/\s+/g, " ").trim();
      // Sentences only: two words or more. Identifiers, keys and class names
      // are not something a person reads.
      if (text !== null && /[a-z]{3,} [a-z]{2,}/i.test(text) && !ts.isImportDeclaration(node.parent)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        out.push({ where: `${file.replace(/^\.\//, "")}:${line + 1}`, text });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const INTENT =
  /\b(tamper\w*|malicious|attack\w*|fraud\w*|forg(e|ed|ery)|deliberate\w*|manipulat\w*|corrupt\w*|hacked|breach\w*)\b/i;

const CERTIFYING =
  /\b(verified|valid|validated|certif(y|ied|ies|ication)|complian\w*|guarantee[sd]?|proves|proven|authentic\w*|trustworthy|tamper-proof|immutable|intact)\b/i;

/** Every sentence allowed a certifying word, and why. Matched by substring. */
const ALLOWED: Record<string, string> = {
  "It certifies nothing": "a negation — the thesis line says what the tool does not do",
  "They certify nothing": "a negation — the footnote under the panels",
  "not a certification": "a negation — what a report is",
  "the chain proves the report happened":
    "the inference profile's own sentence for reported-by-client (r5), quoted verbatim",
};

group("the wording audit (D-03)", () => {
  const shown = shownStrings();

  it("collects what the screen can say", () => {
    // A collector that silently found nothing would pass every rule below.
    expect(shown.length).toBeGreaterThan(200);
  });

  it("never attributes intent (L4)", () => {
    const hits = shown.filter((s) => INTENT.test(s.text)).map((s) => `${s.where}: ${s.text}`);
    expect(hits).toEqual([]);
  });

  it("uses a certifying word only where the list above says why", () => {
    const hits = shown
      .filter((s) => CERTIFYING.test(s.text))
      .filter((s) => !Object.keys(ALLOWED).some((allowed) => s.text.includes(allowed)))
      .map((s) => `${s.where}: ${s.text}`);
    expect(hits).toEqual([]);
  });

  it("keeps every allowance in use, so the list cannot rot", () => {
    for (const allowed of Object.keys(ALLOWED)) {
      expect(shown.some((s) => s.text.includes(allowed)), allowed).toBe(true);
    }
  });
});
