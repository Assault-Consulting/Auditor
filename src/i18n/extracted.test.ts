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

import { CATALOGS } from "./index";

const en = CATALOGS.en!;

const SOURCES = import.meta.glob(["../api/*.ts", "../state.ts", "../App.tsx", "!../api/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every module under src/api, state.ts and App.tsx: all extracted (L-02). */
const EXTRACTED = Object.keys(SOURCES).sort();

/** Attributes a reader sees or hears. */
const SHOWN_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "aria-roledescription", "label"]);

/** Text between tags that no language translates: the product's name, a kind name, a file name. */
const UNTRANSLATED_TEXT = new Set(["Palimpsests", "Auditor", "SAFETY", "chain.pala.00001"]);

function sentences(file: string, source: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
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
  // A label is shown even when it is one word: `{ label: "Spans" }`.
  const labelled = (n: ts.Node): boolean =>
    ts.isPropertyAssignment(n.parent) && n.parent.initializer === n && ["label", "title", "heading"].includes(n.parent.name.getText());
  // An attribute nobody reads — a class, an id, a key — is not shown.
  const unshown = (n: ts.Node): boolean => ts.isJsxAttribute(n.parent) && !SHOWN_ATTRIBUTES.has(n.parent.name.getText());
  const visit = (node: ts.Node): void => {
    // Between tags even one word is shown, so any word counts there — but
    // names and the package's tokens are the same in every language.
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (/[A-Za-z]{2,}/.test(text) && !UNTRANSLATED_TEXT.has(text)) {
        out.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text}`);
      }
      return;
    }
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((s) => ` ${s.literal.text}`).join("");
    if (text !== null && (/[a-z]{3,} [a-z]{2,}/i.test(text) || (labelled(node) && /[A-Za-z]{2,}/.test(text))) && !ts.isImportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent) && !compared(node) && !quoted(node) && !unshown(node)) {
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

/** Every key a module asks for by name, `t("…")`, `tn("…")`, `tr("…")` — either side of a `?:` too. */
function keysAsked(file: string, source: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const literals = (e: ts.Expression): void => {
    if (ts.isStringLiteral(e)) out.push(e.text);
    else if (ts.isConditionalExpression(e)) {
      literals(e.whenTrue);
      literals(e.whenFalse);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "tn", "tr"].includes(node.expression.text) && node.arguments[0]) {
      literals(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

group("every key an extracted module asks for is in English (L-02)", () => {
  for (const file of EXTRACTED) {
    it(file.replace("../", ""), () => {
      const absent = keysAsked(file, SOURCES[file]!).filter((k) => !(k in en));
      expect(absent).toEqual([]);
    });
  }
});
