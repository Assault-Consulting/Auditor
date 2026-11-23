// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { checkAnswers, parseCount, proofFileName, proofLine } from "./consistency";

group("prefix consistency, worded (E-07)", () => {
  it("reads a count, not a seq, from 1 to the records present", () => {
    expect(parseCount("12", 40)).toEqual({ kind: "count", value: 12 });
    expect(parseCount("0", 40).kind).toBe("refused");
    expect(parseCount("41", 40)).toEqual({ kind: "refused", reason: "this chain holds 40 records" });
    expect(parseCount("#3", 40).kind).toBe("refused");
  });

  it("says a proof just made with its roots and its length", () => {
    const line = proofLine({
      proof: { first: 2, second: 9, first_root: "aa".repeat(32), second_root: "bb".repeat(32), path: ["x", "y", "z"] },
      verifies: true,
      records_here: 9,
    });
    expect(line).toBe(
      `The first 2 records are a prefix of the first 9: root ${"aa".repeat(8)}… → ${"bb".repeat(8)}…, a path of 3 hashes, and it verifies.`,
    );
  });

  it("keeps a held proof's three answers apart", () => {
    const [path, first, second] = checkAnswers({
      format: "pala-consistency-proof/1",
      first: 2,
      second: 50,
      path_verifies: true,
      first_root_matches: false,
      second_root_matches: null,
      records_here: 9,
    });
    expect(path!.holds).toBe(true);
    expect(path!.text).toContain("says nothing of where they came from");
    expect(first!.holds).toBe(false);
    expect(first!.text).toContain("not the records the proof was made over");
    expect(second!.holds).toBeNull();
    expect(second!.text).toContain("fewer than 50: it cannot say");
  });

  it("names the file after the chain and the two counts", () => {
    expect(proofFileName("c.pala", 2, 9)).toBe("c.pala.consistency-2-9.json");
  });
});
