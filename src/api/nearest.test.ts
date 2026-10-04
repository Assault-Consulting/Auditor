// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * A time jump's answer, as words. Under test: that the clock is always
 * named, and that every qualifier the sidecar sent reaches the reader.
 */

import { describe as group, expect, it } from "vitest";

import type { NearestRecord } from "./generated/types";
import { nearestLine } from "./nearest";

function near(over: Partial<NearestRecord> = {}): NearestRecord {
  return {
    seq: 3,
    wall_clock_ns: 1_786_056_060_000_000_000,
    asked_ns: 1_786_056_060_000_000_000,
    delta_ns: 0,
    basis: "recorded",
    time_trust: { value: 1, name: "UNSYNCED" },
    wall_follows_seq: true,
    boot_clock_stepped: false,
    equally_near: 0,
    ...over,
  };
}

const ASKED = "2026-08-06 22:41Z";

group("the line", () => {
  it("names the record and whose clock decided it", () => {
    const line = nearestLine(near(), ASKED);
    expect(line.seq).toBe(3);
    expect(line.text).toContain("#3");
    expect(line.text).toContain("the writer's clock (UNSYNCED)");
  });

  it("says before or after, by how much", () => {
    expect(nearestLine(near({ delta_ns: -20_000_000_000 }), ASKED).text).toContain("20 s before");
    expect(nearestLine(near({ delta_ns: 125_000_000_000 }), ASKED).text).toContain("2 min 5 s after");
  });

  it("never claims the record happened then", () => {
    const text = nearestLine(near(), ASKED).text.toLowerCase();
    for (const claim of ["happened", "occurred", "proved", "verified"]) {
      expect(text).not.toContain(claim);
    }
  });
});

group("the cautions", () => {
  it("are empty when nothing qualifies the answer", () => {
    expect(nearestLine(near(), ASKED).cautions).toEqual([]);
  });

  it("say when the clock does not follow the chain's order", () => {
    const [c] = nearestLine(near({ wall_follows_seq: false }), ASKED).cautions;
    expect(c).toContain("not a position in the history");
  });

  it("say when the clock stepped in that boot", () => {
    const [c] = nearestLine(near({ boot_clock_stepped: true }), ASKED).cautions;
    expect(c).toContain("stepped");
  });

  it("say how many other records were equally near", () => {
    const [c] = nearestLine(near({ equally_near: 2 }), ASKED).cautions;
    expect(c).toContain("2 other records are equally near");
  });

  it("are all carried together, none dropped", () => {
    const cautions = nearestLine(
      near({ wall_follows_seq: false, boot_clock_stepped: true, equally_near: 1 }),
      ASKED,
    ).cautions;
    expect(cautions).toHaveLength(3);
  });
});
