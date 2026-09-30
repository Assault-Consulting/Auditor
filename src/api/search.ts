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
 *
 * What it still does not read, and says so rather than ignoring:
 *
 * - Free text over `detail` — `FUNCTIONALITY.md` §22.3's open question.
 *   The data exists since C-07b; the product decision does not.
 * - Date range and time jump (C-09c) — both are about the writer's wall
 *   clock, and belong together.
 */

import type { AdvisoryItemModel } from "./generated/types";

/** The chip keys this build reads. */
export type ChipKey = "kind" | "type" | "tier" | "boot" | "span";

const CHIP_KEYS: readonly ChipKey[] = ["kind", "type", "tier", "boot", "span"];

/** One `key:value` token, normalised. */
export interface Chip {
  key: ChipKey;
  value: string;
}

/** What the bar was asked to do, once parsed. */
export type SearchOutcome =
  | { kind: "seq"; seq: number }
  | { kind: "filters"; chips: Chip[] }
  | { kind: "unsupported"; raw: string; reason: string };

const SEQ_SYNTAX = /^#(\d+)$/;
const CHIP_SYNTAX = /^([a-z]+):(\S+)$/i;
const HEX = /^[0-9a-f]+$/;

const NOT_YET =
  "free text, date range and time jump are not built yet (F10, C-09c/C-09d)";

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
