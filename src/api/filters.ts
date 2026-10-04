// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Filter chips resolved into the query `/records` understands (C-09b).
 *
 * Dates become writer's-clock bounds (C-09c): `from:` the UTC midnight
 * starting that day, `to:` the midnight after the day named, exclusive.
 *
 * Names pass straight through: `kind:`, `type:`, `tier:` and `source:`
 * become `kind_name`, `type_name`, `tier` and `source_name` (C-12), and the
 * sidecar matches them against the names the package resolved. Nothing
 * here knows which names exist.
 *
 * Ids do not pass straight through. The screen shows a boot or span as its
 * first eight hex characters, so that is what a person types, and the
 * sidecar matches a boot id exactly. The prefix is resolved against the
 * boot and span lists this session has already loaded — and the two ways
 * that can go wrong are said, not silently turned into an empty list:
 *
 * - **no match**: "no boot in this file starts with …" is a different fact
 *   from "that boot has no records matching the other chips";
 * - **several matches**: an ambiguous prefix picking the first would filter
 *   by a boot the reader did not mean, under a heading that says they did.
 */

import { dayStartNs, type Chip } from "./search";

/** The query `getRecords` sends, from chips. */
export interface RecordFilters {
  typeName?: string;
  kindName?: string;
  tier?: string;
  sourceName?: string;
  /** Writer's-clock bounds, decimal ns strings: from inclusive, to exclusive. */
  wallFromNs?: string;
  wallToNs?: string;
  bootId?: string;
  spanId?: string;
}

export type Resolution =
  | { kind: "resolved"; filters: RecordFilters }
  | { kind: "refused"; reason: string };

/** Ids this session knows, or null when that list has not loaded. */
export interface KnownIds {
  boots: string[] | null;
  spans: string[] | null;
}

function resolvePrefix(
  noun: "boot" | "span",
  prefix: string,
  known: string[] | null,
): { id: string } | { reason: string } {
  if (known === null) {
    return { reason: `the ${noun} list has not loaded, so "${noun}:${prefix}" cannot be resolved` };
  }
  const matches = known.filter((id) => id.startsWith(prefix));
  if (matches.length === 0) {
    return { reason: `no ${noun} in this file starts with ${prefix}` };
  }
  if (matches.length > 1) {
    return {
      reason: `${prefix} matches ${matches.length} ${noun}s in this file — type more of it`,
    };
  }
  return { id: matches[0]! };
}

export function resolveChips(chips: Chip[], known: KnownIds): Resolution {
  const filters: RecordFilters = {};
  for (const chip of chips) {
    switch (chip.key) {
      case "type":
        filters.typeName = chip.value;
        break;
      case "kind":
        filters.kindName = chip.value;
        break;
      case "tier":
        filters.tier = chip.value;
        break;
      case "source":
        filters.sourceName = chip.value;
        break;
      // Whole UTC days, matching the rail. `to:` names the last day kept,
      // so the exclusive bound is the midnight after it.
      case "from":
        filters.wallFromNs = dayStartNs(chip.value) ?? undefined;
        break;
      case "to":
        filters.wallToNs = dayStartNs(chip.value, 1) ?? undefined;
        break;
      case "boot":
      case "span": {
        const found = resolvePrefix(chip.key, chip.value, chip.key === "boot" ? known.boots : known.spans);
        if ("reason" in found) return { kind: "refused", reason: found.reason };
        if (chip.key === "boot") filters.bootId = found.id;
        else filters.spanId = found.id;
        break;
      }
    }
  }
  if (
    filters.wallFromNs !== undefined &&
    filters.wallToNs !== undefined &&
    BigInt(filters.wallFromNs) >= BigInt(filters.wallToNs)
  ) {
    // An empty range is a mistyped question, not an answer about the file.
    return { kind: "refused", reason: "from: is after to: — the range holds no day" };
  }
  return { kind: "resolved", filters };
}

/**
 * A stable key for a filter set, so a page cursor can be reset whenever
 * the question changes. Offsets are seq thresholds within one question's
 * matches; carried over to a different question they point into the
 * middle of an unrelated list.
 */
export function filtersKey(filters: RecordFilters): string {
  return JSON.stringify([
    filters.typeName ?? null,
    filters.kindName ?? null,
    filters.tier ?? null,
    filters.sourceName ?? null,
    filters.wallFromNs ?? null,
    filters.wallToNs ?? null,
    filters.bootId ?? null,
    filters.spanId ?? null,
  ]);
}
