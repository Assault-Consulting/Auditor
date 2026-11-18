// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import type { SegmentCheckView, SegmentSetView } from "./generated/types";
import { isSegmentManifest } from "./openFile";
import { segmentState, setAnswers } from "./segmentSet";

function seg(over: Partial<SegmentCheckView> = {}): SegmentCheckView {
  return { file: "segment-00000.pala", path: "/x/segment-00000.pala", listed: true, present: true, verified: true, head_matches: true, seam_ok: true, detail: null, ...over };
}

function set(over: Partial<SegmentSetView> = {}): SegmentSetView {
  return { manifest_path: "/x/segments.json", manifest_sha256: "ab".repeat(32), consistent: true, complete: true, head: "cd".repeat(32), absent: [], segments: [seg(), seg({ file: "segment-00001.pala" })], ...over };
}

group("a segment set, in words (§22.1)", () => {
  it("says a whole set is consistent and complete", () => {
    const a = setAnswers(set());
    expect(a.consistent).toEqual({ text: expect.stringMatching(/^Consistent: every segment present \(2 of 2\)/), failed: false });
    expect(a.complete.failed).toBe(false);
  });

  it("calls a set with a segment gone incomplete, never inconsistent, and claims nothing it held", () => {
    const a = setAnswers(set({ complete: false, absent: ["segment-00000.pala"], segments: [seg({ present: false, verified: null, head_matches: null, path: null }), seg({ file: "segment-00001.pala" })] }));
    expect(a.consistent.failed).toBe(false);
    expect(a.consistent.text).toMatch(/\(1 of 2\)/);
    expect(a.complete.text).toMatch(/^Not complete: one segment the manifest lists is not here\. What they held is not claimed/);
    expect(a.complete.text).not.toMatch(/tamper|deleted by|attack/i);
  });

  it("names a set that does not start at the first record", () => {
    expect(setAnswers(set({ complete: false })).complete.text).toMatch(/does not start at the chain's first record/);
  });

  it("says an inconsistent set is not complete because of it", () => {
    const a = setAnswers(set({ consistent: false, complete: false }));
    expect(a.consistent.failed).toBe(true);
    expect(a.complete.text).toBe("Not complete, since it is not consistent.");
  });

  it("describes each segment by what was found", () => {
    expect(segmentState(seg())).toEqual({ text: "holds", failed: false });
    expect(segmentState(seg({ present: false, verified: null }))).toEqual({ text: "listed, not here", failed: true });
    expect(segmentState(seg({ verified: false, head_matches: false }))).toEqual({
      text: "does not hold; its last record is not the head the manifest gives",
      failed: true,
    });
    expect(segmentState(seg({ seam_ok: false })).text).toMatch(/does not link to the segment before it/);
    expect(segmentState(seg({ listed: false })).text).toBe("holds; the writer's live segment, not yet in the manifest");
  });

  it("knows a manifest when one is dropped", () => {
    expect(isSegmentManifest("/var/log/chain.segments.json")).toBe(true);
    expect(isSegmentManifest("C:\\\\logs\\\\segments.json")).toBe(true);
    expect(isSegmentManifest("/x/notsegments.json")).toBe(false);
    expect(isSegmentManifest("/x/chain.pala")).toBe(false);
  });
});
