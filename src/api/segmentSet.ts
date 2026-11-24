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

import { t, tn } from "../i18n";
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
        text: t("set.consistent", { present, total: v.segments.length }),
        failed: false,
      }
    : {
        text: t("set.inconsistent"),
        failed: true,
      };
  let complete: SetAnswer;
  if (v.complete) {
    complete = { text: t("set.complete"), failed: false };
  } else if (!v.consistent) {
    complete = { text: t("set.incomplete.inconsistent"), failed: true };
  } else if (v.absent.length > 0) {
    complete = {
      text: tn("set.incomplete.absent", v.absent.length),
      failed: true,
    };
  } else {
    complete = {
      text: t("set.incomplete.start"),
      failed: true,
    };
  }
  return { consistent, complete };
}

/** One segment's state, in words that name what was found and no cause. */
export function segmentState(s: SegmentCheckView): { text: string; failed: boolean } {
  if (!s.present) {
    // R16: what the manifest declared the segment held is all that is left
    // of it — said as a declaration, never as records that existed.
    const range =
      s.declared_first_seq != null && s.declared_last_seq != null
        ? t("set.segment.range", { first: s.declared_first_seq, last: s.declared_last_seq })
        : null;
    const head = s.declared_head ? t("set.segment.head", { head: s.declared_head.slice(0, 12) }) : null;
    const declared = [range, head].filter((x) => x !== null).join(", ");
    return {
      text: declared ? t("set.segment.declared", { declared }) : t("set.segment.absent"),
      failed: true,
    };
  }
  const parts: string[] = [];
  let failed = false;
  if (s.verified === true) parts.push(t("set.segment.holds"));
  else if (s.verified === false) {
    parts.push(t("set.segment.no_hold"));
    failed = true;
  }
  if (s.head_matches === false) {
    parts.push(t("set.segment.head_differs"));
    failed = true;
  }
  if (!s.seam_ok) {
    parts.push(t("set.segment.no_seam"));
    failed = true;
  }
  if (!s.listed) parts.push(t("set.segment.live"));
  return { text: parts.join("; ") || t("set.segment.checked"), failed };
}
