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
import { count } from "./plural";

/** Said over the panel, always. */
export const HEALTH_NOTE =
  "About the record itself — its clock, its boots, its anchors, its warnings — never about " +
  "what the model did. It describes and draws no line: advisory, and it does not affect the verdict.";

export type Basis = "proved" | "monotonic" | "recorded";

export const BASIS_LABEL: Record<Basis, string> = {
  proved: "proved — counted in chain order",
  monotonic: "the writer's monotonic clock — within one boot only",
  recorded: "recorded — the writer's wall clock, a claim",
};

/** A duration in the largest unit that keeps it readable. Sign kept. */
export function span(ns: number): string {
  const sign = ns < 0 ? "−" : "";
  const a = Math.abs(ns);
  const fmt = (v: number, unit: string) =>
    `${sign}${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`;
  if (a < 1e3) return `${sign}${a} ns`;
  if (a < 1e6) return fmt(a / 1e3, "µs");
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
  drift: string;
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
      return `the wall clock moved ${span(delta)} against the monotonic clock in one record`;
    case "regression":
      return `the wall clock read ${span(Math.abs(delta))} earlier than on the record before`;
    case "slew":
      return `the wall clock drifted ${span(delta)} against the monotonic clock over several records`;
    default:
      // A class this build cannot name: shown as the package gave it.
      return `${kind}, ${span(delta)}`;
  }
}

type Lifecycle = RecordHealthView["boots"][number]["lifecycle"];

/**
 * T18. The sentence for a boot's open and close. The last boot, open, is the
 * one the chain cannot settle: still being written, or stopped for good.
 */
export function lifecycleText(l: Lifecycle): string | null {
  const by = l.writer ? ` by ${l.writer}` : "";
  switch (l.state) {
    case "closed":
      return `opened${by} at #${l.open_seq} and closed at #${l.close_seq}`;
    case "stopped":
      return `opened${by} at #${l.open_seq}, never closed — the process was stopped before the next boot (a crash, a kill, a power cut); advisory, the chain is whole`;
    case "last_unclosed":
      return `opened${by} at #${l.open_seq}, not closed yet — still being written, or stopped for good; the chain cannot tell which`;
    default:
      return null;
  }
}

export function recordHealth(h: RecordHealthView): RecordHealth {
  const boots = h.boots.map((b) => {
    const names = b.time_trust.map((t) => t.name ?? `value ${t.value}`);
    const anchorPart =
      b.anchors === 0
        ? "no anchor in this boot"
        : b.widest_anchor_gap_ns === null || b.anchors < 2
          ? count(b.anchors, "anchor")
          : `${count(b.anchors, "anchor")}, at most ${span(b.widest_anchor_gap_ns)} apart — an external witness of each would date any record here to within that`;
    const spanPart =
      b.spans_closed + b.spans_open === 0
        ? "no spans"
        : `${count(b.spans_closed, "span")} closed, ${b.spans_open} left open` +
          (b.span_median_ns !== null ? `, median ${span(b.span_median_ns)}` : "");
    return {
      boot: short(b.boot_id),
      records: `${count(b.records, "record")}, #${b.first_seq}–#${b.last_seq}` +
        (b.recovery_seq !== null ? `, recovered a cut tail at #${b.recovery_seq}` : ""),
      uptime: b.uptime_ns === null ? "uptime not stated" : `up ${span(b.uptime_ns)}`,
      clock: names.join(" → ") || "no trust level stated",
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
      ? `${count(h.boots.length, "boot")}: shortest up ${span(Math.min(...uptimes))}, median ${span(median(uptimes))}, longest ${span(Math.max(...uptimes))}.`
      : null;
  const steps = h.steps.map((s) => ({ seq: s.seq, boot: short(s.boot_id), text: stepText(s.kind, s.delta_ns) }));
  const gaps = h.wall_gaps.map((g) =>
    g.duration_ns < 0
      ? `Boot ${short(g.before_boot_id)} begins ${span(-g.duration_ns)} earlier, by the writer's clock, than boot ${short(g.after_boot_id)} ended.`
      : `${span(g.duration_ns)} between boot ${short(g.after_boot_id)} and boot ${short(g.before_boot_id)}, by the writer's clock.`,
  );
  const kinds = h.safety_by_kind.map((k) => ({
    kind: k.kind,
    total: k.total,
    perBoot: k.per_boot.map((b) => `${short(b.boot_id)}: ${b.count}`).join(" · "),
  }));
  const recurring = h.recurring_details.map(
    (d) => `“${d.detail}” — ${d.count} times (${d.kind}), first at #${d.first_seq}`,
  );
  return {
    boots,
    cadence,
    steps,
    gaps,
    drift: `Clock drift per boot: ${h.drift_note}.`,
    safetyTotal: h.safety_total,
    kinds,
    recurring,
  };
}
