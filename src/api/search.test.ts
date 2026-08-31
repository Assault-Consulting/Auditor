// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { nextWarning, parseSearch } from "./search";
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
    expect(parseSearch("1447")).toEqual({ kind: "unsupported", raw: "1447" });
  });

  it("is unsupported for a filter chip, free text or a time jump", () => {
    // None of these are silently ignored: each is a real F10 behaviour
    // this slice does not implement yet (see the module doc).
    expect(parseSearch("kind:SAFETY")).toEqual({ kind: "unsupported", raw: "kind:SAFETY" });
    expect(parseSearch("no frame magic")).toEqual({
      kind: "unsupported",
      raw: "no frame magic",
    });
    expect(parseSearch("06.08 22:41")).toEqual({
      kind: "unsupported",
      raw: "06.08 22:41",
    });
  });

  it("is unsupported for a negative or fractional seq", () => {
    expect(parseSearch("#-5")).toEqual({ kind: "unsupported", raw: "#-5" });
    expect(parseSearch("#1.5")).toEqual({ kind: "unsupported", raw: "#1.5" });
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
