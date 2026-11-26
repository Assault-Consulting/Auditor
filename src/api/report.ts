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

import { fixedBasis, fixedNote } from "./fixed";
import { t, tn, verbatim } from "../i18n";
import type { ReportResponse } from "./generated/types";
import { span } from "./health";
import { ownEntry } from "./own";

/** The package's own sentence for each verdict (`derive_verdict`). */
export const VERDICT_MEANING: Record<string, string> = {
  sound: verbatim("everything checked, held"),
  empty: verbatim(
    "nothing contradicts anything, because the container holds no records: nothing was checked, and nothing was found intact",
  ),
  partial: verbatim(
    "sound as far as checked, but completeness was NOT checked (no anchor), so truncation or wholesale replacement would not have been detected",
  ),
  violation: verbatim(
    "the chain broke, the container is malformed, a body does not match its header digest, or the head missed a supplied anchor",
  ),
};



export const attestation = (): string => t("report.attestation");

export interface ReportView {
  format: string;
  verdict: string;
  meaning: string;
  unrecognised: boolean;
  /** When the package built the report, by this machine's clock, ISO; null if absent. */
  checkedAtIso: string | null;
  /** The report's own note on that clock, by name when it has one (R19). */
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
  /** The health section's own note, by name when it has one (R19). */
  healthNote: string | null;
}

export interface ReportFact {
  label: string;
  value: string;
  /** The clock or order the figure is measured on, as the package names it. */
  basis?: string;
}

function checkedAt(report: Record<string, unknown>): { iso: string | null; note: string | null } {
  const c = report.checked_at as { wall_ns?: unknown; note?: unknown; note_id?: unknown } | undefined;
  const ns = typeof c?.wall_ns === "number" ? c.wall_ns : null;
  return {
    iso: ns === null ? null : new Date(ns / 1_000_000).toISOString(),
    note: fixedNote(c?.note_id, typeof c?.note === "string" ? c.note : null),
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
      label: t("report.fact.diagnosis"),
      value:
        `${d.pattern}` +
        (str(d.code) !== null ? t("report.fact.code", { code: String(d.code) }) : "") +
        (at !== null ? t("report.fact.at", { seq: at }) : "") +
        (q !== null ? t(q === "completeness" ? "report.fact.about.completeness" : "report.fact.about.consistency") : ""),
    });
  }
  const codes = obj(report.chain)?.violation_codes;
  if (Array.isArray(codes) && codes.length > 0) {
    const pairs = codes
      .filter((c): c is [number, string] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "string")
      .map(([seq, code]) => `#${seq} ${code}`);
    if (pairs.length > 0) facts.push({ label: t("report.fact.codes"), value: pairs.join(", ") });
  }
  const m = obj(report.manifest);
  if (m !== null) {
    const sha = str(m.sha256);
    facts.push({
      label: t("report.fact.manifest"),
      value: t("report.fact.manifest.value", {
        file: str(m.filename) ?? t("report.fact.manifest.no_file"),
        status: str(m.status) ?? t("report.fact.manifest.no_status"),
        sha: sha !== null ? t("report.fact.manifest.sha", { sha: sha.slice(0, 16) }) : t("report.fact.manifest.not_read"),
        // The package's own detail, verbatim (L-03).
        detail: str(m.detail) !== null ? `. ${m.detail}` : "",
      }),
    });
  }
  return facts;
}

const dur = span;

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
      label: t("report.health.boots"),
      value:
        `${n ?? "?"}` +
        (resumed ? t("report.health.resumed", { n: resumed }) : "") +
        (trust ? t("report.health.trust", { n: trust }) : ""),
      basis: fixedBasis(boots.basis_id, str(boots.basis)) ?? undefined,
    });
  }
  const anchors = obj(h.anchors);
  if (anchors !== null) {
    const gap = num(anchors.widest_gap_ns);
    const without = num(anchors.boots_without_anchor);
    facts.push({
      label: t("report.health.anchors"),
      value:
        `${num(anchors.count) ?? "?"}` +
        (gap !== null
          ? t("report.health.gap", { gap: dur(gap), seq: num(anchors.widest_gap_boot_first_seq) ?? "?" })
          : "") +
        (without ? tn("report.health.without", without) : ""),
      basis: fixedBasis(anchors.basis_id, str(anchors.basis)) ?? undefined,
    });
  }
  const wall = obj(h.wall_clock);
  if (wall !== null) {
    const lo = num(wall.drift_slope_ppm_min);
    const hi = num(wall.drift_slope_ppm_max);
    const largest = num(wall.largest_delta_ns);
    facts.push({
      label: t("report.health.wall"),
      value:
        t("report.health.wall.counts", {
          steps: num(wall.steps) ?? 0,
          regressions: num(wall.regressions) ?? 0,
          slews: num(wall.slews) ?? 0,
        }) +
        (largest !== null ? t("report.health.wall.largest", { delta: dur(largest), seq: num(wall.largest_at_seq) ?? "?" }) : "") +
        (lo !== null && hi !== null
          ? t("report.health.wall.drift", { lo: ppm(lo), hi: ppm(hi), boots: num(wall.drift_boots_measured) ?? "?" })
          : ""),
      basis: fixedBasis(wall.basis_id, str(wall.basis)) ?? undefined,
    });
  }
  const spans = obj(h.spans);
  if (spans !== null) {
    facts.push({
      label: t("report.health.spans"),
      value: t("report.health.spans.value", { closed: num(spans.closed) ?? 0, open: num(spans.open) ?? 0 }),
      basis: fixedBasis(spans.basis_id, str(spans.basis)) ?? undefined,
    });
  }
  return facts;
}

/** The section's own note, said over it: by name when it has one (R19). */
export function reportHealthNote(report: Obj): string | null {
  const h = obj(report.health);
  return fixedNote(h?.note_id, str(h?.note));
}

export function reportView(response: ReportResponse): ReportView {
  // Own keys only: `in` would count an inherited name such as `constructor`.
  const meaning = ownEntry(VERDICT_MEANING, response.verdict);
  const known = meaning !== undefined;
  const at = checkedAt(response.report);
  return {
    format: response.format,
    verdict: response.verdict,
    meaning: meaning ?? t("f7.unrecognised"),
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
