// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * F10 — search and jumps: seq jump and filter chips.
 *
 * F10 specifies "one bar, four behaviours" (free text over `detail`, filter
 * chips, time jump, seq jump) plus three quick buttons (next warning, first
 * record, anchor). What this module reads today:
 *
 * - **Seq jump**, `#1447` (C-09a).
 * - **Filter chips** (C-09b): `kind:`, `type:`, `tier:`, `boot:`, `span:`,
 *   space-separated and ANDed, narrowing C-11's records list. `kind`,
 *   `type` and `tier` are names, upper-cased here because that is how the
 *   package spells them and how the record card shows them; the sidecar
 *   then matches them exactly against the name the package resolved — no
 *   name-to-number table exists on this side. `boot` and `span` are hex
 *   prefixes, because the screen shows eight characters, never sixty-four;
 *   `api/filters.ts` resolves a prefix against the lists already loaded.
 * - `source:` (C-12) — the evidence mark on tool calls and results, by
 *   the package's own name. Lower-cased rather than upper-cased, for the
 *   same reason the others are upper-cased: `reported-by-client` and
 *   `parsed-from-wire` are how the package spells them.
 * - **Date range** (C-09c): `from:YYYY-MM-DD` and `to:YYYY-MM-DD`, whole
 *   UTC days, `to:` inclusive — the same days the date rail draws. A filter
 *   on the writer's clock, so a Recorded bound.
 * - **Time jump** (C-09c): `@2026-08-06T22:41Z`, alone, like `#seq`. An
 *   explicit offset (`+03:00`) is honoured; no zone at all is read as UTC,
 *   the application's one time zone, and the answer says "UTC" so the
 *   reading is never silent.
 *
 * What it still does not read, and says so rather than ignoring:
 *
 * - Free text over `detail` — `FUNCTIONALITY.md` §22.3's open question.
 *   The data exists since C-07b; the product decision does not.
 *
 * Instants are carried as **decimal nanosecond strings**, never numbers:
 * a 2026 instant in nanoseconds is ~1.8e18, past the 2^53 a JavaScript
 * number holds exactly, and a rounded instant would ask the sidecar about
 * a moment nobody typed.
 */

import type { AdvisoryItemModel } from "./generated/types";

/** The chip keys this build reads. */
export type ChipKey = "kind" | "type" | "tier" | "boot" | "span" | "source" | "from" | "to";

const CHIP_KEYS: readonly ChipKey[] = [
  "kind", "type", "tier", "boot", "span", "source", "from", "to",
];

/** One `key:value` token, normalised. */
export interface Chip {
  key: ChipKey;
  value: string;
}

/** What the bar was asked to do, once parsed. */
export type SearchOutcome =
  | { kind: "seq"; seq: number }
  /** A time jump. `ns` is a decimal string — see the module docstring. */
  | { kind: "time"; ns: string; iso: string }
  | { kind: "filters"; chips: Chip[] }
  | { kind: "unsupported"; raw: string; reason: string };

const SEQ_SYNTAX = /^#(\d+)$/;
const CHIP_SYNTAX = /^([a-z]+):(\S+)$/i;
const HEX = /^[0-9a-f]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SYNTAX = /^@(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?$/i;

const NOT_YET = "free text over detail is not built yet (F10, C-09d)";

/** Milliseconds since the epoch as a decimal nanosecond string, exactly. */
export function msToNs(ms: number): string {
  return (BigInt(ms) * 1_000_000n).toString();
}

/** A UTC day as the nanosecond instant of its midnight, or null if invalid. */
export function dayStartNs(day: string, plusDays = 0): string | null {
  if (!DAY.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // Date.parse rolls 2026-02-31 into March; refuse rather than reinterpret.
  if (new Date(ms).toISOString().slice(0, 10) !== day) return null;
  return msToNs(ms + plusDays * 86_400_000);
}

function unsupported(raw: string, reason: string): SearchOutcome {
  return { kind: "unsupported", raw, reason };
}

/**
 * Parse the bar's input against F10's own syntax.
 *
 * `null` for blank input — there is nothing to search for, not a failed
 * search. `#<digits>` alone is a seq jump. Otherwise every space-separated
 * token must be a chip this build reads; the first one that is not makes
 * the whole input `unsupported`, with a reason that names it. Half-applying
 * a query — filtering by the chips that parsed and dropping the word that
 * did not — would show a list that answers a different question from the
 * one typed, under the typed question's heading.
 */
export function parseSearch(raw: string): SearchOutcome | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const seq = SEQ_SYNTAX.exec(trimmed);
  if (seq) return { kind: "seq", seq: Number(seq[1]) };

  if (trimmed.startsWith("@")) {
    const t = TIME_SYNTAX.exec(trimmed);
    if (!t) {
      return unsupported(trimmed, `"${trimmed}" is not a time jump — write @2026-08-06T22:41Z`);
    }
    const day = t[1]!;
    const zone = t[3] === undefined ? "Z" : t[3].toUpperCase();
    const ms = Date.parse(`${day}T${t[2]}${zone}`);
    if (Number.isNaN(ms) || dayStartNs(day) === null) {
      return unsupported(trimmed, `"${trimmed}" is not a real instant`);
    }
    return { kind: "time", ns: msToNs(ms), iso: new Date(ms).toISOString() };
  }

  const chips: Chip[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const match = CHIP_SYNTAX.exec(token);
    if (!match) {
      return unsupported(
        trimmed,
        `"${token}" is not #<seq> or a filter chip — ${NOT_YET}`,
      );
    }
    const key = match[1]!.toLowerCase();
    if (!(CHIP_KEYS as readonly string[]).includes(key)) {
      return unsupported(
        trimmed,
        `"${key}:" is not a chip this build reads — it reads ${CHIP_KEYS.map((k) => `${k}:`).join(", ")}`,
      );
    }
    const chipKey = key as ChipKey;
    if (chips.some((c) => c.key === chipKey)) {
      // Two of the same key would be ANDed into a list that is always
      // empty (a record has one kind, one boot) — refused rather than
      // shown as a result.
      return unsupported(trimmed, `"${key}:" appears twice — one value per chip`);
    }
    let value = match[2]!;
    if (chipKey === "boot" || chipKey === "span") {
      value = value.toLowerCase();
      if (!HEX.test(value)) {
        return unsupported(trimmed, `"${key}:${match[2]}" — a ${key} id is hexadecimal`);
      }
    } else if (chipKey === "source") {
      value = value.toLowerCase();
    } else if (chipKey === "from" || chipKey === "to") {
      if (dayStartNs(value) === null) {
        return unsupported(trimmed, `"${key}:${value}" — a date is YYYY-MM-DD, a real UTC day`);
      }
    } else {
      value = value.toUpperCase();
    }
    chips.push({ key: chipKey, value });
  }
  return { kind: "filters", chips };
}

/** A chip, written back the way a person would type it. */
export function chipLabel(chip: Chip): string {
  return `${chip.key}:${chip.value}`;
}

/**
 * The next advisory item's `seq`, strictly after `afterSeq` — or the
 * first one, if there is no later item or nothing is currently selected.
 *
 * Wraps rather than dead-ending at the last warning: a button that stops
 * responding once a reader has clicked past the final item would look
 * broken rather than finished. Items with no `at_seq` are not jump
 * targets and are skipped, the same reason a diagnosis with no location
 * renders no "at record" line.
 */
export function nextWarning(items: AdvisoryItemModel[], afterSeq: number | null): number | null {
  const seqs = items
    .map((item) => item.at_seq)
    .filter((seq): seq is number => seq !== null)
    .sort((a, b) => a - b);
  if (seqs.length === 0) return null;
  if (afterSeq === null) return seqs[0]!;
  return seqs.find((seq) => seq > afterSeq) ?? seqs[0]!;
}
