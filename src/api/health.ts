// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Record health — E-03, F12. Analytics about the record as an artefact,
 * never about what it describes.
 *
 * F12's three disciplines, kept here because this is where the sentences
 * are made:
 *
 * 1. **Every figure says its time basis.** Counts per boot or per seq ride on
 *    proved order; uptimes and anchor gaps on the writer's monotonic clock,
 *    meaningful only inside one boot; steps and the gaps between boots on the
 *    writer's wall clock, a claim.
 * 2. **Description, never intent.** No threshold is drawn and nothing is
 *    called anomalous, suspicious or healthy (§22.4 leaves thresholds open).
 * 3. **The package detects; this only words and counts.** Every figure comes
 *    from the sidecar's `/record-health`, which copies the package's step
 *    catalog and boot statistics.
 */

import type { RecordHealthView } from "./generated/types";
import { num, t, tn } from "../i18n";
import { count } from "./plural";

/** Said over the panel, always. */
export const healthNote = (): string => t("health.note");

export type Basis = "proved" | "monotonic" | "recorded";

/** Each basis, worded in the chosen language when read. */
export const BASIS_LABEL: Readonly<Record<Basis, string>> = {
  get proved() {
    return t("health.basis.proved");
  },
  get monotonic() {
    return t("health.basis.monotonic");
  },
  get recorded() {
    return t("health.basis.recorded");
  },
};

/** A duration in the largest unit that keeps it readable. Sign kept. */
export function span(ns: number): string {
  const sign = ns < 0 ? "−" : "";
  const a = Math.abs(ns);
  const fmt = (v: number, unit: string) =>
    t("unit.duration", { value: `${sign}${num(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10)}`, unit: t(`unit.${unit}`) });
  if (a < 1e3) return t("unit.duration", { value: `${sign}${num(a)}`, unit: t("unit.ns") });
  if (a < 1e6) return fmt(a / 1e3, "us");
  if (a < 1e9) return fmt(a / 1e6, "ms");
  if (a < 60e9) return fmt(a / 1e9, "s");
  if (a < 3600e9) return fmt(a / 60e9, "min");
  if (a < 86400e9) return fmt(a / 3600e9, "h");
  return fmt(a / 86400e9, "d");
}

const short = (id: string) => id.slice(0, 8);

export interface BootLine {
  boot: string;
  records: string;
  uptime: string;
  clock: string;
  clockChanged: boolean;
  anchors: string;
  spans: string;
  /**
   * Whether the boot's writer marked its open and close (profile r8), worded;
   * null when it did not mark them — before r8 there is nothing to say.
   */
  lifecycle: string | null;
  /** Shown apart: a boot stopped without close is worth a look, never a finding. */
  stopped: boolean;
}

export interface StepLine {
  seq: number;
  boot: string;
  text: string;
}

export interface RecordHealth {
  boots: BootLine[];
  /** Shortest, median and longest uptime across boots, when there is more than one. */
  cadence: string | null;
  steps: StepLine[];
  gaps: string[];
  /** The clock the drift is measured on, then one line per boot with a slope. */
  drift: string[];
  safetyTotal: number;
  kinds: { kind: string; total: number; perBoot: string }[];
  recurring: string[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function stepText(kind: string, delta: number): string {
  switch (kind) {
    case "step":
      return t("health.step.step", { delta: span(delta) });
    case "regression":
      return t("health.step.regression", { delta: span(Math.abs(delta)) });
    case "slew":
      return t("health.step.slew", { delta: span(delta) });
    default:
      // A class this build cannot name: shown as the package gave it.
      return t("health.step.unknown", { kind, delta: span(delta) });
  }
}

type Lifecycle = RecordHealthView["boots"][number]["lifecycle"];

/**
 * T18. The sentence for a boot's open and close. The last boot, open, is the
 * one the chain cannot settle: still being written, or stopped for good.
 */
export function lifecycleText(l: Lifecycle): string | null {
  // The writer's name and version are the package's detail, verbatim (L-03).
  const by = l.writer ? t("health.life.by", { writer: l.writer }) : "";
  const params = { by, open: l.open_seq ?? "?", close: l.close_seq ?? "?" };
  switch (l.state) {
    case "closed":
      return t("health.life.closed", params);
    case "stopped":
      return t("health.life.stopped", params);
    case "last_unclosed":
      return t("health.life.last", params);
    default:
      return null;
  }
}

/**
 * Drift per boot, the package's `drift_series` (channel 5, 0.15). A slope in
 * parts per million of the writer's wall clock against its monotonic one —
 * so the writer's claim, said with its basis. No line is drawn.
 */
function driftLines(h: RecordHealthView): string[] {
  const lines = h.drift
    .filter((d) => d.slope_ppm !== null)
    .map((d) => {
      const ppm = d.slope_ppm!;
      const sign = ppm < 0 ? "−" : "+";
      const v = Math.abs(ppm);
      const shown = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      return t("health.drift.line", {
        boot: short(d.boot_id),
        slope: `${sign}${num(shown)}`,
        records: count(d.points, "record"),
        trust: d.time_trusts.length > 0 ? t("health.drift.trust", { trusts: d.time_trusts.join(" → ") }) : "",
      });
    });
  // The note is the sidecar's, carried as it is (L-03).
  const head = t("health.drift.head", { note: h.drift_note });
  return lines.length === 0 ? [t("health.drift.none", { head })] : [head, ...lines];
}

export function recordHealth(h: RecordHealthView): RecordHealth {
  const boots = h.boots.map((b) => {
    const names = b.time_trust.map((x) => x.name ?? t("health.clock.value", { value: x.value }));
    const anchorPart =
      b.anchors === 0
        ? t("health.anchors.none")
        : b.widest_anchor_gap_ns === null || b.anchors < 2
          ? count(b.anchors, "anchor")
          : t("health.anchors.gap", { anchors: count(b.anchors, "anchor"), gap: span(b.widest_anchor_gap_ns) });
    const spanPart =
      b.spans_closed + b.spans_open === 0
        ? t("health.spans.none")
        : t("health.spans.some", {
            closed: count(b.spans_closed, "span"),
            open: b.spans_open,
            median: b.span_median_ns !== null ? t("health.spans.median", { median: span(b.span_median_ns) }) : "",
          });
    return {
      boot: short(b.boot_id),
      records: t("health.records", {
        records: count(b.records, "record"),
        first: b.first_seq,
        last: b.last_seq,
        recovered: b.recovery_seq !== null ? t("health.records.recovered", { seq: b.recovery_seq }) : "",
      }),
      uptime: b.uptime_ns === null ? t("health.uptime.none") : t("health.uptime", { uptime: span(b.uptime_ns) }),
      clock: names.join(" → ") || t("health.trust.none"),
      clockChanged: names.length > 1,
      anchors: anchorPart,
      spans: spanPart,
      lifecycle: lifecycleText(b.lifecycle),
      stopped: b.lifecycle.state === "stopped",
    };
  });
  const uptimes = h.boots.map((b) => b.uptime_ns).filter((u): u is number => u !== null);
  const cadence =
    uptimes.length > 1
      ? t("health.cadence", {
          boots: count(h.boots.length, "boot"),
          min: span(Math.min(...uptimes)),
          median: span(median(uptimes)),
          max: span(Math.max(...uptimes)),
        })
      : null;
  const steps = h.steps.map((s) => ({ seq: s.seq, boot: short(s.boot_id), text: stepText(s.kind, s.delta_ns) }));
  const gaps = h.wall_gaps.map((g) =>
    g.duration_ns < 0
      ? t("health.gap.negative", { before: short(g.before_boot_id), span: span(-g.duration_ns), after: short(g.after_boot_id) })
      : t("health.gap", { span: span(g.duration_ns), after: short(g.after_boot_id), before: short(g.before_boot_id) }),
  );
  const kinds = h.safety_by_kind.map((k) => ({
    kind: k.kind,
    total: k.total,
    perBoot: k.per_boot.map((b) => `${short(b.boot_id)}: ${b.count}`).join(" · "),
  }));
  const recurring = h.recurring_details.map(
    (d) => tn("health.recurring", d.count, { detail: d.detail, kind: d.kind, seq: d.first_seq }),
  );
  return {
    boots,
    cadence,
    steps,
    gaps,
    drift: driftLines(h),
    safetyTotal: h.safety_total,
    kinds,
    recurring,
  };
}
