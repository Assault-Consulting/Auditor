// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * A count with its noun, singular or plural — "1 boot", "2 boots", "0 boots".
 * English only; the `uk` pass (Phase 5) replaces this with the locale's rules.
 */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How the screen names an anchor profile: "none" is no anchor, not a profile called none. */
export function againstLine(profile: string): string {
  return profile === "none" ? "without an anchor" : `against anchor profile "${profile}"`;
}
