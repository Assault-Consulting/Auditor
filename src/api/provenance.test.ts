// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The anchor chain as it was walked.
 *
 * The case worth the most here is the one the API cannot express on its own:
 * a source that was never consulted. Resolution stops at the first answer,
 * so anything after it is missing from `anchor_attempts` entirely — and to
 * an operator, missing looks exactly like empty.
 */

import { describe as group, expect, it } from "vitest";

import type { AnchorAttemptModel, AnchorSourceSpec } from "./generated/types";
import { provenance, provenanceSummary } from "./provenance";

const ABSENT_FILE: AnchorAttemptModel = {
  source_kind: "file",
  source_detail: "/var/lib/pala/anchor.head",
  outcome: "absent",
  error: null,
};

const ANSWERED_MANUAL: AnchorAttemptModel = {
  source_kind: "manual",
  source_detail: "pasted at the desk",
  outcome: "answered",
  error: null,
};

const BROKEN_KEYCHAIN: AnchorAttemptModel = {
  source_kind: "keychain",
  source_detail: "keychain account 'prod'",
  outcome: "error",
  error: "the keychain is locked",
};

group("every source consulted is a link", () => {
  it("keeps them in the order they were tried", () => {
    const links = provenance([ABSENT_FILE, ANSWERED_MANUAL]);
    expect(links.map((l) => l.outcome)).toEqual(["absent", "answered"]);
    expect(links.map((l) => l.order)).toEqual([1, 2]);
  });

  it("never reduces to the one that answered", () => {
    // L2: presenting the answering source as "the" anchor while silently
    // skipping one the operator believed was authoritative is the failure
    // this whole flow exists against.
    expect(provenance([ABSENT_FILE, ANSWERED_MANUAL])).toHaveLength(2);
  });

  it("carries the sidecar's error text rather than a rewritten one", () => {
    const [link] = provenance([BROKEN_KEYCHAIN]);
    expect(link?.error).toBe("the keychain is locked");
  });

  it("gives an absent source a sentence that does not sound like a fault", () => {
    // Absent is normal. Wording it as a problem sends an operator to fix a
    // source that is working exactly as configured.
    const [link] = provenance([ABSENT_FILE]);
    expect(link?.note).toBe("Nothing stored here.");
  });
});

group("sources never reached are shown as never reached", () => {
  const THREE: AnchorSourceSpec[] = [
    { kind: "file", path: "/var/lib/pala/anchor.head", head: null, account: null, detail: "" },
    { kind: "manual", head: "ab".repeat(32), path: null, account: null, detail: "pasted at the desk" },
    { kind: "keychain", account: "prod", head: null, path: null, detail: "" },
  ];

  it("adds the untried tail", () => {
    // Checked against the sidecar: a three-source profile whose second
    // source answers reports TWO attempts. The third is absent from the
    // response entirely.
    const links = provenance([ABSENT_FILE, ANSWERED_MANUAL], THREE);
    expect(links).toHaveLength(3);
    expect(links[2]?.outcome).toBe("not-reached");
  });

  it("says why, rather than leaving a blank row", () => {
    const links = provenance([ABSENT_FILE, ANSWERED_MANUAL], THREE);
    expect(links[2]?.note).toContain("already answered");
  });

  it("identifies the unreached source from the profile", () => {
    // The response says nothing about it, so the only description available
    // is the one the user configured.
    const links = provenance([ABSENT_FILE, ANSWERED_MANUAL], THREE);
    expect(links[2]?.detail).toContain("prod");
  });

  it("adds nothing when every source was tried", () => {
    const links = provenance([ABSENT_FILE, ANSWERED_MANUAL], THREE.slice(0, 2));
    expect(links.every((l) => l.outcome !== "not-reached")).toBe(true);
  });

  it("works with no profile at all", () => {
    // The attempts alone still render; they just cannot show what was never
    // tried, and pretending otherwise would be worse.
    expect(provenance([ABSENT_FILE, ANSWERED_MANUAL])).toHaveLength(2);
  });
});

group("the summary refuses to flatter", () => {
  it("names the source that answered", () => {
    const line = provenanceSummary(provenance([ABSENT_FILE, ANSWERED_MANUAL]));
    expect(line).toContain("answered by manual");
  });

  it("counts errors even when something later answered", () => {
    // A source that could not be read is a thing to fix, whether or not the
    // check succeeded without it.
    const line = provenanceSummary(provenance([BROKEN_KEYCHAIN, ANSWERED_MANUAL]));
    expect(line).toContain("1 could not be read");
  });

  it("says plainly when nothing answered", () => {
    const line = provenanceSummary(provenance([ABSENT_FILE]));
    expect(line).toContain("no source answered");
  });

  it("says when there was nothing configured", () => {
    expect(provenanceSummary([])).toContain("No anchor sources were configured");
  });

  it("never accuses anyone of anything", () => {
    const lines = [
      provenanceSummary(provenance([ABSENT_FILE, ANSWERED_MANUAL])),
      provenanceSummary(provenance([BROKEN_KEYCHAIN])),
      provenanceSummary([]),
    ].join(" ").toLowerCase();
    for (const forbidden of ["tamper", "corrupt", "invalid", "malicious", "attack"]) {
      expect(lines).not.toContain(forbidden);
    }
  });
});
