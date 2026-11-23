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
  /**
   * What report /2 says beyond its verdict (T13): the diagnosis with its code
   * and question, the violation codes, the manifest the verdict also rests
   * on. Read defensively — the format is open, so an unknown key is ignored
   * and a missing one is simply not shown.
   */
  facts: ReportFact[];
  /**
   * The report's own `health` section (E-04, R15), worded per group with the
   * clock it is measured on; null when it was not asked for — never "healthy".
   */
  health: ReportFact[] | null;
  /** The health section's own note, verbatim. */
  healthNote: string | null;
}

export interface ReportFact {
  label: string;
  value: string;
  /** The clock or order the figure is measured on, as the package names it. */
  basis?: string;
}

function checkedAt(report: Record<string, unknown>): { iso: string | null; note: string | null } {
  const c = report.checked_at as { wall_ns?: unknown; note?: unknown } | undefined;
  const ns = typeof c?.wall_ns === "number" ? c.wall_ns : null;
  return {
    iso: ns === null ? null : new Date(ns / 1_000_000).toISOString(),
    note: typeof c?.note === "string" ? c.note : null,
  };
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Obj) : null;
const num = (x: unknown): number | null => (typeof x === "number" ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/** T13: the diagnosis, its code and question; the violation codes; the manifest. */
export function reportFacts(report: Obj): ReportFact[] {
  const facts: ReportFact[] = [];
  const d = obj(report.diagnosis);
  if (d !== null && str(d.pattern) !== null) {
    const at = num(d.at_seq);
    const q = str(d.question);
    facts.push({
      label: "Diagnosis",
      value:
        `${d.pattern}` +
        (str(d.code) !== null ? ` (${d.code})` : "") +
        (at !== null ? ` at #${at}` : "") +
        (q !== null ? ` — about ${q === "completeness" ? "question two, completeness" : "question one, consistency"}` : ""),
    });
  }
  const codes = obj(report.chain)?.violation_codes;
  if (Array.isArray(codes) && codes.length > 0) {
    const pairs = codes
      .filter((c): c is [number, string] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "string")
      .map(([seq, code]) => `#${seq} ${code}`);
    if (pairs.length > 0) facts.push({ label: "Violation codes", value: pairs.join(", ") });
  }
  const m = obj(report.manifest);
  if (m !== null) {
    const sha = str(m.sha256);
    facts.push({
      label: "Segments manifest",
      value:
        `${str(m.filename) ?? "no file to look for"} — ${str(m.status) ?? "status not given"}` +
        (sha !== null ? `, SHA-256 ${sha.slice(0, 16)}…` : ", no file read") +
        (str(m.detail) !== null ? `. ${m.detail}` : ""),
    });
  }
  return facts;
}

const NS_UNITS: [number, string][] = [
  [86400e9, "d"], [3600e9, "h"], [60e9, "min"], [1e9, "s"], [1e6, "ms"], [1e3, "µs"],
];
function dur(ns: number): string {
  for (const [size, unit] of NS_UNITS) {
    if (Math.abs(ns) >= size) {
      const v = ns / size;
      return `${Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`;
    }
  }
  return `${ns} ns`;
}

/** A slope in ppm, signed, one decimal: the package's figure, shown not refit. */
function ppm(v: number): string {
  return `${v < 0 ? "−" : "+"}${Math.round(Math.abs(v) * 10) / 10}`;
}

/**
 * E-04: the report's own health section, said group by group with the
 * clock each names (`basis`). Counts and extremes only; no word of judgement
 * and no threshold drawn — the package draws none and neither does this.
 */
export function reportHealth(report: Obj): ReportFact[] | null {
  const h = obj(report.health);
  if (h === null) return null;
  const facts: ReportFact[] = [];
  const boots = obj(h.boots);
  if (boots !== null) {
    const n = num(boots.count);
    const resumed = num(boots.resumed_after_truncated_tail);
    const trust = num(boots.with_time_trust_change);
    facts.push({
      label: "Boots",
      value:
        `${n ?? "?"}` +
        (resumed ? `, ${resumed} resumed after a cut tail` : "") +
        (trust ? `, ${trust} with a change of clock trust` : ""),
      basis: str(boots.basis) ?? undefined,
    });
  }
  const anchors = obj(h.anchors);
  if (anchors !== null) {
    const gap = num(anchors.widest_gap_ns);
    const without = num(anchors.boots_without_anchor);
    facts.push({
      label: "Anchors",
      value:
        `${num(anchors.count) ?? "?"}` +
        (gap !== null ? `, widest gap ${dur(gap)} (boot starting at #${num(anchors.widest_gap_boot_first_seq) ?? "?"})` : "") +
        (without ? `, ${without} ${without === 1 ? "boot" : "boots"} without one` : ""),
      basis: str(anchors.basis) ?? undefined,
    });
  }
  const wall = obj(h.wall_clock);
  if (wall !== null) {
    const lo = num(wall.drift_slope_ppm_min);
    const hi = num(wall.drift_slope_ppm_max);
    const largest = num(wall.largest_delta_ns);
    facts.push({
      label: "Wall clock",
      value:
        `${num(wall.steps) ?? 0} steps, ${num(wall.regressions) ?? 0} regressions, ${num(wall.slews) ?? 0} slews` +
        (largest !== null ? `, largest ${dur(largest)} at #${num(wall.largest_at_seq) ?? "?"}` : "") +
        (lo !== null && hi !== null
          ? `; drift ${ppm(lo)} to ${ppm(hi)} ppm over ${num(wall.drift_boots_measured) ?? "?"} boots`
          : ""),
      basis: str(wall.basis) ?? undefined,
    });
  }
  const spans = obj(h.spans);
  if (spans !== null) {
    facts.push({
      label: "Spans",
      value: `${num(spans.closed) ?? 0} closed, ${num(spans.open) ?? 0} open`,
      basis: str(spans.basis) ?? undefined,
    });
  }
  return facts;
}

/** The section's own note, verbatim, said over it. */
export function reportHealthNote(report: Obj): string | null {
  return str(obj(report.health)?.note);
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
    facts: reportFacts(response.report),
    health: reportHealth(response.report),
    healthNote: reportHealthNote(response.report),
  };
}
