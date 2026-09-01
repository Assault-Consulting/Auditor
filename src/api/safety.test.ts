// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { safetyGroupKey, safetyGroups } from "./safety";
import type { RecordView } from "./generated/types";

function view(over: Partial<RecordView> = {}): RecordView {
  return {
    seq: 0,
    index: 0,
    record_type: 64,
    type_name: "SAFETY",
    kind: null,
    kind_name: null,
    boot_id: "b00t",
    span_id: null,
    parent_span_id: null,
    prev_hash: null,
    wall_clock_ns: 0,
    monotonic_ns: 0,
    assurance_tier: { value: 2, name: "B" },
    time_trust: { value: 1, name: "UNSYNCED" },
    body_len: 0,
    body_tlv_types: null,
    key_id: null,
    ...over,
  };
}

group("SAFETY grouped by kind", () => {
  it("is empty for no records", () => {
    expect(safetyGroups([])).toEqual([]);
  });

  it("puts records of the same kind in one group, in seq order", () => {
    const groups = safetyGroups([
      view({ seq: 9, kind: 102, kind_name: "INCIDENT_CANDIDATE" }),
      view({ seq: 3, kind: 102, kind_name: "INCIDENT_CANDIDATE" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.records.map((r) => r.seq)).toEqual([3, 9]);
  });

  it("orders groups by their earliest member, not by kind number", () => {
    // OVERSIGHT_ACK (103) at seq 1 comes first even though its kind
    // number is higher than INCIDENT_CANDIDATE's (102) at seq 5.
    const groups = safetyGroups([
      view({ seq: 5, kind: 102, kind_name: "INCIDENT_CANDIDATE" }),
      view({ seq: 1, kind: 103, kind_name: "OVERSIGHT_ACK" }),
    ]);
    const names = groups.map((g) =>
      g.kindLabel.has && g.kindLabel.named ? g.kindLabel.name : null,
    );
    expect(names).toEqual(["OVERSIGHT_ACK", "INCIDENT_CANDIDATE"]);
  });

  it("keeps a kind this build cannot name apart from one it can, even at the same raw number coincidence", () => {
    const groups = safetyGroups([
      view({ seq: 1, kind: 200, kind_name: null }),
      view({ seq: 2, kind: 201, kind_name: null }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("groups a record with no kind at all separately from any named kind", () => {
    // A SAFETY body this build cannot decode at all — kind and
    // kind_name both null — is not the same fact as "no kind exists"
    // for a type that never carries one, but the grouping key for
    // `{has: false}` covers exactly that shape regardless of cause.
    const groups = safetyGroups([
      view({ seq: 1, kind: null, kind_name: null }),
      view({ seq: 2, kind: 102, kind_name: "INCIDENT_CANDIDATE" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kindLabel).toEqual({ has: false });
  });
});

group("safetyGroupKey", () => {
  it("is distinct for absent, unnamed and named kinds", () => {
    const keys = new Set([
      safetyGroupKey({ has: false }),
      safetyGroupKey({ has: true, named: false, raw: 200 }),
      safetyGroupKey({ has: true, named: true, name: "INCIDENT_CANDIDATE" }),
    ]);
    expect(keys.size).toBe(3);
  });

  it("is the same key for the same raw kind number", () => {
    expect(safetyGroupKey({ has: true, named: false, raw: 200 })).toBe(
      safetyGroupKey({ has: true, named: false, raw: 200 }),
    );
  });
});
