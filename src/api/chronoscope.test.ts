// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The Chronoscope view model.
 *
 * Two things are under test and neither is layout: that the rail cannot
 * present a recorded claim as a proved one, and that it cannot show a
 * record on a day it may not have happened on.
 */

import { describe as group, expect, it } from "vitest";

import { backwards, chronoscope, density } from "./chronoscope";
import type { Timeline, TimelineBucket } from "./generated/types";

const DAY = 86_400_000_000_000;
/** 2026-08-17T00:00:00Z, exactly. */
const D0 = Math.floor(1_787_000_000_000_000_000 / DAY) * DAY;

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
