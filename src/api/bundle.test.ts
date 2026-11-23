// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { BUNDLE_MAX, bundleFileName, bundleLine, bundleRefusal } from "./bundle";

const facts = {
  format: "pala-bundle/1",
  records: 3,
  proven: 3,
  head: "ab".repeat(32),
  chain_ok: true,
  consistent: true,
  from_seq: 1,
  to_seq: 3,
};

group("the bundle's selection is bounded (E-01)", () => {
  it("lets an open range reach the file's own first and last record", () => {
    expect(bundleRefusal({ kind: "range", fromSeq: null, toSeq: null }, 0, 9)).toBeNull();
    // A segment that starts at #200: its own first record, not #0.
    expect(bundleRefusal({ kind: "range", fromSeq: null, toSeq: 250 }, 200, 300)).toBeNull();
  });

  it("refuses a selection wider than the bound, with the way round", () => {
    const why = bundleRefusal({ kind: "range", fromSeq: null, toSeq: null }, 0, BUNDLE_MAX);
    expect(why).toContain("at most 100,000 records");
    expect(why).toContain("export the records");
    expect(bundleRefusal({ kind: "range", fromSeq: 1, toSeq: BUNDLE_MAX }, 0, 10 ** 6)).toBeNull();
  });

  it("refuses a range outside the file, an empty file, and what the range itself refused", () => {
    expect(bundleRefusal({ kind: "range", fromSeq: 50, toSeq: 60 }, 0, 9)).toContain("outside");
    expect(bundleRefusal({ kind: "range", fromSeq: null, toSeq: null }, null, null)).toContain("no records");
    expect(bundleRefusal({ kind: "refused", reason: "backwards" }, 0, 9)).toBe("backwards");
  });
});

group("what the package said about the bundle", () => {
  it("says every record has its proof when it does", () => {
    expect(bundleLine(facts)).toEqual({
      consistent: true,
      text: `The bundle holds 3 records #1–#3, each with an inclusion proof. Its verification says the file is consistent. Head ${"ab".repeat(8)}….`,
    });
  });

  it("says how many have one, and why the rest do not", () => {
    expect(bundleLine({ ...facts, proven: 1 }).text).toContain("1 of them with an inclusion proof — the others lie outside any proof window");
  });

  it("says when none has a proof, without calling the bundle less", () => {
    expect(bundleLine({ ...facts, proven: 0 }).text).toContain("none with an inclusion proof — the chain carries no proof window over them");
  });

  it("keeps a damaged chain's bundle and says so", () => {
    const line = bundleLine({ ...facts, consistent: false });
    expect(line.consistent).toBe(false);
    expect(line.text).toContain("not consistent — bundled as it is, for inspection");
  });

  it("names the file after the chain and the range", () => {
    expect(bundleFileName("c.pala", { fromSeq: null, toSeq: null })).toBe("c.pala.bundle.tar");
    expect(bundleFileName("c.pala", { fromSeq: 4, toSeq: null })).toBe("c.pala.4-end.bundle.tar");
    expect(bundleFileName("", { fromSeq: 1, toSeq: 2 })).toBe("chain.1-2.bundle.tar");
  });
});
