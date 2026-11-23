// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import type { RecordHealthView } from "./generated/types";
import { BASIS_LABEL, HEALTH_NOTE, lifecycleText, recordHealth, span } from "./health";

const BOOT_A = "aaaaaaaa" + "0".repeat(24);
const BOOT_B = "bbbbbbbb" + "0".repeat(24);

function view(over: Partial<RecordHealthView> = {}): RecordHealthView {
  return {
    boots: [
      {
        boot_id: BOOT_A, first_seq: 0, last_seq: 9, records: 10, uptime_ns: 90e9,
        time_trust: [{ value: 1, name: "UNSYNCED" }, { value: 3, name: "NTP_SYNCED" }],
        recovery_seq: null, anchors: 3, anchor_gaps_ns: [10e9, 30e9], widest_anchor_gap_ns: 30e9,
        spans_closed: 2, spans_open: 1, span_open_rate: 1 / 3, span_median_ns: 2e9,
        lifecycle: { state: "stopped", writer: "palimpsests 0.15.0; inference r8", open_seq: 1, close_seq: null },
      },
      {
        boot_id: BOOT_B, first_seq: 10, last_seq: 10, records: 1, uptime_ns: 3600e9,
        time_trust: [{ value: 3, name: "NTP_SYNCED" }], recovery_seq: 10, anchors: 0,
        anchor_gaps_ns: [], widest_anchor_gap_ns: null, spans_closed: 0, spans_open: 0,
        span_open_rate: null, span_median_ns: null,
        lifecycle: { state: "last_unclosed", writer: "palimpsests 0.15.0; inference r8", open_seq: 11, close_seq: null },
      },
    ],
    steps: [
      { seq: 4, boot_id: BOOT_A, kind: "step", delta_ns: 600e9 },
      { seq: 6, boot_id: BOOT_A, kind: "regression", delta_ns: -2e9 },
      { seq: 7, boot_id: BOOT_A, kind: "jitter", delta_ns: 5e8 },
    ],
    wall_gaps: [{ after_boot_id: BOOT_A, before_boot_id: BOOT_B, duration_ns: -120e9 }],
    drift: [
      { boot_id: BOOT_A, slope_ppm: 625.215, points: 9, time_trusts: ["UNSYNCED"] },
      { boot_id: BOOT_B, slope_ppm: null, points: 1, time_trusts: ["NTP_SYNCED"] },
    ],
    drift_note: "the writer's wall clock against its monotonic clock, within one boot — the writer's claim",
    safety_total: 4,
    safety_by_kind: [
      { kind: "GUARD_STATE_REJECT", total: 3, per_boot: [{ boot_id: BOOT_A, count: 3 }] },
      { kind: "INCIDENT_CANDIDATE", total: 1, per_boot: [{ boot_id: BOOT_B, count: 1 }] },
    ],
    recurring_details: [{ detail: "no frame magic", kind: "GUARD_STATE_REJECT", count: 3, first_seq: 2 }],
    ...over,
  };
}

group("record health, in words (E-03, F12)", () => {
  it("prints durations in a readable unit, sign kept", () => {
    expect(span(500)).toBe("500 ns");
    expect(span(1.5e6)).toBe("1.5 ms");
    expect(span(90e9)).toBe("1.5 min");
    expect(span(-120e9)).toBe("−2 min");
    expect(span(3600e9)).toBe("1 h");
    expect(span(3 * 86400e9)).toBe("3 d");
  });

  it("describes each boot with its uptime, clock, anchors and spans", () => {
    const [a, b] = recordHealth(view()).boots;
    expect(a).toMatchObject({
      boot: "aaaaaaaa",
      records: "10 records, #0–#9",
      uptime: "up 1.5 min",
      clock: "UNSYNCED → NTP_SYNCED",
      clockChanged: true,
      spans: "2 spans closed, 1 left open, median 2 s",
    });
    expect(a!.anchors).toBe(
      "3 anchors, at most 30 s apart — an external witness of each would date any record here to within that",
    );
    expect(b).toMatchObject({ records: "1 record, #10–#10, recovered a cut tail at #10", anchors: "no anchor in this boot", spans: "no spans", clockChanged: false });
  });

  it("gives the spread of uptimes across boots, not a judgement of it", () => {
    expect(recordHealth(view()).cadence).toBe("2 boots: shortest up 1.5 min, median 31 min, longest 1 h.");
    expect(recordHealth(view({ boots: view().boots.slice(0, 1) })).cadence).toBeNull();
  });

  it("says what the clock did, by the package's class, and keeps a class it cannot name", () => {
    const steps = recordHealth(view()).steps;
    expect(steps[0]!.text).toBe("the wall clock moved 10 min against the monotonic clock in one record");
    expect(steps[1]!.text).toBe("the wall clock read 2 s earlier than on the record before");
    expect(steps[2]!.text).toBe("jitter, 500 ms");
  });

  it("says a gap between boots that runs backwards as such", () => {
    expect(recordHealth(view()).gaps).toEqual([
      "Boot bbbbbbbb begins 2 min earlier, by the writer's clock, than boot aaaaaaaa ended.",
    ]);
    const forward = recordHealth(view({ wall_gaps: [{ after_boot_id: BOOT_A, before_boot_id: BOOT_B, duration_ns: 3600e9 }] }));
    expect(forward.gaps).toEqual(["1 h between boot aaaaaaaa and boot bbbbbbbb, by the writer's clock."]);
  });

  it("counts warnings by kind and boot and names recurring details", () => {
    const h = recordHealth(view());
    expect(h.kinds).toEqual([
      { kind: "GUARD_STATE_REJECT", total: 3, perBoot: "aaaaaaaa: 3" },
      { kind: "INCIDENT_CANDIDATE", total: 1, perBoot: "bbbbbbbb: 1" },
    ]);
    expect(h.recurring).toEqual(["“no frame magic” — 3 times (GUARD_STATE_REJECT), first at #2"]);
    expect(h.drift).toEqual([
      "Clock drift per boot, the writer's wall clock against its monotonic clock, within one boot — the writer's claim.",
      "Boot aaaaaaaa: +625 ppm over 9 records (UNSYNCED)",
    ]);
  });

  it("names a basis for every block and judges nothing", () => {
    expect(Object.keys(BASIS_LABEL).sort()).toEqual(["monotonic", "proved", "recorded"]);
    const all = [HEALTH_NOTE, ...Object.values(BASIS_LABEL), JSON.stringify(recordHealth(view()))].join(" ");
    expect(all).not.toMatch(/anomal|suspicious|tamper|attack|healthy|unhealthy|threshold|bad clock/i);
    expect(HEALTH_NOTE).toMatch(/does not affect the verdict/);
  });

  it("says which boots their writer closed, and leaves the last one open as it is (T18)", () => {
    const h = recordHealth(view());
    expect(h.boots[0]!.stopped).toBe(true);
    expect(h.boots[0]!.lifecycle).toContain("never closed");
    expect(h.boots[0]!.lifecycle).toContain("the chain is whole");
    expect(h.boots[1]!.stopped).toBe(false);
    expect(h.boots[1]!.lifecycle).toContain("the chain cannot tell which");
    expect(lifecycleText({ state: "closed", writer: "w 1", open_seq: 1, close_seq: 9 })).toBe(
      "opened by w 1 at #1 and closed at #9",
    );
    // Before r8 nothing is marked, and nothing is said.
    expect(lifecycleText({ state: "unmarked", writer: null, open_seq: null, close_seq: null })).toBeNull();
  });
});
