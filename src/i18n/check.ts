// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The guards a catalog must pass (L-04), as a function, so a test runs them
 * over every file in `locales/` and a translator can read what failed.
 *
 * Against English, the source:
 * - exactly the same keys — none missing, none extra;
 * - the same placeholders in each entry, by name (`{n}`, `{path}`);
 * - a plural where English has a plural, with every category the language
 *   needs by `Intl.PluralRules` and none it does not have;
 * - a `meta.name`, the language's name for itself.
 */

import type { Catalog, Entry } from "./index";

const PLACEHOLDER = /\{(\w+)\}/g;

function names(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort();
}

function placeholders(entry: Entry): string[] {
  const texts = typeof entry === "string" ? [entry] : Object.values(entry).filter((x): x is string => typeof x === "string");
  return [...new Set(texts.flatMap(names))].sort();
}

/** What is wrong with `catalog` for language `tag`, in sentences; empty when nothing is. */
export function catalogProblems(tag: string, catalog: Catalog, source: Catalog): string[] {
  const problems: string[] = [];
  if (typeof catalog["meta.name"] !== "string") problems.push("no meta.name: the language's own name");
  const want = new Set(Object.keys(source));
  const have = new Set(Object.keys(catalog));
  for (const k of want) if (!have.has(k)) problems.push(`missing ${k}`);
  for (const k of have) if (!want.has(k)) problems.push(`extra ${k}, which English does not have`);

  let categories: Set<string>;
  try {
    categories = new Set(new Intl.PluralRules(tag).resolvedOptions().pluralCategories);
  } catch {
    return [...problems, `${tag} is not a language tag this platform knows`];
  }
  for (const k of want) {
    if (!have.has(k) || k.startsWith("meta.")) continue;
    const src = source[k]!;
    const got = catalog[k]!;
    if (typeof src !== typeof got) {
      problems.push(`${k}: ${typeof src === "string" ? "a sentence" : "a plural"} in English, not here`);
      continue;
    }
    if (typeof got !== "string") {
      const forms = new Set(Object.keys(got));
      for (const c of categories) if (!forms.has(c)) problems.push(`${k}: no "${c}" form, which ${tag} needs`);
      for (const f of forms) if (!categories.has(f)) problems.push(`${k}: a "${f}" form ${tag} does not have`);
    }
    const a = placeholders(src).join(",");
    const b = placeholders(got).join(",");
    if (a !== b) problems.push(`${k}: placeholders {${b}} where English has {${a}}`);
  }
  return problems;
}
