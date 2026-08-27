// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Boots and spans, as things to read rather than things to judge.
 *
 * §F7 is unusually explicit about tone, and both of its instructions are
 * about refusing to call evidence a defect.
 *
 * **An unclosed span is "opened, never closed by its owner"** — styled as an
 * unclosed bracket, not an error. An interrupted operation looks exactly
 * like this, and the record of it is intact; the log did its job.
 *
 * **`recovery_seq` is "the honest marker of a crash-recovered chain"** — the
 * writer noticed a truncated tail and said so. A chain that recovered and
 * recorded the recovery is behaving better than one that did not.
 *
 * So nothing here produces a severity, and no field is named for a problem.
 */

import type { BootView, SpanView } from "./generated/types";

/**
 * How much of a span this file actually contains.
 *
 * Four states rather than "closed or not", because a missing start and a
 * missing end are different facts with different causes. A segment holding
 * records 400–900 legitimately contains the middle of a span; a crash
 * legitimately leaves one open. Collapsing the two would make a normal
 * segment look interrupted.
 */
export type SpanExtent =
  /** Both ends are here. */
  | "closed"
  /** Opened here and never closed — an interrupted operation, intact. */
  | "unclosed"
  /** Ends here, began before this file. */
  | "began-earlier"
  /** Neither end is here: the span covers everything this file holds. */
  | "spans-the-file";

/**
 * Where a span sits in the nesting, and whether this file can say.
 *
 * `orphan` is the state that has to exist. A span whose `parent_span_id`
 * names a span not present in this file is NOT a root — rendering it as one
 * would claim the file contains the whole nesting when it contains a slice
 * of it. The parent is named so a reader can go and look for it elsewhere.
 */
export type SpanPlacement =
  | { kind: "root" }
  | { kind: "child"; parent: string }
  | { kind: "orphan"; parent: string };

export interface SpanRow {
  span_id: string;
  extent: SpanExtent;
  placement: SpanPlacement;
  start_seq: number | null;
  end_seq: number | null;
  record_count: number;
  /** Depth in the nesting, for indentation. Orphans sit at zero. */
  depth: number;
  /** What to print about the extent — the spec's wording, not a status. */
  note: string;
}

const EXTENT_NOTE: Record<SpanExtent, string> = {
  closed: "opened and closed within this file",
  // The spec's own words. Not "unterminated", not "missing end": an
  // interrupted operation looks exactly like this and the record is intact.
  unclosed: "opened, never closed by its owner",
  "began-earlier": "closed here; it began before this file",
  "spans-the-file": "neither end is in this file",
};

function extentOf(span: SpanView): SpanExtent {
  if (span.start_seq !== null && span.end_seq !== null) return "closed";
  if (span.start_seq !== null) return "unclosed";
  if (span.end_seq !== null) return "began-earlier";
  return "spans-the-file";
}

/**
 * The spans as a tree, flattened depth-first with an explicit depth.
 *
 * Flattened rather than nested because the renderer is a list and the
 * nesting is an indent — and because a nested structure would need a
 * separate answer for what to do with an orphan, which is precisely the
 * case a tree makes awkward and a depth makes plain.
 *
 * Order within a level is by `start_seq`, with spans that have no start
 * first: their beginning is outside this file, so they were open before
 * anything here began.
 */
export function spanRows(spans: SpanView[]): SpanRow[] {
  const present = new Set(spans.map((s) => s.span_id));

  const placementOf = (span: SpanView): SpanPlacement => {
    if (span.parent_span_id === null) return { kind: "root" };
    return present.has(span.parent_span_id)
      ? { kind: "child", parent: span.parent_span_id }
      : { kind: "orphan", parent: span.parent_span_id };
  };

  const childrenOf = new Map<string, SpanView[]>();
  const tops: SpanView[] = [];
  for (const span of spans) {
    const placement = placementOf(span);
    if (placement.kind === "child") {
      const siblings = childrenOf.get(placement.parent) ?? [];
      siblings.push(span);
      childrenOf.set(placement.parent, siblings);
    } else {
      tops.push(span);
    }
  }

  const byStart = (a: SpanView, b: SpanView) =>
    (a.start_seq ?? -1) - (b.start_seq ?? -1);

  const rows: SpanRow[] = [];
  const walk = (span: SpanView, depth: number) => {
    rows.push({
      span_id: span.span_id,
      extent: extentOf(span),
      placement: placementOf(span),
      start_seq: span.start_seq,
      end_seq: span.end_seq,
      record_count: span.record_count,
      depth,
      note: EXTENT_NOTE[extentOf(span)],
    });
    for (const child of (childrenOf.get(span.span_id) ?? []).sort(byStart)) {
      walk(child, depth + 1);
    }
  };
  for (const top of tops.sort(byStart)) walk(top, 0);
  return rows;
}

export interface BootRow {
  boot_id: string;
  first_seq: number;
  last_seq: number;
  record_count: number;
  /**
   * The clock's trust changed partway through this boot.
   *
   * Flagged because it qualifies EVERY wall-time claim inside the boot: one
   * sentence about when things happened cannot be true of all of it. Not an
   * error — the writer recorded the change, which is the behaviour wanted.
   */
  clock_changed: boolean;
  /** Every trust level seen, in the package's names. */
  clocks: string[];
  /**
   * Where this boot recovered a truncated tail, or null.
   *
   * §F7 calls it "the honest marker of a crash-recovered chain". A chain
   * that recovered and said so is behaving better than one that did not, so
   * this is never rendered as a fault.
   */
  recovered_at: number | null;
  /** What to print beside the boot. Facts, in the order they matter. */
  notes: string[];
}

export function bootRows(boots: BootView[]): BootRow[] {
  return boots.map((boot) => {
    const clocks = boot.time_trust_values.map((t) => t.name ?? `value ${t.value}`);
    const notes: string[] = [];
    if (clocks.length > 1) {
      notes.push(
        `the clock's trust changed during this boot (${clocks.join(" → ")}), ` +
          "so no single statement about wall time covers all of it",
      );
    }
    if (boot.recovery_seq !== null) {
      // Stated as what happened, not as what went wrong. The writer found a
      // truncated tail at this record and recorded that it had — which is
      // the behaviour a log is supposed to have, and the only reason anyone
      // can tell a crash from a deletion.
      notes.push(
        `this boot recovered a truncated tail at record #${boot.recovery_seq}`,
      );
    }
    return {
      boot_id: boot.boot_id,
      first_seq: boot.first_seq,
      last_seq: boot.last_seq,
      record_count: boot.record_count,
      clock_changed: clocks.length > 1,
      clocks,
      recovered_at: boot.recovery_seq,
      notes,
    };
  });
}
