// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { chipLabel, nextWarning, parseSearch } from "./search";
import type { AdvisoryItemModel } from "./generated/types";

function item(over: Partial<AdvisoryItemModel> = {}): AdvisoryItemModel {
  return { code: "mono_regression_in_boot", at_seq: null, boot_id: null, detail: null, ...over };
}

// --- parsing: exactly #<digits>, nothing guessed at ------------------------

group("what the bar was asked to do", () => {
  it("is nothing, for blank input — not a failed search", () => {
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
  });

  it("is a seq jump for #<digits>", () => {
    expect(parseSearch("#1447")).toEqual({ kind: "seq", seq: 1447 });
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseSearch("  #12  ")).toEqual({ kind: "seq", seq: 12 });
  });

  it("accepts #0 — seq 0 is a real record, not an absent one", () => {
    expect(parseSearch("#0")).toEqual({ kind: "seq", seq: 0 });
  });

  it("is unsupported for a bare number — F10's own syntax keeps the #", () => {
    expect(parseSearch("1447")).toMatchObject({ kind: "unsupported", raw: "1447" });
  });

  it("is unsupported for free text or a time jump, and says which word", () => {
    // Neither is silently ignored: each is a real F10 behaviour this build
    // does not implement yet (see the module doc).
    const free = parseSearch("no frame magic");
    expect(free).toMatchObject({ kind: "unsupported", raw: "no frame magic" });
    expect(free?.kind === "unsupported" && free.reason).toContain('"no"');

    const when = parseSearch("06.08 22:41");
    expect(when).toMatchObject({ kind: "unsupported" });
  });

  it("is unsupported for a negative or fractional seq", () => {
    expect(parseSearch("#-5")).toMatchObject({ kind: "unsupported", raw: "#-5" });
    expect(parseSearch("#1.5")).toMatchObject({ kind: "unsupported", raw: "#1.5" });
  });
});

// --- next warning: strictly after, wrapping, never a dead button ----------

group("the next warning", () => {
  it("is null when there are no items with a location", () => {
    expect(nextWarning([], null)).toBeNull();
    expect(nextWarning([item(), item()], null)).toBeNull();
  });

  it("is the first located item when nothing is currently selected", () => {
    const items = [item({ at_seq: 900 }), item({ at_seq: 12 })];
    expect(nextWarning(items, null)).toBe(12);
  });

  it("is the next item strictly after the current seq", () => {
    const items = [item({ at_seq: 12 }), item({ at_seq: 900 }), item({ at_seq: 44 })];
    expect(nextWarning(items, 12)).toBe(44);
  });

  it("wraps to the first item once past the last one", () => {
    // A button that stopped responding after the final warning would
    // look broken rather than finished.
    const items = [item({ at_seq: 12 }), item({ at_seq: 44 })];
    expect(nextWarning(items, 44)).toBe(12);
  });

  it("skips items with no at_seq — they are not a jump target", () => {
    const items = [item({ at_seq: null }), item({ at_seq: 900 })];
    expect(nextWarning(items, null)).toBe(900);
  });
});

// --- filter chips (C-09b) ---------------------------------------------------

group("filter chips", () => {
  it("reads one chip", () => {
    expect(parseSearch("kind:INCIDENT_CANDIDATE")).toEqual({
      kind: "filters",
      chips: [{ key: "kind", value: "INCIDENT_CANDIDATE" }],
    });
  });

  it("reads several, space-separated, in the order typed", () => {
    expect(parseSearch("type:SAFETY  boot:3FA9")).toEqual({
      kind: "filters",
      chips: [
        { key: "type", value: "SAFETY" },
        { key: "boot", value: "3fa9" },
      ],
    });
  });

  it("upper-cases names — the package's spelling — and lower-cases hex ids", () => {
    expect(parseSearch("Kind:incident_candidate tier:b+ span:ABCD")).toEqual({
      kind: "filters",
      chips: [
        { key: "kind", value: "INCIDENT_CANDIDATE" },
        { key: "tier", value: "B+" },
        { key: "span", value: "abcd" },
      ],
    });
  });

  it("refuses the whole input when one token is not a chip, naming it", () => {
    // Filtering by the chips that parsed and dropping the rest would answer
    // a different question under the typed one's heading.
    const outcome = parseSearch("kind:SAFETY sensor");
    expect(outcome).toMatchObject({ kind: "unsupported" });
    expect(outcome?.kind === "unsupported" && outcome.reason).toContain('"sensor"');
  });

  it("refuses a key this build does not read, and lists the ones it does", () => {
    const outcome = parseSearch("date:2026-08-06");
    expect(outcome?.kind === "unsupported" && outcome.reason).toContain("kind:, type:, tier:, boot:, span:");
  });

  it("refuses the same key twice — the AND would always be empty", () => {
    expect(parseSearch("boot:aa boot:bb")).toMatchObject({ kind: "unsupported" });
  });

  it("refuses a boot or span id that is not hexadecimal", () => {
    expect(parseSearch("boot:xyz")).toMatchObject({ kind: "unsupported" });
  });

  it("still reads #<seq> alone as a jump, not a chip", () => {
    expect(parseSearch("#12")).toEqual({ kind: "seq", seq: 12 });
  });

  it("writes a chip back the way it would be typed", () => {
    expect(chipLabel({ key: "boot", value: "3fa9" })).toBe("boot:3fa9");
  });
});

group("the source chip (C-12)", () => {
  it("lower-cases the value — the package spells the marks that way", () => {
    expect(parseSearch("source:Reported-By-Client")).toEqual({
      kind: "filters",
      chips: [{ key: "source", value: "reported-by-client" }],
    });
  });

  it("composes with the other chips", () => {
    const outcome = parseSearch("kind:TOOL_CALL source:reported-by-client");
    expect(outcome).toEqual({
      kind: "filters",
      chips: [
        { key: "kind", value: "TOOL_CALL" },
        { key: "source", value: "reported-by-client" },
      ],
    });
  });

  it("is named in the list of chips this build reads", () => {
    const outcome = parseSearch("colour:red");
    expect(outcome?.kind).toBe("unsupported");
    if (outcome?.kind === "unsupported") expect(outcome.reason).toContain("source:");
  });
});

// --- time jump and date range (C-09c) ----------------------------------------

group("a time jump", () => {
  it("reads an instant in UTC and carries it as exact nanoseconds", () => {
    expect(parseSearch("@2026-08-06T22:41Z")).toEqual({
      kind: "time",
      ns: "1786056060000000000",
      iso: "2026-08-06T22:41:00.000Z",
    });
  });

  it("reads no zone as UTC — the application's one zone — rather than local", () => {
    const zoned = parseSearch("@2026-08-06T22:41Z");
    const bare = parseSearch("@2026-08-06T22:41");
    expect(bare).toEqual(zoned);
  });

  it("honours an explicit offset", () => {
    const outcome = parseSearch("@2026-08-07T01:41+03:00");
    expect(outcome?.kind === "time" && outcome.ns).toBe("1786056060000000000");
  });

  it("is exact past 2^53 — the nanosecond string is not a rounded number", () => {
    const outcome = parseSearch("@2026-08-06T22:41:07Z");
    expect(outcome?.kind === "time" && outcome.ns).toBe("1786056067000000000");
  });

  it("refuses a day that does not exist rather than rolling it over", () => {
    expect(parseSearch("@2026-02-31T10:00Z")).toMatchObject({ kind: "unsupported" });
  });

  it("refuses a malformed instant and shows the form it wants", () => {
    const outcome = parseSearch("@yesterday");
    expect(outcome?.kind === "unsupported" && outcome.reason).toContain("@2026-08-06T22:41Z");
  });
});

group("date range chips", () => {
  it("reads from: and to: as days, with the other chips", () => {
    expect(parseSearch("from:2026-08-06 to:2026-08-07 kind:INCIDENT_CANDIDATE")).toEqual({
      kind: "filters",
      chips: [
        { key: "from", value: "2026-08-06" },
        { key: "to", value: "2026-08-07" },
        { key: "kind", value: "INCIDENT_CANDIDATE" },
      ],
    });
  });

  it("refuses a date that is not a real UTC day", () => {
    expect(parseSearch("from:2026-13-01")).toMatchObject({ kind: "unsupported" });
    expect(parseSearch("to:06.08.2026")).toMatchObject({ kind: "unsupported" });
  });
});
