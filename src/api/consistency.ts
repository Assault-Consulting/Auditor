// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Prefix consistency (E-07): the package's proofs, worded.
 *
 * A proof says the first *n* records of a chain are a prefix of its first
 * *m*: two derived roots — the §4.3 tree over record hashes, computed from
 * headers and added to nothing — and an RFC 6962 path between them. It is
 * derived and unsigned. It proves two roots consistent; it never says where
 * a root came from. So what makes one useful is a root held from elsewhere:
 * an archive's, taken when it was archived. Checked here, a held proof gets
 * three answers, kept apart.
 */

import { invoke } from "@tauri-apps/api/core";

import type { ConsistencyCheckView, ConsistencyProofView } from "./generated/types";
import { count } from "./plural";
import { NoShellError } from "./session";

export const CONSISTENCY_NOTE =
  "Shows that this chain's first records, as they are now, are a prefix of the whole — without the records, from two roots and a handful of hashes. The roots are derived from the headers, and the proof is unsigned: it shows two roots agree, never where a root came from. Keep the proof with the root you took when you archived or handed over a prefix; checked later against the grown chain, it shows whether the prefix is still the same records.";

export interface Count {
  kind: "count";
  value: number;
}

/** A count as typed: a whole number from 1 to the records present. */
export function parseCount(text: string, records: number): Count | { kind: "refused"; reason: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { kind: "refused", reason: "a count of records, a whole number" };
  const n = Number(t);
  if (n < 1) return { kind: "refused", reason: "a prefix holds at least one record" };
  if (n > records) return { kind: "refused", reason: `this chain holds ${count(records, "record")}` };
  return { kind: "count", value: n };
}

/** The line under a proof just made. */
export function proofLine(v: ConsistencyProofView): string {
  const p = v.proof as { first?: number; second?: number; first_root?: string; second_root?: string; path?: unknown[] };
  const path = Array.isArray(p.path) ? p.path.length : 0;
  return (
    `The first ${count(p.first ?? 0, "record")} are a prefix of the first ${p.second ?? "?"}: ` +
    `root ${String(p.first_root ?? "").slice(0, 16)}… → ${String(p.second_root ?? "").slice(0, 16)}…, ` +
    `a path of ${count(path, "hash", "hashes")}` +
    (v.verifies ? ", and it verifies." : " — and it does not verify, which the package should never produce.")
  );
}

export interface CheckAnswer {
  label: string;
  /** true: holds; false: does not; null: this chain cannot say. */
  holds: boolean | null;
  text: string;
}

/** A held proof against this chain: three answers, never folded into one. */
export function checkAnswers(c: ConsistencyCheckView): CheckAnswer[] {
  const root = (which: "first" | "second", holds: boolean | null, n: number): CheckAnswer => ({
    label: which === "first" ? "Prefix root" : "Longer root",
    holds,
    text:
      holds === null
        ? `this chain holds ${count(c.records_here, "record")}, fewer than ${n}: it cannot say`
        : holds
          ? `this chain's root over its first ${count(n, "record")} is the proof's ${which} root`
          : `this chain's root over its first ${count(n, "record")} is not the proof's ${which} root — those ${n} are not the records the proof was made over`,
  });
  return [
    {
      label: "Path",
      holds: c.path_verifies,
      text: c.path_verifies
        ? "the proof's path connects its own two roots — which says nothing of where they came from"
        : "the proof's path does not connect its two roots: it shows nothing",
    },
    root("first", c.first_root_matches, c.first),
    root("second", c.second_root_matches, c.second),
  ];
}

/** `chain.pala` → `chain.pala.consistency-12-40.json`. */
export function proofFileName(filename: string | null | undefined, first: number, second: number): string {
  const name = typeof filename === "string" && filename.trim() !== "" ? filename.trim() : "chain";
  return `${name}.consistency-${first}-${second}.json`;
}

/** Ask the user for a proof file; `null` is a cancelled dialog. */
export async function pickConsistencyProof(): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_consistency_proof");
  } catch {
    throw new NoShellError();
  }
}
