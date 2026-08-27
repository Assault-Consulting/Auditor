// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Boots and spans as things to read.
 *
 * The subject is §F7's tone instruction: an unclosed span and a recovered
 * tail are evidence, not defects, and the wording has to keep saying so
 * after the person who wrote it has left.
 *
 * The other subject is what this file can and cannot know. A span whose
 * parent is not in this container is not a top-level span, and a span with
 * no start did not begin here.
 *
 * Three claims were weighed by mutation rather than assumed, because every
 * test here passed on its first run and so does a test that checks nothing.
 * Treating an orphan as a root fails three cases; replacing the unclosed
 * wording with "missing its end record" fails two, one on the exact
 * sentence and one on the forbidden-word sweep; and dropping the mid-boot
 * clock flag fails one.
 */

import { describe as group, expect, it } from "vitest";

import { bootRows, spanRows } from "./browse";
import type { BootView, SpanView } from "./generated/types";

function span(over: Partial<SpanView> & { span_id: string }): SpanView {
  return {
    parent_span_id: null,
    start_seq: 0,
    end_seq: 9,
    record_count: 1,
    record_seqs: [0],
    ...over,
  };
}

function boot(over: Partial<BootView> & { boot_id: string }): BootView {
  return {
    first_seq: 0,
    last_seq: 4,
    record_count: 5,
    time_trust_values: [{ value: 1, name: "UNSYNCED" }],
    recovery_seq: null,
    uptime_ns: 1_000,
    anchors: { count: 1, widest_gap_ns: null },
    spans: { closed: 0, open: 0, open_rate: null, median_duration_ns: null },
    ...over,
  };
}

// --- an unclosed span is evidence, and the wording has to keep saying so ----

group("what a span's ends mean", () => {
  it("calls an unclosed span opened and never closed by its owner", () => {
    // §F7's own words. Not "unterminated", not "missing end": an
    // interrupted operation looks exactly like this and the record of it is
    // intact.
    const [row] = spanRows([span({ span_id: "a", end_seq: null })]);

    expect(row!.extent).toBe("unclosed");
    expect(row!.note).toBe("opened, never closed by its owner");
  });

  it("never describes any extent as an error or a failure", () => {
    // The exact-sentence test above and this sweep catch different
    // corruptions: a synonym slips past the sweep, and a neutral but wrong
    // sentence slips past the exact match. Both are needed, and the
    // mutation run confirmed it — "missing its end record" tripped both.
    const rows = spanRows([
      span({ span_id: "a", end_seq: null }),
      span({ span_id: "b", start_seq: null }),
      span({ span_id: "c", start_seq: null, end_seq: null }),
      span({ span_id: "d" }),
    ]);

    for (const row of rows) {
      for (const word of ["error", "fail", "invalid", "corrupt", "missing", "broken"]) {
        expect(row.note.toLowerCase(), row.span_id).not.toContain(word);
      }
    }
  });

  it("keeps a missing start apart from a missing end", () => {
    // Different facts with different causes. A segment holding records
    // 400-900 legitimately contains the middle of a span; a crash
    // legitimately leaves one open. One state for both would make an
    // ordinary segment look interrupted.
    const rows = spanRows([
      span({ span_id: "a", start_seq: null, end_seq: 5 }),
      span({ span_id: "b", start_seq: 5, end_seq: null }),
    ]);

    expect(rows.map((r) => r.extent)).toEqual(["began-earlier", "unclosed"]);
  });

  it("has a state for a span with neither end in this file", () => {
    const [row] = spanRows([span({ span_id: "a", start_seq: null, end_seq: null })]);
    expect(row!.extent).toBe("spans-the-file");
  });
});

// --- what the file cannot say about nesting --------------------------------

group("placement in the nesting", () => {
  it("nests a child under its parent", () => {
    const rows = spanRows([
      span({ span_id: "parent", start_seq: 0 }),
      span({ span_id: "child", parent_span_id: "parent", start_seq: 1 }),
    ]);

    expect(rows.map((r) => [r.span_id, r.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
    ]);
  });

  it("does not call a span with an absent parent a root", () => {
    // The case that has to exist. A span whose parent_span_id names a span
    // not in this file is not top-level — treating it as one would claim
    // the file holds the whole nesting when it holds a slice of it.
    const [row] = spanRows([
      span({ span_id: "orphan", parent_span_id: "elsewhere" }),
    ]);

    expect(row!.placement).toEqual({ kind: "orphan", parent: "elsewhere" });
    expect(row!.placement.kind).not.toBe("root");
  });

  it("names the absent parent so a reader can go and look for it", () => {
    const [row] = spanRows([
      span({ span_id: "orphan", parent_span_id: "elsewhere" }),
    ]);
    expect(row!.placement).toMatchObject({ parent: "elsewhere" });
  });

  it("distinguishes a real root from an orphan", () => {
    const rows = spanRows([
      span({ span_id: "root", start_seq: 0 }),
      span({ span_id: "orphan", parent_span_id: "elsewhere", start_seq: 1 }),
    ]);

    expect(rows.map((r) => r.placement.kind)).toEqual(["root", "orphan"]);
    // Both render at the top level; only one of them IS the top level.
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  it("accounts for every span it was given", () => {
    const spans = [
      span({ span_id: "a", start_seq: 0 }),
      span({ span_id: "b", parent_span_id: "a", start_seq: 1 }),
      span({ span_id: "c", parent_span_id: "b", start_seq: 2 }),
      span({ span_id: "d", parent_span_id: "gone", start_seq: 3 }),
    ];
    expect(spanRows(spans)).toHaveLength(spans.length);
  });

  it("orders a level by where its spans began", () => {
    const rows = spanRows([
      span({ span_id: "late", start_seq: 7 }),
      span({ span_id: "early", start_seq: 2 }),
      // No start at all: it was already open before anything here began.
      span({ span_id: "before", start_seq: null, end_seq: 3 }),
    ]);

    expect(rows.map((r) => r.span_id)).toEqual(["before", "early", "late"]);
  });
});

// --- a boot reports what happened, not what went wrong ----------------------

group("boots", () => {
  it("flags a clock whose trust changed mid-boot", () => {
    // It qualifies every wall-time claim inside the boot: one sentence
    // about when things happened cannot be true of all of it.
    const [row] = bootRows([
      boot({
        boot_id: "a",
        time_trust_values: [
          { value: 1, name: "UNSYNCED" },
          { value: 3, name: "NTP_SYNCED" },
        ],
      }),
    ]);

    expect(row!.clock_changed).toBe(true);
    expect(row!.notes.join(" ")).toContain("UNSYNCED → NTP_SYNCED");
    expect(row!.notes.join(" ")).toContain("no single statement about wall time");
  });

  it("says nothing about the clock when it did not change", () => {
    const [row] = bootRows([boot({ boot_id: "a" })]);
    expect(row!.clock_changed).toBe(false);
    expect(row!.notes).toEqual([]);
  });

  it("reports a recovered tail as something that happened", () => {
    // §F7 calls it "the honest marker of a crash-recovered chain". A chain
    // that recovered and recorded it is behaving better than one that did
    // not, and it is the only reason a crash can be told from a deletion.
    const [row] = bootRows([boot({ boot_id: "a", recovery_seq: 12 })]);

    expect(row!.recovered_at).toBe(12);
    expect(row!.notes.join(" ")).toContain("recovered a truncated tail at record #12");
  });

  it("never describes a boot in the language of faults", () => {
    const rows = bootRows([
      boot({ boot_id: "a", recovery_seq: 3 }),
      boot({
        boot_id: "b",
        time_trust_values: [
          { value: 0, name: "UNKNOWN" },
          { value: 1, name: "UNSYNCED" },
        ],
      }),
    ]);

    for (const row of rows) {
      for (const word of ["error", "fail", "invalid", "corrupt", "broken", "bad"]) {
        expect(row.notes.join(" ").toLowerCase(), row.boot_id).not.toContain(word);
      }
    }
  });

  it("names a trust level this build has no name for rather than inventing one", () => {
    const [row] = bootRows([
      boot({ boot_id: "a", time_trust_values: [{ value: 9, name: null }] }),
    ]);
    expect(row!.clocks).toEqual(["value 9"]);
  });

  it("reports no notes and no recovery for an ordinary boot", () => {
    const [row] = bootRows([boot({ boot_id: "a" })]);
    expect(row!.recovered_at).toBeNull();
    expect(row!.notes).toEqual([]);
  });
});
