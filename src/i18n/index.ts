// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The language system (L-01). Any language is one file, `locales/<bcp47>.json`;
 * adding one touches no code.
 *
 * - **Keys, not English.** A key names a screen and a meaning
 *   (`count.record`, `bundle.note`); English is one catalog among others,
 *   the source and the fallback.
 * - **Placeholders by name**, `{n}`, `{path}` — never by position, so a
 *   language may put them in any order.
 * - **Plurals by the platform.** A plural entry is an object keyed by the
 *   CLDR categories `Intl.PluralRules` gives for the language (English one /
 *   other; Ukrainian one / few / many / other). No plural rule is written
 *   here, so no language's rule is written wrong.
 * - **A missing key falls back to English**, then to the key itself only if
 *   English lacks it too — counted in `missing()`, which a test holds at zero.
 * - **The chosen language** is the user's override if one is set (kept in
 *   this window's storage, best effort), else the first of the system's
 *   languages a catalog exists for, else English. `<html lang>` and `dir`
 *   follow it, so a screen reader switches voice.
 *
 * Module state, not a React context: the sentence-making modules under
 * `src/api` are plain functions and call `t` directly; React re-renders
 * through `useLocale`, which subscribes.
 *
 * What is never translated is L-03's rule, kept by the callers: the
 * package's own words — narratives, details, kind names, codes — are shown
 * as the package wrote them.
 */

import { createElement, Fragment, type ReactNode, useSyncExternalStore } from "react";

export type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Entry = string | Plural;
export type Catalog = Record<string, Entry>;
/** A placeholder's value; null and undefined are written as nothing. */
export type Params = Record<string, string | number | null | undefined>;

const SOURCE = "en";
const STORAGE_KEY = "auditor.locale";

/** Every catalog in `locales/`, found at build time: adding a file adds a language. */
const found = import.meta.glob<{ default: Catalog }>("./locales/*.json", { eager: true });

export const CATALOGS: Readonly<Record<string, Catalog>> = Object.fromEntries(
  Object.entries(found).map(([file, mod]) => [file.replace(/^.*\/(.+)\.json$/, "$1"), mod.default]),
);

/** The languages there are catalogs for, as BCP 47 tags, English first. */
export const LOCALES: readonly string[] = Object.keys(CATALOGS).sort((a, b) =>
  a === SOURCE ? -1 : b === SOURCE ? 1 : a.localeCompare(b),
);

/** A language's own name for itself, from its catalog. */
export function localeName(tag: string): string {
  const name = CATALOGS[tag]?.["meta.name"];
  return typeof name === "string" ? name : tag;
}

/**
 * The first preferred language a catalog exists for: an exact tag, then its
 * base language (`uk-UA` → `uk`), else English.
 */
export function negotiate(preferred: readonly string[], available: readonly string[] = LOCALES): string {
  for (const want of preferred) {
    const exact = available.find((a) => a.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const base = want.split("-")[0]!.toLowerCase();
    const byBase = available.find((a) => a.toLowerCase() === base);
    if (byBase) return byBase;
  }
  return SOURCE;
}

function stored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The system's languages, most preferred first, as the webview reports them. */
export function systemLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.filter((x): x is string => typeof x === "string");
}

/** Whether the user chose a language, rather than following the system's. */
export function hasLocaleOverride(): boolean {
  const override = stored();
  return override !== null && override in CATALOGS;
}

function initial(): string {
  const override = stored();
  if (override !== null && override in CATALOGS) return override;
  return negotiate(systemLanguages());
}

let current = initial();
let plurals = new Intl.PluralRules(current);
const listeners = new Set<() => void>();
const misses = new Set<string>();

function applyToDocument(tag: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = tag;
  const dir = CATALOGS[tag]?.["meta.dir"];
  document.documentElement.dir = dir === "rtl" ? "rtl" : "ltr";
}
applyToDocument(current);

export function getLocale(): string {
  return current;
}

/** Choose a language; `null` returns to the system's. Kept for the next start. */
export function setLocale(tag: string | null): void {
  const next = tag === null ? negotiate(systemLanguages()) : tag in CATALOGS ? tag : SOURCE;
  try {
    if (tag === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* a window without storage chooses again next time */
  }
  if (next === current) return;
  current = next;
  plurals = new Intl.PluralRules(current);
  applyToDocument(current);
  for (const l of listeners) l();
}

/** Re-render on a change of language. */
export function useLocale(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** Keys asked for that no catalog had, English included. A test holds it empty. */
/** Call `listener` whenever the language changes; returns the unsubscribe. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function missing(): readonly string[] {
  return [...misses];
}

function lookup(key: string): Entry | undefined {
  return CATALOGS[current]?.[key] ?? CATALOGS[SOURCE]?.[key];
}

/**
 * Placeholders filled as given: a number is written as it is, because most
 * numbers here are identifiers — `#12345` is a seq, never `#12,345`. A
 * quantity to be read is formatted by the caller with `num()`, and a plural's
 * own `{n}` is formatted by `tn`.
 */
function fill(text: string, params: Params): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name] ?? "") : whole));
}

function format(v: number): string {
  return new Intl.NumberFormat(current).format(v);
}

/** A sentence, its placeholders filled. */
export function t(key: string, params: Params = {}): string {
  const entry = lookup(key);
  if (entry === undefined) {
    misses.add(key);
    return key;
  }
  if (typeof entry !== "string") {
    // A plural asked for without a count: its `other` form.
    return fill(entry.other ?? Object.values(entry)[0] ?? key, params);
  }
  return fill(entry, params);
}

/** A sentence chosen by a count's plural category; `{n}` is the count, formatted. */
export function tn(key: string, n: number, params: Params = {}): string {
  const entry = lookup(key);
  if (entry === undefined) {
    misses.add(key);
    return `${n} ${key}`;
  }
  if (typeof entry === "string") return fill(entry, { n: format(n), ...params });
  const form = entry[plurals.select(n)] ?? entry.other ?? Object.values(entry)[0] ?? key;
  return fill(form, { n: format(n), ...params });
}

/** A number in the chosen language's digits and grouping. */
export function num(n: number): string {
  return format(n);
}

/**
 * The package's or the profile's own words, shown as they wrote them in
 * every language (L-03): a translation of a definition would be a second,
 * different claim. The identity — it marks the text for readers and for
 * the L-02 ratchet, which leaves its argument alone.
 */
export function verbatim(text: string): string {
  return text;
}

/**
 * A sentence with parts that are not text — a `<code>` around a hash, a
 * button — kept whole for the translator: the parts are placeholders like
 * any other, `{head}`, and a language moves them where its grammar puts
 * them. Strings and numbers are written as `t` writes them.
 */
export function tr(key: string, parts: Record<string, ReactNode>): ReactNode {
  const entry = lookup(key);
  if (entry === undefined) {
    misses.add(key);
    return key;
  }
  const text = typeof entry === "string" ? entry : (entry.other ?? Object.values(entry)[0] ?? key);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const name = m[1]!;
    if (!(name in parts)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(parts[name] ?? null);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return createElement(Fragment, null, ...out);
}
