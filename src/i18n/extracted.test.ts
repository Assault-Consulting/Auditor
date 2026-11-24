// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * L-02's ratchet: a module whose sentences have moved into the catalogs
 * keeps none in its code. Each module is added to `EXTRACTED` when its
 * extraction lands, and from then on a sentence written in it as an English
 * literal fails here — so extraction only goes forward.
 */

import ts from "typescript";
import { describe as group, expect, it } from "vitest";

const SOURCES = import.meta.glob(["../api/*.ts", "../state.ts", "!../api/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every module under src/api, and state.ts: all extracted (L-02). App.tsx follows. */
const EXTRACTED = Object.keys(SOURCES).sort();

function sentences(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  // A literal compared with a value is the package's word being matched,
  // not a sentence shown: `c.root_status === "carried, not recomputed"`.
  const compared = (n: ts.Node): boolean =>
    ts.isBinaryExpression(n.parent) &&
    [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(
      n.parent.operatorToken.kind,
    );
  // The package's own words, marked `verbatim("…")` — never translated (L-03).
  const quoted = (n: ts.Node): boolean =>
    ts.isCallExpression(n.parent) && ts.isIdentifier(n.parent.expression) && n.parent.expression.text === "verbatim";
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((s) => ` ${s.literal.text}`).join("");
    if (text !== null && /[a-z]{3,} [a-z]{2,}/i.test(text) && !ts.isImportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent) && !compared(node) && !quoted(node)) {
      out.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

group("extracted modules say nothing in English of their own (L-02)", () => {
  for (const file of EXTRACTED) {
    it(file.replace("../", ""), () => {
      const source = SOURCES[file];
      expect(source, `${file} is listed but not found`).toBeDefined();
      expect(sentences(file, source!)).toEqual([]);
    });
  }
});
