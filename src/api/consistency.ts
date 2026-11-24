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

import { t } from "../i18n";
import type { ConsistencyCheckView, ConsistencyProofView } from "./generated/types";
import { count } from "./plural";
import { NoShellError } from "./session";

export const consistencyNote = (): string => t("proof.note");

export interface Count {
  kind: "count";
  value: number;
}

/** A count as typed: a whole number from 1 to the records present. */
export function parseCount(text: string, records: number): Count | { kind: "refused"; reason: string } {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return { kind: "refused", reason: t("proof.count.not_number") };
  const n = Number(s);
  if (n < 1) return { kind: "refused", reason: t("proof.count.zero") };
  if (n > records) return { kind: "refused", reason: t("proof.count.too_many", { records: count(records, "record") }) };
  return { kind: "count", value: n };
}

/** The line under a proof just made. */
export function proofLine(v: ConsistencyProofView): string {
  const p = v.proof as { first?: number; second?: number; first_root?: string; second_root?: string; path?: unknown[] };
  return t("proof.made", {
    first: count(p.first ?? 0, "record"),
    second: p.second ?? "?",
    from: String(p.first_root ?? "").slice(0, 16),
    to: String(p.second_root ?? "").slice(0, 16),
    path: count(Array.isArray(p.path) ? p.path.length : 0, "hash"),
    verifies: v.verifies ? t("proof.made.verifies") : t("proof.made.does_not"),
  });
}

export interface CheckAnswer {
  label: string;
  /** true: holds; false: does not; null: this chain cannot say. */
  holds: boolean | null;
  text: string;
}

/** A held proof against this chain: three answers, never folded into one. */
export function checkAnswers(c: ConsistencyCheckView): CheckAnswer[] {
  const root = (which: "first" | "second", holds: boolean | null, n: number): CheckAnswer => {
    const params = { count: count(n, "record"), which: t(`proof.check.${which}`), n, records: count(c.records_here, "record") };
    return {
      label: which === "first" ? t("proof.check.prefix") : t("proof.check.longer"),
      holds,
      text: holds === null ? t("proof.check.cannot", params) : holds ? t("proof.check.holds", params) : t("proof.check.differs", params),
    };
  };
  return [
    {
      label: t("proof.check.path"),
      holds: c.path_verifies,
      text: c.path_verifies ? t("proof.check.path_ok") : t("proof.check.path_bad"),
    },
    root("first", c.first_root_matches ?? null, c.first),
    root("second", c.second_root_matches ?? null, c.second),
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
