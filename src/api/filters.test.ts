// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Chips resolved into a `/records` query. The cases worth a test are the
 * two ways a prefix can fail — no match and several — because each would
 * otherwise become a list that answers a different question than the one
 * typed.
 */

import { describe as group, expect, it } from "vitest";

import { filtersKey, resolveChips } from "./filters";

const BOOTS = ["3fa9c0de" + "0".repeat(24), "3fb10000" + "0".repeat(24), "a0000000" + "0".repeat(24)];
const SPANS = ["5eed" + "1".repeat(28)];

group("resolving chips", () => {
  it("passes names straight through — nothing here knows which exist", () => {
    expect(
      resolveChips(
        [
          { key: "type", value: "SAFETY" },
          { key: "kind", value: "OVERSIGHT_ACK" },
          { key: "tier", value: "B" },
        ],
        { boots: BOOTS, spans: SPANS },
      ),
    ).toEqual({
      kind: "resolved",
      filters: { typeName: "SAFETY", kindName: "OVERSIGHT_ACK", tier: "B" },
    });
  });

  it("resolves a unique boot prefix to the full id", () => {
    expect(resolveChips([{ key: "boot", value: "a0" }], { boots: BOOTS, spans: SPANS })).toEqual({
      kind: "resolved",
      filters: { bootId: BOOTS[2] },
    });
  });

  it("resolves a span prefix the same way", () => {
    expect(resolveChips([{ key: "span", value: "5eed" }], { boots: BOOTS, spans: SPANS })).toEqual({
      kind: "resolved",
      filters: { spanId: SPANS[0] },
    });
  });

  it("refuses an ambiguous prefix and says how many it matched", () => {
    const r = resolveChips([{ key: "boot", value: "3f" }], { boots: BOOTS, spans: SPANS });
    expect(r.kind).toBe("refused");
    expect(r.kind === "refused" && r.reason).toContain("matches 2 boots");
  });

  it("refuses a prefix nothing starts with, rather than showing an empty list", () => {
    const r = resolveChips([{ key: "boot", value: "ff" }], { boots: BOOTS, spans: SPANS });
    expect(r.kind === "refused" && r.reason).toBe("no boot in this file starts with ff");
  });

  it("refuses when the list it would resolve against has not loaded", () => {
    const r = resolveChips([{ key: "span", value: "5e" }], { boots: BOOTS, spans: null });
    expect(r.kind === "refused" && r.reason).toContain("span list has not loaded");
  });

  it("resolves nothing to an empty query — the whole file", () => {
    expect(resolveChips([], { boots: BOOTS, spans: SPANS })).toEqual({ kind: "resolved", filters: {} });
  });
});

group("filtersKey", () => {
  it("is equal for equal filters regardless of object identity", () => {
    expect(filtersKey({ kindName: "X" })).toBe(filtersKey({ kindName: "X" }));
  });

  it("differs when the question differs", () => {
    expect(filtersKey({ kindName: "X" })).not.toBe(filtersKey({ typeName: "X" }));
  });
});

group("the source filter (C-12)", () => {
  it("passes the mark's name straight through, like the other names", () => {
    const resolved = resolveChips([{ key: "source", value: "reported-by-client" }], {
      boots: null,
      spans: null,
    });
    expect(resolved).toEqual({ kind: "resolved", filters: { sourceName: "reported-by-client" } });
  });

  it("is part of the question the cursor resets on", () => {
    expect(filtersKey({ sourceName: "reported-by-client" })).not.toBe(filtersKey({}));
    expect(filtersKey({ sourceName: "reported-by-client" })).not.toBe(
      filtersKey({ sourceName: "parsed-from-wire" }),
    );
  });
});
