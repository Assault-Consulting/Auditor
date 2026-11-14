// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { EXPORT_NOTE, exportFileName, parseRange } from "./exportFile";

group("the record export (D-06)", () => {
  it("offers the chain's own name with .jsonl appended", () => {
    expect(exportFileName("chain.pala")).toBe("chain.pala.jsonl");
    expect(exportFileName("  ")).toBe("export.jsonl");
    expect(exportFileName(null)).toBe("export.jsonl");
  });

  it("reads empty bounds as unbounded", () => {
    expect(parseRange("", "")).toEqual({ kind: "range", fromSeq: null, toSeq: null });
    expect(parseRange(" 3 ", "")).toEqual({ kind: "range", fromSeq: 3, toSeq: null });
    expect(parseRange("", "9")).toEqual({ kind: "range", fromSeq: null, toSeq: 9 });
    expect(parseRange("0", "0")).toEqual({ kind: "range", fromSeq: 0, toSeq: 0 });
  });

  it("refuses what is not a record number, and says which bound", () => {
    for (const [from, to] of [["-1", ""], ["1.5", ""], ["", "x"], ["#3", ""]]) {
      const r = parseRange(from!, to!);
      expect(r.kind).toBe("refused");
    }
    const r = parseRange("", "abc");
    expect(r).toEqual({ kind: "refused", reason: "the last bound is not a record number: abc" });
  });

  it("refuses a range that starts after its end", () => {
    expect(parseRange("9", "3")).toEqual({
      kind: "refused",
      reason: "the range starts at #9, after its end at #3",
    });
  });

  it("refuses a bound past what a number can hold exactly", () => {
    expect(parseRange("9007199254740993", "").kind).toBe("refused");
  });

  it("says what an export is before one is made", () => {
    expect(EXPORT_NOTE).toContain("derived, never authoritative");
    expect(EXPORT_NOTE).toContain("completeness is not checked");
    expect(EXPORT_NOTE).toContain("the whole file");
  });
});
