// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * D-01 — the package's verification report, shown and never rebuilt.
 *
 * `pala-verification-report/1` is built by the package's `build_report`, and
 * its verdict by `derive_verdict` — the one verdict rule, which a renderer
 * must not re-derive. This module only names what the package decided: the
 * meaning of each verdict is the package's own (`derive_verdict`'s
 * docstring, 0.13.1), carried rather than paraphrased, and a verdict this
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
  partial:
    "sound as far as checked, but completeness was NOT checked (no anchor), so truncation or wholesale replacement would not have been detected",
  violation:
    "the chain broke, the container is malformed, a body does not match its header digest, or the head missed a supplied anchor",
};

const UNRECOGNISED = "chain-checked, not interpretable by this verifier version";

/**
 * Said in place of the HTML for an empty container on report /1. The
 * package's own page prints the general sentence for `partial` there — a
 * rendering defect fixed upstream for 0.15 (R7, Palimpsests #353) — and this
 * application already keeps that sentence off the JSON block. One sentence,
 * removed with the rest of the report /1 special case.
 */
export const HTML_WITHHELD =
  "The package's HTML page for an empty container is not shown on this version: it prints \"sound as far as checked\" for a file that holds nothing (fixed upstream for 0.15). The JSON above is the same report.";

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
  /** The package's own HTML rendering of the same report (D-01b). */
  htmlText: string;
  /** True when the HTML is not offered — the empty container on report /1. */
  htmlWithheld: boolean;
  /**
   * True when `meaning` is the package's diagnosis narrative rather than the
   * verdict's general sentence — the empty container on report /1; see
   * `emptyContainerNarrative`.
   */
  meaningFromDiagnosis: boolean;
}

/**
 * Report /1 (palimpsests 0.14) only: an empty container read without an
 * anchor gets the verdict `partial`, whose general sentence — "sound as far
 * as checked" — would stand beside a file that holds nothing. The
 * diagnosis's own narrative says what happened (the check passed because
 * there was nothing to check, never that a log was found intact), so it
 * takes that sentence's place; the verdict word is still shown as the
 * package gave it. Branches on `diagnosis.pattern`, never on the verdict's
 * wording. Small on purpose: report /2 (0.15) gives such a file the verdict
 * `empty`, and this goes. Read against an anchor, an empty file is
 * `replaced_or_rolled_back` with the verdict `violation`, and renders as any
 * violation does.
 */
function emptyContainerNarrative(report: Record<string, unknown>): string | null {
  const d = report.diagnosis as { pattern?: unknown; narrative?: unknown } | null | undefined;
  return d?.pattern === "empty_container" && typeof d.narrative === "string" ? d.narrative : null;
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
  const empty = emptyContainerNarrative(response.report);
  const at = checkedAt(response.report);
  return {
    format: response.format,
    verdict: response.verdict,
    meaning: empty ?? meaning ?? UNRECOGNISED,
    unrecognised: !known,
    checkedAtIso: at.iso,
    checkedAtNote: at.note,
    jsonText: response.json_text,
    htmlText: response.html_text,
    htmlWithheld: empty !== null,
    meaningFromDiagnosis: empty !== null,
  };
}
