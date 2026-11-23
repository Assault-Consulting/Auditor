// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { eventLine, snapshotLine, stateLine } from "./watch";

const ev = (over: Record<string, unknown>) =>
  ({ n: 0, kind: "record", seq: 3, record_kind: "TOOL_CALL", detail: null, at: 0, ...over }) as never;

const state = (over: Record<string, unknown>) =>
  ({
    state: "watching",
    reason: null,
    path: "/x/live.pala",
    records: 12,
    last_seq: 11,
    by_kind: {},
    since: 0,
    max_records: 250000,
    ...over,
  }) as never;

group("the watch, worded (F15)", () => {
  it("says a record verified, with its own detail when it has one", () => {
    expect(eventLine(ev({}))).toEqual({ n: 0, seq: "#3", text: "TOOL_CALL checked", weight: "plain" });
    expect(eventLine(ev({ record_kind: "INCIDENT_CANDIDATE", detail: "guard refusals" })).text).toBe(
      "INCIDENT_CANDIDATE checked — “guard refusals”",
    );
  });

  it("says each tail event the package names, the alarm as its finding", () => {
    expect(eventLine(ev({ kind: "pending_tail", seq: null, record_kind: null })).text).toBe(
      "a record still being written",
    );
    const alarm = eventLine(
      ev({ kind: "diagnosis", seq: null, record_kind: null, detail: "replaced_or_rolled_back: the file shrank" }),
    );
    expect(alarm.weight).toBe("alarm");
    expect(alarm.text).toBe("the verifier's finding: replaced_or_rolled_back: the file shrank");
    expect(eventLine(ev({ kind: "shrunk", record_kind: null })).weight).toBe("notable");
  });

  it("shows a kind this build cannot name as the package gave it", () => {
    expect(eventLine(ev({ kind: "something_newer", detail: "x" })).text).toBe("something_newer: x");
  });

  it("says where the watch stands, and why it stopped", () => {
    expect(stateLine(state({}))).toEqual({ text: "Watching — 12 records checked, last #11.", live: true });
    const limit = stateLine(state({ state: "limit", reason: "stopped at 250,000 records" }));
    expect(limit.live).toBe(false);
    expect(limit.text).toContain("stopped at 250,000 records");
  });

  it("says the snapshot over what was verified so far, and what it does not walk", () => {
    const ok = snapshotLine({
      chain: { chain_ok: true, count: 12, head: "ab".repeat(32) },
      completeness: { complete_to_anchor: null },
      anchor: null,
      anchor_attempts: [],
      diagnosis: null,
    } as never);
    expect(ok.finding).toBe(false);
    expect(ok.text).toContain("Bodies are not walked here");
    const bad = snapshotLine({
      chain: { chain_ok: true, count: 12, head: "ab".repeat(32) },
      completeness: { complete_to_anchor: null },
      anchor: null,
      anchor_attempts: [],
      diagnosis: { pattern: "truncated_tail", narrative: "The file ends inside a record" },
    } as never);
    expect(bad.finding).toBe(true);
    expect(bad.text).toContain("The file ends inside a record");
  });
});
