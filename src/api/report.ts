// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * D-01 — the package's verification report, shown and never rebuilt.
 *
 * `pala-verification-report/2` (palimpsests 0.15; `/1` before) is built by
 * the package's `build_report`, and its verdict by `derive_verdict` — the
 * one verdict rule, which a renderer must not re-derive. This module only
 * names what the package decided: the meaning of each verdict is the
 * package's own (`derive_verdict`'s docstring, 0.15.0), carried rather than
 * paraphrased, and a verdict this
 * build has no words for is shown as it came, with F7's sentence.
 *
 * What the report is, said once and plainly: an attestation that this check
 * was run against this file, with this anchor, at this time on this
 * machine's clock. Not a certification (FUNCTIONALITY.md §1.1, §15).
 */

import type { ReportResponse } from "./generated/types";
import { ownEntry } from "./own";

/** The package's own sentence for each verdict (`derive_verdict`). */
export const VERDICT_MEANING: Record<string, string> = {
  sound: "everything checked, held",
  empty:
    "nothing contradicts anything, because the container holds no records: nothing was checked, and nothing was found intact",
  partial:
    "sound as far as checked, but completeness was NOT checked (no anchor), so truncation or wholesale replacement would not have been detected",
  violation:
    "the chain broke, the container is malformed, a body does not match its header digest, or the head missed a supplied anchor",
};

const UNRECOGNISED = "chain-checked, not interpretable by this verifier version";

export const ATTESTATION =
  "An attestation that this check was run against this file, with this anchor, at this time — not a certification.";

export interface ReportView {
  format: string;
  verdict: string;
  meaning: string;
  unrecognised: boolean;
  /** When the package built the report, by this machine's clock, ISO; null if absent. */
  checkedAtIso: string | null;
  /** The report's own note on that clock, verbatim. */
  checkedAtNote: string | null;
  /** The package's serialisation, the text a copy carries. */
  jsonText: string;
  /**
   * The package's own HTML rendering of the same report (D-01b) — shown for
   * every file since 0.14.1, whose page says of an empty container that
   * nothing was checked (R7).
   */
  htmlText: string;
}

function checkedAt(report: Record<string, unknown>): { iso: string | null; note: string | null } {
  const c = report.checked_at as { wall_ns?: unknown; note?: unknown } | undefined;
  const ns = typeof c?.wall_ns === "number" ? c.wall_ns : null;
  return {
    iso: ns === null ? null : new Date(ns / 1_000_000).toISOString(),
    note: typeof c?.note === "string" ? c.note : null,
  };
}

export function reportView(response: ReportResponse): ReportView {
  // Own keys only: `in` would count an inherited name such as `constructor`.
  const meaning = ownEntry(VERDICT_MEANING, response.verdict);
  const known = meaning !== undefined;
  const at = checkedAt(response.report);
  return {
    format: response.format,
    verdict: response.verdict,
    meaning: meaning ?? UNRECOGNISED,
    unrecognised: !known,
    checkedAtIso: at.iso,
    checkedAtNote: at.note,
    jsonText: response.json_text,
    htmlText: response.html_text,
  };
}
