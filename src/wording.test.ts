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
 *   proves, intact — appear only in the sentences each language's list
 *   allows (`i18n/wording/<tag>.json`), each with its reason: negations ("certifies nothing"), and the inference profile's
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

/**
 * Every catalog, too (L-02): a sentence moved out of the code into
 * `i18n/locales/<tag>.json` is still a sentence the screen says, and the two
 * rules hold for it in every language — each with its own word lists,
 * `i18n/wording/<tag>.json` (L-05). The code's sentences are English and
 * answer to English's lists.
 */
const CATALOG_FILES = import.meta.glob("./i18n/locales/*.json", { import: "default", eager: true }) as Record<
  string,
  Record<string, string | Record<string, string>>
>;

interface WordLists {
  intent: string[];
  certifying: string[];
  allowed: Record<string, string>;
}

const WORDING_FILES = import.meta.glob("./i18n/wording/*.json", { import: "default", eager: true }) as Record<
  string,
  WordLists
>;

const tagOf = (file: string): string => file.replace(/^.*\//, "").replace(/\.json$/, "");

/**
 * One alternation, bounded on both sides by anything that is not a letter or
 * a digit. `\b` would not do: in JavaScript it knows only ASCII letters, so
 * it would see a boundary inside every Cyrillic word.
 */
function words(list: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.join("|")})(?![\\p{L}\\p{N}_])`, "iu");
}

const LISTS: Record<string, { intent: RegExp; certifying: RegExp; allowed: Record<string, string> }> = Object.fromEntries(
  Object.entries(WORDING_FILES).map(([file, w]) => [
    tagOf(file),
    { intent: words(w.intent), certifying: words(w.certifying), allowed: w.allowed },
  ]),
);

interface Shown {
  /** Whose word lists apply: the catalog's language, or `en` for the code. */
  lang: string;
  where: string;
  text: string;
}

function shownStrings(): Shown[] {
  const out: Shown[] = [];
  for (const [file, catalog] of Object.entries(CATALOG_FILES)) {
    for (const [key, entry] of Object.entries(catalog)) {
      if (key.startsWith("meta.")) continue;
      const texts = typeof entry === "string" ? [entry] : Object.values(entry);
      for (const text of texts) out.push({ lang: tagOf(file), where: `${file.replace(/^\.\//, "")}:${key}`, text });
    }
  }
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
        out.push({ lang: "en", where: `${file.replace(/^\.\//, "")}:${line + 1}`, text });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

group("the wording audit (D-03)", () => {
  const shown = shownStrings();

  it("collects what the screen can say", () => {
    // A collector that silently found nothing would pass every rule below.
    expect(shown.length).toBeGreaterThan(200);
  });

  it("has word lists for every language it shows", () => {
    expect(Object.keys(LISTS)).toContain("en");
    const without = Object.keys(CATALOG_FILES).map(tagOf).filter((tag) => !(tag in LISTS));
    expect(without).toEqual([]);
  });

  it("never attributes intent (L4)", () => {
    const hits = shown.filter((s) => LISTS[s.lang]?.intent.test(s.text)).map((s) => `${s.where}: ${s.text}`);
    expect(hits).toEqual([]);
  });

  it("uses a certifying word only where its language's list says why", () => {
    const hits = shown
      .filter((s) => LISTS[s.lang]?.certifying.test(s.text))
      .filter((s) => !Object.keys(LISTS[s.lang]!.allowed).some((allowed) => s.text.includes(allowed)))
      .map((s) => `${s.where}: ${s.text}`);
    expect(hits).toEqual([]);
  });

  it("keeps every allowance in use, so no list can rot", () => {
    for (const [lang, lists] of Object.entries(LISTS)) {
      for (const allowed of Object.keys(lists.allowed)) {
        expect(
          shown.some((s) => s.lang === lang && s.text.includes(allowed)),
          `${lang}: ${allowed}`,
        ).toBe(true);
      }
    }
  });

  it("catches each language's words, so a list that matches nothing fails here", () => {
    expect(LISTS.en!.intent.test("the file was tampered with")).toBe(true);
    expect(LISTS.en!.certifying.test("a verified chain")).toBe(true);
    expect(LISTS.en!.certifying.test("an invalid chain")).toBe(false);
    expect(LISTS.uk!.intent.test("файл підроблено")).toBe(true);
    expect(LISTS.uk!.certifying.test("засвідчений ланцюжок")).toBe(true);
    // Order is proved — the word English allows — is allowed here too.
    expect(LISTS.uk!.certifying.test("Порядок доведено")).toBe(false);
    // A Cyrillic word is one word: no boundary inside it.
    expect(LISTS.uk!.intent.test("дератаковано")).toBe(false);
  });
});
