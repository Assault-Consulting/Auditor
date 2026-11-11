// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * A table lookup by a name the package supplies, own keys only.
 *
 * Every vocabulary this application words — diagnosis patterns, advisory
 * codes, outcome names, report verdicts — is open: a newer verifier may send
 * a name this build has never seen, and the screen must then say it has no
 * words for it. A plain `table[name]` or `name in table` would instead find
 * an inherited property for a name such as `constructor` or `toString`, and
 * present an unknown name as a known one. Found on the diagnosis card in
 * C-17(b); this is the one lookup every such table uses.
 */
export function ownEntry<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}
