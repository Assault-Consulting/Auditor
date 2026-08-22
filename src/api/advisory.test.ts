// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The advisory lane.
 *
 * The risk here runs opposite to the rest of this application. Elsewhere the
 * danger is overclaiming; here it is making a quiet thing loud. So these
 * tests check restraint in the wording and the shape — a lane that reads as
 * findings breaks L5 by presentation while the data stays correct.
 */

import { describe as group, expect, it } from "vitest";

import type { AdvisoryItemModel, AdvisoryModel } from "./generated/types";
import { KNOWN_CODES, advisoryGroups, advisoryLine } from "./advisory";

const NOTE = "advisory items do not affect the verdict";

function item(code: string, at_seq: number | null = null): AdvisoryItemModel {
  return { code, at_seq, boot_id: null, detail: null };
}

function advisory(items: AdvisoryItemModel[]): AdvisoryModel {
  return { count: items.length, items, note: NOTE };
}

group("items are grouped, not listed flat", () => {
  it("five occurrences of one code are one group", () => {
    // Five of the same condition is one thing to look at. A flat list makes
    // it look like five.
    const groups = advisoryGroups(advisory([1, 2, 3, 4, 5].map((n) => item("span_unclosed", n))));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(5);
  });

  it("keeps the items for the group that holds them", () => {
    const groups = advisoryGroups(advisory([item("span_unclosed", 7), item("span_unclosed", 9)]));
    expect(groups[0]?.items.map((i) => i.at_seq)).toEqual([7, 9]);
  });

  it("returns nothing for an empty advisory", () => {
    expect(advisoryGroups(advisory([]))).toEqual([]);
  });
});

group("one weight distinction, and only one", () => {
  it("a hash mismatch sorts above an unresolved reference", () => {
    // §9 asks for exactly this. The package separates the two because an
    // unresolved reference may simply point outside the file you hold, while
    // a mismatched hash is two things that should agree and do not.
    const groups = advisoryGroups(
      advisory([
        item("reference_unresolved"),
        item("reference_unresolved"),
        item("reference_hash_mismatch"),
      ]),
    );
    expect(groups[0]?.code).toBe("reference_hash_mismatch");
  });

  it("outranks a larger ordinary group", () => {
    const groups = advisoryGroups(
      advisory([...Array(9).fill(item("span_unclosed")), item("reference_hash_mismatch")]),
    );
    expect(groups[0]?.code).toBe("reference_hash_mismatch");
    expect(groups[0]?.count).toBe(1);
  });

  it("is the only code marked notable besides the shred key mismatch", () => {
    // Two notable codes, both about things that should agree and do not.
    // This guards the most likely future edit: every code looks worth
    // highlighting when examined on its own, and after a few reasonable
    // decisions they would all be notable and the distinction would be gone.
    const notable = KNOWN_CODES.filter(
      (code) => advisoryGroups(advisory([item(code)]))[0]?.weight === "notable",
    );
    expect(notable.sort()).toEqual(["reference_hash_mismatch", "shred_target_key_mismatch"]);
  });
});

group("the order is stable between runs", () => {
  it("sorts by count and then by code within a weight", () => {
    // A lane that reshuffles on every check cannot be compared against last
    // week's.
    const groups = advisoryGroups(
      advisory([
        item("span_unopened"),
        item("mono_regression_in_boot"),
        item("mono_regression_in_boot"),
        item("anchor_never_written"),
      ]),
    );
    expect(groups.map((g) => g.code)).toEqual([
      "mono_regression_in_boot",
      "anchor_never_written",
      "span_unopened",
    ]);
  });
});

group("codes the specification does not list are still rendered", () => {
  it("span_unclosed has wording even though §9 omits it", () => {
    // Checked against the installed package rather than the document: 0.9.0
    // emits span_unclosed and span_unopened, and FUNCTIONALITY.md §9 lists
    // neither. A lane built from the document would have shown blank rows.
    const [g] = advisoryGroups(advisory([item("span_unclosed")]));
    expect(g?.unrecognised).toBe(false);
    expect(g?.title).toContain("never closed");
  });

  it("an unknown code falls back to itself rather than to nothing", () => {
    const [g] = advisoryGroups(advisory([item("something_new_upstream")]));
    expect(g?.unrecognised).toBe(true);
    expect(g?.title).toBe("something_new_upstream");
    expect(g?.note).toContain("no description");
  });
});

group("the lane carries the payload's own sentence", () => {
  it("quotes the note rather than paraphrasing it", () => {
    // The API put that sentence in the payload precisely so a UI could not
    // soften it or drop it.
    expect(advisoryLine(advisory([item("span_unclosed")]))).toContain(NOTE);
  });

  it("says there are none rather than hiding the lane", () => {
    // "No advisory items" is information. An absent section is ambiguous
    // between that and a lane nobody implemented.
    const line = advisoryLine(advisory([]));
    expect(line).toContain("No advisory items");
    expect(line).toContain(NOTE);
  });

  it("counts in the singular when there is one", () => {
    expect(advisoryLine(advisory([item("span_unclosed")]))).toContain("1 advisory item —");
  });
});

group("nothing in the lane reads as a verdict", () => {
  it.each(KNOWN_CODES)("%s says what the condition is, not what caused it", (code) => {
    const [g] = advisoryGroups(advisory([item(code)]));
    const ours = `${g?.title} ${g?.note}`.toLowerCase();
    for (const forbidden of ["tamper", "corrupt", "invalid", "malicious", "attack", "failed", "error"]) {
      expect(ours).not.toContain(forbidden);
    }
  });

  it.each(KNOWN_CODES)("%s never implies the verdict changed", (code) => {
    const [g] = advisoryGroups(advisory([item(code)]));
    const ours = `${g?.title} ${g?.note}`.toLowerCase();
    for (const forbidden of ["verdict", "passed", "fails", "unverified"]) {
      expect(ours).not.toContain(forbidden);
    }
  });
});
