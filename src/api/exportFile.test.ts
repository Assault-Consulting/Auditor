// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { exportNote, type ExportSummary, exportFileName, parseRange, summaryLine } from "./exportFile";

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
    expect(exportNote()).toContain("derived, never authoritative");
    expect(exportNote()).toContain("completeness is not checked");
    expect(exportNote()).toContain("the whole file");
  });
});

group("what the export's summary says, after the save (T3)", () => {
  const summary = (over: Partial<ExportSummary> = {}): ExportSummary => ({
    records: 3,
    consistent: true,
    chain_ok: true,
    well_formed: true,
    body_digest_mismatches: [],
    ...over,
  });

  it("a consistent file is said to be consistent, and completeness to be unchecked", () => {
    const line = summaryLine(summary());
    expect(line.consistent).toBe(true);
    expect(line.text).toContain("consistent");
    expect(line.text).toContain("3 records in the file");
    expect(line.text).toContain("Completeness was not checked");
  });

  it("a body that differs from its digest is named, and the export is kept", () => {
    const line = summaryLine(summary({ consistent: false, body_digest_mismatches: [2] }));
    expect(line.consistent).toBe(false);
    expect(line.text).toContain("not consistent");
    expect(line.text).toContain("record #2 does not match the digest");
    expect(line.text).toContain("saved as it is");
  });

  it("names every reason the summary gives, and counts what it does not list", () => {
    const seqs = Array.from({ length: 12 }, (_, i) => i + 1);
    const line = summaryLine(
      summary({ consistent: false, chain_ok: false, well_formed: false, body_digest_mismatches: seqs }),
    );
    expect(line.text).toContain("does not parse to its end");
    expect(line.text).toContain("12 record bodies");
    expect(line.text).toContain("and 2 more");
    expect(line.text).toContain("header chain does not link");
  });

  it("not consistent with no reason it can name says so rather than inventing one", () => {
    expect(summaryLine(summary({ consistent: false })).text).toContain(
      "for a reason the summary does not name",
    );
  });

  it("a summary that does not say is not read as consistent", () => {
    const line = summaryLine(summary({ consistent: null, records: null }));
    expect(line.consistent).toBeNull();
    expect(line.text).toContain("does not say whether");
  });

  it("one record is one record", () => {
    expect(summaryLine(summary({ records: 1 })).text).toContain("1 record in the file");
  });

  it("accuses no one", () => {
    const line = summaryLine(
      summary({ consistent: false, chain_ok: false, well_formed: false, body_digest_mismatches: [1] }),
    );
    for (const word of ["tamper", "corrupt", "invalid", "altered", "modified", "malicious"]) {
      expect(line.text.toLowerCase()).not.toContain(word);
    }
  });
});
