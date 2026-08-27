// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The Chronoscope view model.
 *
 * Three things are under test and none is layout: that the rail cannot
 * present a recorded claim as a proved one, that it cannot show a record on
 * a day it may not have happened on, and that folding quiet stretches never
 * hides how much was folded.
 */

import { describe as group, expect, it } from "vitest";

import {
  backwards,
  chronoscope,
  compress,
  compressionLine,
  density,
} from "./chronoscope";
import type { DayRow, RailRow, Segment } from "./chronoscope";
import type { Timeline, TimelineBucket } from "./generated/types";

const DAY = 86_400_000_000_000;
/** 2026-08-17T00:00:00Z, exactly. */
const D0 = Math.floor(1_787_000_000_000_000_000 / DAY) * DAY;

/** Day `n` of the rail, empty unless a record count is given. */
function day(n: number, count = 0): DayRow {
  return {
    date: new Date((D0 + n * DAY) / 1_000_000).toISOString().slice(0, 10),
    start_ns: D0 + n * DAY,
    count,
    safety: 0,
    anchor: 0,
    empty: count === 0,
    stepped: false,
  };
}

/** An outage from the start of one day to the start of another. */
function gap(fromDay: number, toDay: number): Segment {
  return {
    kind: "gap",
    after_boot_id: "aa".repeat(8),
    before_boot_id: "bb".repeat(8),
    from_ns: D0 + fromDay * DAY,
    to_ns: D0 + toDay * DAY,
    duration_ns: (toDay - fromDay) * DAY,
    ruler: false,
  };
}

const marks = (rows: RailRow[]) =>
  rows.filter((r): r is Extract<RailRow, { kind: "collapsed" }> => r.kind === "collapsed");

const only = (rows: RailRow[]) => marks(rows)[0]!;

function bucket(start: number, over: Partial<TimelineBucket> = {}): TimelineBucket {
  return {
    start,
    end: start + DAY - 1,
    count: 0,
    safety: 0,
    anchor: 0,
    stepped: false,
    ...over,
  };
}

function timeline(over: Partial<Timeline> = {}): Timeline {
  return {
    axis: "wall",
    align: "day",
    basis: "recorded",
    buckets: [
      bucket(D0, { count: 3 }),
      bucket(D0 + DAY),
      bucket(D0 + 2 * DAY, { count: 2, safety: 1, anchor: 1 }),
    ],
    start: D0,
    end: D0 + 2 * DAY,
    boot_boundaries: [
      {
        boot_id: "aa".repeat(8),
        first_seq: 0,
        last_seq: 2,
        first_wall_ns: D0,
        last_wall_ns: D0 + 120_000_000_000,
      },
      {
        boot_id: "bb".repeat(8),
        first_seq: 3,
        last_seq: 4,
        first_wall_ns: D0 + 2 * DAY,
        last_wall_ns: D0 + 2 * DAY + 60_000_000_000,
      },
    ],
    wall_gaps: [
      {
        after_boot_id: "aa".repeat(8),
        before_boot_id: "bb".repeat(8),
        from_wall_ns: D0 + 120_000_000_000,
        to_wall_ns: D0 + 2 * DAY,
        duration_ns: 2 * DAY - 120_000_000_000,
      },
    ],
    wall_follows_seq: true,
    time_trust_values: [{ value: 1, name: "UNSYNCED" }],
    steps: [],
    ...over,
  };
}

// --- the rail is recorded, always -------------------------------------------

group("the rail cannot be presented as proved", () => {
  it("is recorded regardless of anything the caller chose", () => {
    // §C-03 lists the date rail and the axis toggle as separate features,
    // but they cannot be independent: dates exist only in the writer's
    // clock. There is no proved-order answer to "which day", so this is
    // fixed rather than derived.
    expect(chronoscope(timeline()).basis).toBe("recorded");
  });

  it("carries a watermark naming whose clock it is", () => {
    expect(chronoscope(timeline()).watermark).toBe("writer's clock · UNSYNCED");
  });

  it("says so when the clock changed status mid-chain", () => {
    // One sentence about this file's timing would not be true of all of it,
    // so the watermark says the status changed rather than picking one.
    const rail = chronoscope(
      timeline({
        time_trust_values: [
          { value: 1, name: "UNSYNCED" },
          { value: 3, name: "NTP_SYNCED" },
        ],
      }),
    );
    expect(rail.watermark).toContain("changed mid-chain");
    expect(rail.watermark).toContain("NTP_SYNCED");
  });
});

// --- a date must be a date the record could have happened on ----------------

group("only a day-aligned wall timeline can build a rail", () => {
  it("refuses uniform buckets", () => {
    // A uniform bucket of roughly a day straddles midnight, so a record
    // just after one is counted in a bucket that began the previous day.
    // Accepting this input is how the wrong date reaches a report.
    expect(() => chronoscope(timeline({ align: null }))).toThrow(/day-aligned/);
  });

  it("refuses the seq axis", () => {
    expect(() =>
      chronoscope(timeline({ axis: "seq", basis: "proved" })),
    ).toThrow(/day-aligned/);
  });

  it("labels each row with the UTC date of its own midnight", () => {
    const days = chronoscope(timeline()).days;
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
  });
});

// --- an empty day is a row -------------------------------------------------

group("a quiet day is shown, not skipped", () => {
  it("keeps the empty row between two populated ones", () => {
    const days = chronoscope(timeline()).days;
    expect(days.map((d) => d.empty)).toEqual([false, true, false]);
  });

  it("gives an empty day no bar at all", () => {
    // Not a visible minimum. A quiet day drawn with a sliver reads as a
    // busy one at a glance, which is the single thing a density rail must
    // not do.
    expect(density(chronoscope(timeline()).days)).toEqual([1, 0, 2 / 3]);
  });

  it("scales a rail with no records at all to zero rather than dividing by it", () => {
    const days = chronoscope(
      timeline({ buckets: [bucket(D0), bucket(D0 + DAY)] }),
    ).days;
    expect(density(days)).toEqual([0, 0]);
  });
});

// --- the caps are available before any interaction --------------------------

group("the pinned caps", () => {
  it("names the first and last dates", () => {
    const rail = chronoscope(timeline());
    expect(rail.first_date).toBe("2026-08-17");
    expect(rail.last_date).toBe("2026-08-19");
  });

  it("reports null caps for an empty rail rather than a missing field", () => {
    // An empty rail is exactly when a reader most needs to know the range
    // is empty rather than not yet loaded.
    const rail = chronoscope(timeline({ buckets: [] }));
    expect(rail.first_date).toBeNull();
    expect(rail.last_date).toBeNull();
  });
});

// --- the ruler stops inside a gap -------------------------------------------

group("boots and the gaps between them", () => {
  it("interleaves them in wall order", () => {
    const kinds = chronoscope(timeline()).segments.map((s) => s.kind);
    expect(kinds).toEqual(["boot", "gap", "boot"]);
  });

  it("marks a gap as carrying no ruler", () => {
    // The clock is unverifiable while the writer is down. Continuing the
    // ruler across a gap would measure a duration nobody observed.
    //
    // Narrowed on `kind` rather than indexed and asserted: the discriminated
    // union is what stops a renderer reading `duration_ns` off a boot, and a
    // test that cast the check away would not be exercising the type that
    // does the work.
    const gap = chronoscope(timeline()).segments.find((s) => s.kind === "gap");
    expect(gap).toBeDefined();
    if (gap?.kind !== "gap") throw new Error("unreachable");
    expect(gap.ruler).toBe(false);
    expect(gap.duration_ns).toBeGreaterThan(0);
  });

  it("marks boot stretches as carrying one", () => {
    const boot = chronoscope(timeline()).segments.find((s) => s.kind === "boot");
    expect(boot?.ruler).toBe(true);
  });

  it("a single-boot chain has no gap segment", () => {
    const rail = chronoscope(
      timeline({ boot_boundaries: [timeline().boot_boundaries[0]!], wall_gaps: [] }),
    );
    expect(rail.segments.map((s) => s.kind)).toEqual(["boot"]);
  });

  it("recognises a gap the writer's clock cannot account for", () => {
    // A negative gap means the clock went backwards across the boundary.
    // The instinct is to clamp it to zero, which erases the only evidence
    // it happened — so the model exposes the case by name.
    const rail = chronoscope(
      timeline({
        wall_gaps: [{ ...timeline().wall_gaps[0]!, duration_ns: -5_000_000_000 }],
      }),
    );
    const gap = rail.segments.find((s) => s.kind === "gap");
    const boot = rail.segments.find((s) => s.kind === "boot");
    expect(gap && backwards(gap)).toBe(true);
    expect(boot && backwards(boot)).toBe(false);
  });
});

// --- a stepped day is not a comparable day ----------------------------------

group("clock steps", () => {
  it("marks the day a step fell in", () => {
    const rail = chronoscope(
      timeline({
        buckets: [
          bucket(D0, { count: 3 }),
          bucket(D0 + DAY),
          bucket(D0 + 2 * DAY, { count: 2, stepped: true }),
        ],
      }),
    );
    expect(rail.days.map((d) => d.stepped)).toEqual([false, false, true]);
  });
});

// --- the pins row is empty and says why -------------------------------------

group("external evidence", () => {
  it("is present and empty at tier A", () => {
    // An absent row reads as "not implemented". An empty row with its note
    // reads as "this file contains no external witness", which is the true
    // and useful statement.
    const rail = chronoscope(timeline());
    expect(rail.pins).toEqual([]);
    expect(rail.pins_note).toContain("No external witness");
    expect(rail.pins_note).toContain("property of the platform");
  });
});

// --- the accordion, and the sentence that governs it ------------------------

group("compressing empty stretches", () => {
  it("never drops a populated day", () => {
    const rows = compress([day(0, 3), day(1), day(2), day(3), day(4, 2)], []);
    const kept = rows.filter((r) => r.kind === "day");
    expect(kept).toHaveLength(2);
  });

  it("states its own extent rather than hiding it", () => {
    // "Never silent compression." A mark that only shortened the rail would
    // draw a busy chain out of an idle one — the same failure as omitting
    // empty buckets, one level up and easier to justify because at rail
    // scale it looks like tidiness.
    const rows = compress([day(0, 1), day(1), day(2), day(3), day(4, 1)], []);
    const [mark] = marks(rows);

    expect(mark).toBeDefined();
    expect(mark!.days).toBe(3);
    expect(mark!.from).toBe(day(1).date);
    expect(mark!.to).toBe(day(3).date);
  });

  it("leaves a short run alone", () => {
    // Below the threshold a mark costs as many rows as it saves, and a rail
    // full of marks standing in for two days each is harder to read than the
    // days were.
    const rows = compress([day(0, 1), day(1), day(2), day(3, 1)], []);
    expect(marks(rows)).toHaveLength(0);
    expect(rows).toHaveLength(4);
  });

  it("accounts for every day it was given", () => {
    const days = [day(0, 2), day(1), day(2), day(3), day(4), day(5, 1)];
    const rows = compress(days, []);
    const counted = rows.reduce(
      (n, r) => n + (r.kind === "day" ? 1 : r.days),
      0,
    );
    expect(counted).toBe(days.length);
  });

  it("collapses a run that ends the rail", () => {
    const rows = compress([day(0, 1), day(1), day(2), day(3)], []);
    expect(marks(rows)).toHaveLength(1);
    expect(marks(rows)[0]!.days).toBe(3);
  });
});

// --- an empty day and a day the machine was off are different facts ---------

group("what a mark says about why the days were empty", () => {
  it("says nothing about being down when no gap covers the run", () => {
    // Emptiness is the absence of records. Whether the machine was off is a
    // different claim, and one this rail can only make from the gaps the
    // sidecar reports.
    const rows = compress([day(0, 1), day(1), day(2), day(3), day(4, 1)], []);
    expect(only(rows).down).toBe("none");
    expect(compressionLine(only(rows))).not.toContain("down");
  });

  it("says the writer was down for all of them when the gap covers the run", () => {
    const rows = compress(
      [day(0, 1), day(1), day(2), day(3), day(4, 1)],
      [gap(1, 4)],
    );
    expect(only(rows).down).toBe("all");
    expect(compressionLine(only(rows))).toContain("down for all of them");
  });

  it("distinguishes a partial outage from a total one", () => {
    // Three quiet days of which the machine was off for one is not the same
    // statement as three days it was off throughout, and a mark that said
    // "down" for both would flatten them.
    const rows = compress(
      [day(0, 1), day(1), day(2), day(3), day(4, 1)],
      [gap(1, 2)],
    );
    expect(only(rows).down).toBe("some");
    expect(compressionLine(only(rows))).toContain("part of them");
  });

  it("counts a day the writer came back partway through as a day it was down", () => {
    // A machine that returned at noon was down that day, and calling the day
    // up because it ended up would lose the fact.
    //
    // This test failed on its first run and the code was right: `gap(1, 3)`
    // ends at midnight starting day three, which means the writer was up for
    // the whole of day three. The fixture said something other than what the
    // comment above it meant, so the gap now ends at noon and the sentence
    // and the arithmetic agree.
    const noonOfDayThree: Segment = {
      ...gap(1, 3),
      to_ns: D0 + 3 * DAY + DAY / 2,
    };
    const rows = compress(
      [day(0, 1), day(1), day(2), day(3), day(4, 1)],
      [noonOfDayThree],
    );
    expect(only(rows).down).toBe("all");
  });

  it("leaves a day out of the outage when the writer was back before it began", () => {
    // The counterpart, and the reason the one above is not a tautology: a
    // gap ending exactly at midnight leaves that day entirely up.
    const rows = compress(
      [day(0, 1), day(1), day(2), day(3), day(4, 1)],
      [gap(1, 3)],
    );
    expect(only(rows).down).toBe("some");
  });

  it("always names how many days and which", () => {
    const line = compressionLine(only(compress([day(0, 1), day(1), day(2), day(3)], [])));
    expect(line).toContain("3 days with no records");
    expect(line).toContain(day(1).date);
    expect(line).toContain(day(3).date);
  });
});
