// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * C-13 — the line that names the second file a verdict rests on.
 *
 * Every status gets a sentence that says what was compared and nothing
 * more; the digest and the package's reason are carried, not rephrased;
 * and a status this build does not know is shown as such, not guessed.
 */

import { describe as group, expect, it } from "vitest";

import { manifestLine } from "./manifest";
import type { ManifestReadingModel } from "./generated/types";

const PATH = "/logs/w.pala.segments.json";
const DIGEST = "ab".repeat(32);

function reading(over: Partial<ManifestReadingModel> = {}): ManifestReadingModel {
  return { path: PATH, status: "matches", sha256: DIGEST, detail: null, ...over };
}

group("no second file", () => {
  it("is no line at all", () => {
    expect(manifestLine(null)).toBeNull();
    expect(manifestLine(undefined)).toBeNull();
  });
});

group("each status says what was compared", () => {
  it("matches: the same predecessor, and nothing about the records", () => {
    const line = manifestLine(reading());
    expect(line?.text).toContain(PATH);
    expect(line?.text).toContain("names the same predecessor");
    expect(line?.text.toLowerCase()).not.toContain("verified");
    expect(line?.text.toLowerCase()).not.toContain("prove");
    expect(line?.sha256).toBe(DIGEST);
  });

  it("contradicts: says the two disagree, and still names the file", () => {
    const line = manifestLine(reading({ status: "contradicts" }));
    expect(line?.text).toContain("does not name the predecessor");
    expect(line?.path).toBe(PATH);
  });

  it("declared_only with nothing read: no manifest at that path", () => {
    const line = manifestLine(reading({ status: "declared_only", sha256: null, detail: "no manifest at that path" }));
    expect(line?.text).toContain("No segments manifest was read");
    expect(line?.text).toContain("unconfirmed");
    expect(line?.sha256).toBeNull();
    expect(line?.detail).toBe("no manifest at that path");
  });

  it("declared_only with bytes read: set aside, the package's reason carried verbatim", () => {
    const line = manifestLine(
      reading({ status: "declared_only", detail: "the manifest is not pala-segments/1" }),
    );
    expect(line?.text).toContain("was read and set aside");
    expect(line?.detail).toBe("the manifest is not pala-segments/1");
    expect(line?.sha256).toBe(DIGEST);
  });

  it("no path to look at: says so, without inventing one", () => {
    const line = manifestLine(
      reading({ path: null, status: "declared_only", sha256: null, detail: "the container was not opened from a path" }),
    );
    expect(line?.text).toContain("could be looked for");
    expect(line?.path).toBeNull();
  });
});

group("a status this build does not know", () => {
  it("is named, not guessed into one it knows", () => {
    const line = manifestLine(reading({ status: "partially_matches" }));
    expect(line?.unrecognised).toBe(true);
    expect(line?.text).toContain('"partially_matches"');
    expect(line?.text).not.toContain("names the same predecessor");
  });
});
