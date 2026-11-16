// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import type { WitnessCheckView } from "./generated/types";
import { WITNESS_LIMITS, witnessLine, witnessRows, witnessStatus } from "./witness";

function view(over: Partial<WitnessCheckView> = {}): WitnessCheckView {
  return {
    path: "/home/u/.local/share/palimpsests-auditor/witness.jsonl",
    format: "auditor-witness/1",
    entries: 3,
    head: "a".repeat(64),
    broken_at: null,
    reason: null,
    tail: [],
    ...over,
  };
}

group("the witness log, as the screen says it (E-05)", () => {
  it("names the entry a check went in as", () => {
    expect(witnessLine({ n: 12, hash: "h", error: null })).toEqual({
      text: "Written to this desk's witness log as entry 12.",
      failed: false,
    });
  });

  it("says when a check was not written, and why — never silent", () => {
    const line = witnessLine({ n: null, hash: null, error: "the witness log does not link at line 4" })!;
    expect(line.failed).toBe(true);
    expect(line.text).toMatch(/^Not written to the witness log: .*line 4/);
    expect(witnessLine(null)).toBeNull();
    expect(witnessLine(undefined)).toBeNull();
  });

  it("says how many entries link, and when there are none", () => {
    expect(witnessStatus(view()).text).toBe("3 entries link, each to the one before it.");
    expect(witnessStatus(view({ entries: 1 })).text).toBe("1 entry links, each to the one before it.");
    expect(witnessStatus(view({ entries: 0, head: null })).text).toBe("The witness log has no entries yet.");
  });

  it("names the first line that does not link, what is wrong there, and nothing about why", () => {
    const s = witnessStatus(
      view({ entries: 2, head: null, broken_at: 3, reason: "the entry does not match its own digest" }),
    );
    expect(s.failed).toBe(true);
    expect(s.text).toBe(
      "The witness log does not link at line 3: the entry does not match its own digest. " +
        "The first 2 entries link; nothing is added to it until it does.",
    );
    expect(s.text).not.toMatch(/tamper|forg|attack|malic/i);
    expect(witnessStatus(view({ entries: 0, broken_at: 1, reason: "x", head: null })).text).toMatch(/No entry links/);
    expect(witnessStatus(view({ entries: 1, broken_at: 2, reason: "x", head: null })).text).toMatch(/The first entry links/);
  });

  it("lists the last entries newest first, with the clock labelled a claim by the table", () => {
    const rows = witnessRows([
      { n: 0, hash: "x", checked_at_wall_ns: 1_794_000_000_000_000_000, subject: { name: "a.pala" }, head: "b".repeat(64), profile: "none", anchor: null, complete_to_anchor: null },
      { n: 1, hash: "y", checked_at_wall_ns: null, subject: { name: "b.pala" }, head: "c".repeat(64), profile: "desk", anchor: { source_kind: "file" }, complete_to_anchor: false },
      { n: 2, hash: "z", subject: null, head: null, profile: "desk", anchor: null, complete_to_anchor: null },
    ]);
    expect(rows.map((r) => r.n)).toEqual([2, 1, 0]);
    expect(rows[2]).toEqual({ n: 0, when: "2026-11-06T21:20:00Z", file: "a.pala", head: "bbbbbbbb…bbbbbbbb", against: "no anchor" });
    expect(rows[1]!.against).toBe("file — not complete");
    expect(rows[1]!.when).toBe("—");
    expect(rows[0]).toEqual({ n: 2, when: "—", file: "—", head: "—", against: "desk — no source answered" });
  });

  it("says what the log does not show in the same breath as what it does", () => {
    expect(WITNESS_LIMITS).toMatch(/this desk saw this head/);
    expect(WITNESS_LIMITS).toMatch(/nothing about the world/);
    expect(WITNESS_LIMITS).toMatch(/cut at its end still links/);
    expect(WITNESS_LIMITS).toMatch(/write a new one/);
  });
});
