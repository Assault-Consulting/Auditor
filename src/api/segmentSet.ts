// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * A segmented chain as one set — §22.1, built on the package's
 * `verify_segment_set` (U18).
 *
 * §22.1 asked two things. How several files are shown as one chain: as the
 * set the manifest describes, each segment in its place with what the
 * package found of it, and each one opened, to browse, as a chain of its
 * own. And what happens when one is missing: it is listed as missing, the
 * set is called incomplete — never inconsistent, because retention deletes
 * segments by design — and nothing it held is claimed.
 */

import type { SegmentCheckView, SegmentSetView } from "./generated/types";

export interface SetAnswer {
  /** The sentence for the set as a whole. */
  text: string;
  /** Said with the ochre rule. */
  failed: boolean;
}

/** The two answers, in one sentence each, kept apart as the package keeps them. */
export function setAnswers(v: SegmentSetView): { consistent: SetAnswer; complete: SetAnswer } {
  const present = v.segments.filter((s) => s.present).length;
  const consistent: SetAnswer = v.consistent
    ? {
        text: `Consistent: every segment present (${present} of ${v.segments.length}) holds from its declared start and agrees with the manifest, and every seam links.`,
        failed: false,
      }
    : {
        text: "Not consistent: a segment present does not hold, or does not agree with the manifest, or a seam does not link — see the segments below.",
        failed: true,
      };
  let complete: SetAnswer;
  if (v.complete) {
    complete = { text: "Complete: nothing the manifest lists is missing, and the set starts at its first record.", failed: false };
  } else if (!v.consistent) {
    complete = { text: "Not complete, since it is not consistent.", failed: true };
  } else if (v.absent.length > 0) {
    complete = {
      text: `Not complete: ${v.absent.length === 1 ? "one segment the manifest lists is" : `${v.absent.length} segments the manifest lists are`} not here. What they held is not claimed; deletion under a retention policy leaves a set this way.`,
      failed: true,
    };
  } else {
    complete = {
      text: "Not complete: the set does not start at the chain's first record — its beginning is declared, not here.",
      failed: true,
    };
  }
  return { consistent, complete };
}

/** One segment's state, in words that name what was found and no cause. */
export function segmentState(s: SegmentCheckView): { text: string; failed: boolean } {
  if (!s.present) return { text: "listed, not here", failed: true };
  const parts: string[] = [];
  let failed = false;
  if (s.verified === true) parts.push("holds");
  else if (s.verified === false) {
    parts.push("does not hold");
    failed = true;
  }
  if (s.head_matches === false) {
    parts.push("its last record is not the head the manifest gives");
    failed = true;
  }
  if (!s.seam_ok) {
    parts.push("does not link to the segment before it");
    failed = true;
  }
  if (!s.listed) parts.push("the writer's live segment, not yet in the manifest");
  return { text: parts.join("; ") || "checked", failed };
}
