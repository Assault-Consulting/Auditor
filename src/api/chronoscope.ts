// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The Chronoscope's view model: a date rail, a fine strip, and a pins row.
 *
 * Pure, like every other view model in this directory, because in this
 * product the wording and the shape of a time display *are* the behaviour.
 * A rail that puts a SAFETY record on the wrong day is not a styling defect.
 *
 * Three things here are decisions rather than mechanics, and each is the
 * kind a renderer would otherwise make by accident.
 *
 * **The rail is always Recorded.** §C-03 presents the date rail and the axis
 * toggle as independent, but they cannot be: dates exist only in the
 * writer's clock. There is no proved-order view of "which day", so the rail
 * carries its watermark permanently rather than only when the toggle is on.
 * The fine strip is the part that follows the toggle.
 *
 * **Days are UTC.** The same container must produce the same rail on every
 * desk. In the reader's local zone two auditors comparing screenshots would
 * disagree about which day a record fell on, and a tool whose claim is
 * reproducibility cannot afford that. A local-time view is a labelled
 * option for later, never the silent one.
 *
 * **The ruler stops inside a gap.** Between boots the writer's clock is
 * unverifiable — the machine was down — so a gap segment carries `ruler:
 * false` and a renderer draws hatching with no scale inside it. Continuing
 * the ruler across a gap would measure a duration nobody observed.
 */

import type { Timeline } from "./generated/types";

export interface DayRow {
  /** ISO date in UTC — the label, and the identity of the row. */
  date: string;
  /** Start of this day, in nanoseconds, for hit-testing against the strip. */
  start_ns: number;
  count: number;
  safety: number;
  anchor: number;
  /** Rendered dim. A day with no records is a fact, not a missing row. */
  empty: boolean;
  /**
   * The writer's clock stepped inside this day.
   *
   * The density bar for such a day is measuring two different clocks, so a
   * renderer marks it rather than drawing it like the others.
   */
  stepped: boolean;
}

/** One stretch of the fine strip. */
export type Segment =
  | {
      kind: "boot";
      boot_id: string;
      first_seq: number;
      last_seq: number;
      from_ns: number;
      to_ns: number;
      /** A ruler applies: this is time the writer was running and recording. */
      ruler: true;
    }
  | {
      kind: "gap";
      after_boot_id: string;
      before_boot_id: string;
      from_ns: number;
      to_ns: number;
      /** Negative when the clock moved backwards across the boundary. */
      duration_ns: number;
      /** No ruler: the clock is unverifiable while the writer is down. */
      ruler: false;
    };

export interface Chronoscope {
  /**
   * Always "recorded" for the rail. Not derived from the axis toggle —
   * see the module docstring.
   */
  basis: "recorded";
  /** What to print beside the rail, e.g. "writer's clock · UNSYNCED". */
  watermark: string;
  /** Every day between the first and the last, empties included. */
  days: DayRow[];
  /**
   * The first and last dates, for the pinned caps.
   *
   * Carried separately so the caps can be shown before any interaction and
   * without the renderer having to reach into the array — which would give
   * an empty rail no caps at all, and an empty rail is exactly when a reader
   * most needs to know the range is empty rather than unloaded.
   */
  first_date: string | null;
  last_date: string | null;
  /** Boots and the gaps between them, in order. */
  segments: Segment[];
  /**
   * External evidence — witness or timestamp-authority pins.
   *
   * Always present and, at tier A, always empty. An absent row would read
   * as "not implemented"; an empty row with its note reads as "this file
   * contains no external witness", which is the true and useful statement.
   */
  pins: never[];
  pins_note: string;
}

/** The UTC date of a nanosecond timestamp, as YYYY-MM-DD. */
function utcDate(ns: number): string {
  return new Date(ns / 1_000_000).toISOString().slice(0, 10);
}

/**
 * Build the rail from a **day-aligned wall** timeline.
 *
 * Throws on anything else rather than coping. A rail built from uniform
 * buckets would label rows with dates the records may not have happened on:
 * a bucket of roughly a day straddles midnight, so a record just after it is
 * counted in one that began the previous day. Accepting that input silently
 * is how the wrong date reaches a report.
 */
export function chronoscope(timeline: Timeline): Chronoscope {
  if (timeline.axis !== "wall" || timeline.align !== "day") {
    throw new Error(
      `the rail needs a day-aligned wall timeline, got axis=${timeline.axis} align=${timeline.align}`,
    );
  }

  const clocks = timeline.time_trust_values.map((t) => t.name ?? `value ${t.value}`);
  const watermark =
    clocks.length === 1
      ? `writer's clock · ${clocks[0]}`
      : `writer's clock · changed mid-chain (${clocks.join(", ")})`;

  const steppedDays = new Set(
    timeline.buckets.filter((b) => b.stepped).map((b) => utcDate(b.start)),
  );

  const days: DayRow[] = timeline.buckets.map((b) => ({
    date: utcDate(b.start),
    start_ns: b.start,
    count: b.count,
    safety: b.safety,
    anchor: b.anchor,
    empty: b.count === 0,
    stepped: steppedDays.has(utcDate(b.start)),
  }));

  // Boots and gaps interleaved, in wall order. The gaps come from the
  // sidecar rather than being computed here: the boundary between two boots
  // is a fact about the chain, and deriving it a second time would give the
  // renderer its own opinion about where a machine was down.
  const segments: Segment[] = [];
  timeline.boot_boundaries.forEach((boot, i) => {
    segments.push({
      kind: "boot",
      boot_id: boot.boot_id,
      first_seq: boot.first_seq,
      last_seq: boot.last_seq,
      from_ns: boot.first_wall_ns,
      to_ns: boot.last_wall_ns,
      ruler: true,
    });
    const gap = timeline.wall_gaps[i];
    if (gap !== undefined) {
      segments.push({
        kind: "gap",
        after_boot_id: gap.after_boot_id,
        before_boot_id: gap.before_boot_id,
        from_ns: gap.from_wall_ns,
        to_ns: gap.to_wall_ns,
        duration_ns: gap.duration_ns,
        ruler: false,
      });
    }
  });

  return {
    basis: "recorded",
    watermark,
    days,
    first_date: days[0]?.date ?? null,
    last_date: days[days.length - 1]?.date ?? null,
    segments,
    pins: [],
    pins_note:
      "No external witness in this file. At tier A there is none to have — " +
      "the absence is a property of the platform, not a gap in the record.",
  };
}

/**
 * How wide a day's density bar should be drawn, as a fraction of the widest.
 *
 * Returned rather than left to the renderer so the scale is shared by the
 * rail and anything else that draws the same numbers. Zero for an empty day:
 * a bar with a visible minimum would make a quiet day look like a busy one
 * at a glance, which is the single thing a density rail must not do.
 */
export function density(days: DayRow[]): number[] {
  const peak = Math.max(0, ...days.map((d) => d.count));
  return days.map((d) => (peak === 0 ? 0 : d.count / peak));
}

/** Whether a gap is one the writer's clock cannot account for. */
export function backwards(segment: Segment): boolean {
  return segment.kind === "gap" && segment.duration_ns < 0;
}
