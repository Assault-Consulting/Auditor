// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { nextOffset, recordsPage } from "./records";
import type { RecordPage, RecordView } from "./generated/types";

function view(over: Partial<RecordView> = {}): RecordView {
  return {
    seq: 12,
    index: 12,
    record_type: 4,
    type_name: "EVENT",
    kind: null,
    kind_name: null,
    boot_id: "b00t",
    span_id: null,
    parent_span_id: null,
    prev_hash: null,
    record_hash: "cd" + "00".repeat(31),
    prev_seq: null,
    wall_clock_ns: 0,
    monotonic_ns: 42,
    assurance_tier: { value: 2, name: "B" },
    time_trust: { value: 1, name: "UNSYNCED" },
    body_len: 0,
    body_tlv_types: null,
    key_id: null,
    ...over,
  };
}

function page(over: Partial<RecordPage> = {}): RecordPage {
  return { records: [], offset: 0, limit: 200, total: 0, has_more: false, ...over };
}

group("a records page, resolved", () => {
  it("carries each row through recordCard, not a second mapping", () => {
    const resolved = recordsPage(page({ records: [view({ seq: 5 }), view({ seq: 9 })] }));
    expect(resolved.rows.map((r) => r.seq)).toEqual([5, 9]);
  });

  it("carries offset, limit, total and hasMore through unchanged", () => {
    const resolved = recordsPage(page({ offset: 40, limit: 50, total: 900, has_more: true }));
    expect(resolved.offset).toBe(40);
    expect(resolved.limit).toBe(50);
    expect(resolved.total).toBe(900);
    expect(resolved.hasMore).toBe(true);
  });
});

// --- next offset: a seq threshold, never offset + limit -------------------

group("the next page's offset", () => {
  it("is null when there is no more to fetch", () => {
    const resolved = recordsPage(page({ records: [view({ seq: 5 })], has_more: false }));
    expect(nextOffset(resolved)).toBeNull();
  });

  it("is null when hasMore is true but the page carried no rows", () => {
    // Should not happen from the sidecar, but the function must not guess
    // a threshold from a row that is not there.
    const resolved = recordsPage(page({ records: [], has_more: true }));
    expect(nextOffset(resolved)).toBeNull();
  });

  it("is one past the last row's own seq, not offset + limit", () => {
    // The two would agree here (offset 0, limit 3, last seq 2) — the
    // case worth testing is where they would NOT, below.
    const resolved = recordsPage(
      page({
        records: [view({ seq: 0 }), view({ seq: 1 }), view({ seq: 2 })],
        offset: 0,
        limit: 3,
        has_more: true,
      }),
    );
    expect(nextOffset(resolved)).toBe(3);
  });

  it("is correct across a seq gap, where offset + limit would be wrong", () => {
    // A window starting at offset 0 with limit 3, but the chain has a gap
    // and the three rows actually returned are seq 0, 1, 40. offset+limit
    // would say 3 — landing back inside a gap this page already passed.
    const resolved = recordsPage(
      page({
        records: [view({ seq: 0 }), view({ seq: 1 }), view({ seq: 40 })],
        offset: 0,
        limit: 3,
        has_more: true,
      }),
    );
    expect(nextOffset(resolved)).toBe(41);
  });
});
