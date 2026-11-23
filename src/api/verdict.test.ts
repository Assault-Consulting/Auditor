// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The triptych, checked as wording rather than as layout.
 *
 * In this product the sentence is the behaviour: a panel that says the wrong
 * thing about a truncated file is not a styling defect. So these tests read
 * the answers.
 */

import { describe as group, expect, it } from "vitest";

import vocabulary from "./generated/vocabulary.json";
import type { ChainSubject, VerificationResponse } from "./generated/types";
import { type Panel, triptych } from "./verdict";

const TIER_A: ChainSubject = {
  filename: "chain.pala",
  path: "/tmp/chain.pala",
  bytes: 969,
  sha256: "ab".repeat(32),
  records: 5,
  first_seq: 0,
  last_seq: 4,
  boots: 1,
  spans: 0,
  assurance_tiers: [{ value: 0, name: "A" }],
  time_trust_values: [{ value: 1, name: "UNSYNCED" }],
};

/**
 * The package's placement of each pattern (DIAGNOSIS_QUESTIONS, 0.15) —
 * the fixture fills `question` from it as the sidecar would.
 */
const QUESTIONS = vocabulary.diagnosis_questions as Record<string, "consistency" | "completeness" | null>;

/**
 * `consistent` is `is_consistent()` (T10): headers link, the container walks
 * to its end, every body matches. Derived here from the facts the fixture
 * states, so each test's facts and answer cannot disagree.
 */
function response(over: Partial<VerificationResponse> = {}): VerificationResponse {
  const r = raw(over);
  const d = r.diagnosis ?? null;
  return {
    ...r,
    consistent:
      over.consistent ??
      (r.chain.chain_ok && r.container.well_formed && r.container.body_digest_mismatches.length === 0),
    diagnosis: d === null ? null : { ...d, question: d.question !== undefined ? d.question : (QUESTIONS[d.pattern] ?? null) },
  };
}

function raw(over: Partial<VerificationResponse>): VerificationResponse {
  return {
    consistent: true,
    session_id: "s1",
    subject_sha256: "ab".repeat(32),
    verifier: { package: "palimpsests 0.10.0", spec: "PALA-1 format_version 1" },
    chain: {
      chain_ok: true,
      count: 5,
      head: "cd".repeat(32),
      breaks: [],
      gaps: [],
      violations: [],
      uninterpretable: [],
    },
    container: {
      well_formed: true,
      malformed: null,
      bytes_parsed: 966,
      bytes_total: 966,
      body_digest_mismatches: [],
    },
    completeness: { complete_to_anchor: null, anchor_lag: null, anchor_reason: null },
    anchor: null,
    anchor_attempts: [],
    diagnosis: null,
    advisory: { count: 0, items: [], note: "advisory items do not affect the verdict" },
    ...over,
  };
}

const ANSWERED = {
  source_kind: "file",
  source_detail: "/var/lib/pala/anchor.head",
  observed_at_ns: null,
  head: "cd".repeat(32),
};

// --- question one -----------------------------------------------------------

group("question one is the facts — chain_ok, a whole container, matching bodies", () => {
  it("a sound chain is answered yes", () => {
    const [q1] = triptych(response(), TIER_A);
    expect(q1.standing).toBe("answered-yes");
  });

  it("says both walks ran when both did", () => {
    const [q1] = triptych(response(), TIER_A);
    expect(q1.answer).toContain("matching its own body digest");
    expect(q1.basis).toContain("body digests");
  });

  it("a swapped body is answered no even though the headers link", () => {
    // Audit finding K5. chain_ok covers headers only — still true of the
    // reader path on 0.10 — so a body that no longer matches its digest
    // leaves every link verifying. Answering question one from chain_ok
    // alone put a green panel on a file whose contents had changed.
    const [q1] = triptych(
      response({
        container: {
          well_formed: true,
          malformed: null,
          bytes_parsed: 966,
          bytes_total: 966,
          body_digest_mismatches: [3],
        },
      }),
      TIER_A,
    );
    expect(q1.standing).toBe("answered-no");
    expect(q1.answer).toContain("record #3");
    expect(q1.answer).toContain("headers link");
  });

  it("names several mismatched records rather than only the first", () => {
    const [q1] = triptych(
      response({
        container: {
          well_formed: true,
          malformed: null,
          bytes_parsed: 966,
          bytes_total: 966,
          body_digest_mismatches: [3, 7],
        },
      }),
      TIER_A,
    );
    expect(q1.answer).toContain("2 records");
    expect(q1.answer).toContain("#3, #7");
  });

  it("reports a mismatched body before a truncation", () => {
    // The more specific finding wins the line. A cut file is missing its
    // end; a body that does not match its digest is a record that is not
    // what its own header says.
    const [q1] = triptych(
      response({
        container: {
          well_formed: true,
          malformed: null,
          bytes_parsed: 900,
          bytes_total: 966,
          body_digest_mismatches: [3],
        },
        diagnosis: {
          pattern: "truncated_tail",
          at_seq: null,
          expected: null,
          narrative: "The container ends in the middle of a record.",
        },
      }),
      TIER_A,
    );
    expect(q1.answer).toContain("body digest");
    expect(q1.narrative).toContain("middle of a record");
  });

  it("a TRUNCATED chain is answered no, even though chain_ok is true", () => {
    // The rule this module exists for. The verifier really does report
    // chain_ok: true here — every record it could read links — and a panel
    // keyed on that field alone would show a green tick on a cut file.
    const [q1] = triptych(
      response({
        chain: { ...response().chain, count: 4 },
        diagnosis: {
          pattern: "truncated_tail",
          at_seq: null,
          expected: null,
          narrative: "The container ends in the middle of a record.",
        },
      }),
      TIER_A,
    );
    expect(q1.standing).toBe("answered-no");
    expect(q1.answer).toContain("not whole");
  });

  it("a broken chain is answered no for a different reason, and says so", () => {
    const [q1] = triptych(
      response({
        chain: { ...response().chain, chain_ok: false, breaks: [3] },
        diagnosis: {
          pattern: "chain_break",
          at_seq: 3,
          expected: null,
          narrative: "Record 3 does not name its predecessor.",
        },
      }),
      TIER_A,
    );
    expect(q1.answer).toContain("does not hold");
  });

  it("carries the verifier's sentence rather than a rewritten one", () => {
    const [q1] = triptych(
      response({
        diagnosis: {
          pattern: "truncated_tail",
          at_seq: null,
          expected: null,
          narrative: "The container ends in the middle of a record.",
        },
      }),
      TIER_A,
    );
    expect(q1.narrative).toBe("The container ends in the middle of a record.");
  });

  it("is never not-checked — it needs no key and no anchor", () => {
    for (const v of [response(), response({ chain: { ...response().chain, chain_ok: false } })]) {
      expect(triptych(v, TIER_A)[0].standing).not.toBe("not-checked");
    }
  });
});

// --- question two -----------------------------------------------------------

group("question two keeps its third state", () => {
  it("no anchor at all says so plainly", () => {
    const [, q2] = triptych(response(), TIER_A);
    expect(q2.standing).toBe("not-checked");
    expect(q2.answer).toContain("no anchor was supplied");
  });

  it("sources consulted and none answering is a DIFFERENT sentence", () => {
    // An operator who configured an anchor and got nothing must not be told
    // they supplied none — that sends them to fix something that is not
    // broken.
    const [, q2] = triptych(
      response({
        anchor_attempts: [
          { source_kind: "file", source_detail: "/gone", outcome: "absent", error: null },
          { source_kind: "keychain", source_detail: "desk", outcome: "absent", error: null },
        ],
      }),
      TIER_A,
    );
    expect(q2.standing).toBe("not-checked");
    expect(q2.answer).toContain("2 anchor sources were consulted");
  });

  it("complete names the source that answered", () => {
    const [, q2] = triptych(
      response({
        completeness: { complete_to_anchor: true, anchor_lag: null, anchor_reason: null },
        anchor: ANSWERED,
      }),
      TIER_A,
    );
    expect(q2.standing).toBe("answered-yes");
    expect(q2.answer).toContain("/var/lib/pala/anchor.head");
  });

  it("at tier A, a head kept on the log's own host carries its limit", () => {
    // ANSWERED is a file anchor — it sits beside the chain.
    const [, q2] = triptych(
      response({
        completeness: { complete_to_anchor: true, anchor_lag: null, anchor_reason: null },
        anchor: ANSWERED,
      }),
      TIER_A,
    );
    expect(q2.answer).toContain("same host as the log");
  });

  it("at tier A, a head from elsewhere does not get a host caveat it does not have", () => {
    // A manual head is handed over by someone else, and a pkcs11 head sits
    // behind a PIN on a token: neither shares the log's host exposure.
    for (const source_kind of ["manual", "pkcs11"]) {
      const [, q2] = triptych(
        response({
          completeness: { complete_to_anchor: true, anchor_lag: null, anchor_reason: null },
          anchor: { ...ANSWERED, source_kind },
        }),
        TIER_A,
      );
      expect(q2.answer).not.toContain("same host");
      expect(q2.answer).not.toContain("local anchor store");
    }
  });

  it("a lagging tail reports how many records sit past the anchor", () => {
    const [, q2] = triptych(
      response({
        completeness: { complete_to_anchor: false, anchor_lag: 295, anchor_reason: null },
        anchor: ANSWERED,
      }),
      TIER_A,
    );
    expect(q2.answer).toContain("295 records");
  });

  it("one record past the anchor is one record, not 'records'", () => {
    const [, q2] = triptych(
      response({
        completeness: { complete_to_anchor: false, anchor_lag: 1, anchor_reason: null },
        anchor: ANSWERED,
      }),
      TIER_A,
    );
    expect(q2.answer).toContain("1 record sits beyond");
  });

  it("a file with no records is never complete — not even to the empty chain's head", () => {
    // The empty chain's head is thirty-two zero bytes; an anchor holding it
    // "matches" a file that holds nothing. Measured on 0.14.1:
    // complete_to_anchor true, count 0, diagnosis empty_container.
    const [, q2] = triptych(
      response({
        chain: { ...response().chain, count: 0, head: "00".repeat(32) },
        completeness: { complete_to_anchor: true, anchor_lag: null, anchor_reason: null },
        anchor: { ...ANSWERED, source_kind: "manual", head: "00".repeat(32) },
        diagnosis: {
          pattern: "empty_container",
          at_seq: null,
          expected: "at least one record, beginning with a GENESIS",
          narrative: "The container holds no records.",
        },
      }),
      TIER_A,
    );
    expect(q2.standing).toBe("not-checked");
    expect(q2.answer).toContain("nothing was checked");
    expect(q2.answer).not.toContain("Complete");
  });
});

// --- a finding about question two is not a finding about question one --------

// The responses below are the sidecar's own /verify answers on palimpsests
// 0.14.1 for a whole three-record chain, cut to what the panels read. The
// package gives one diagnosis for all three questions; these two are about
// completeness, and question one must not answer no because of them.
group("a whole chain read against an anchor it has outrun or that names nothing", () => {
  const LAGGING = response({
    chain: { ...response().chain, count: 3 },
    completeness: {
      complete_to_anchor: false,
      anchor_lag: 1,
      anchor_reason:
        "chain extends 1 record(s) beyond the anchored head — an unanchored tail, not a replacement",
    },
    anchor: { ...ANSWERED, source_kind: "manual", source_detail: "" },
    diagnosis: {
      pattern: "unanchored_tail",
      at_seq: null,
      expected: "the head equal to the anchored head",
      narrative:
        "The chain extends 1 record(s) past the anchored head; the evidence is consistent with an unanchored tail (a crash between write and anchoring), not a replacement.",
    },
  });
  const FOREIGN = response({
    chain: { ...response().chain, count: 3 },
    completeness: {
      complete_to_anchor: false,
      anchor_lag: null,
      anchor_reason:
        "the anchored head names no record in this chain — the log was replaced, rolled back, or truncated",
    },
    anchor: { ...ANSWERED, source_kind: "manual", source_detail: "", head: "ab".repeat(32) },
    diagnosis: {
      pattern: "replaced_or_rolled_back",
      at_seq: null,
      expected: "the anchored head present somewhere in the chain",
      narrative:
        "The anchored head names no record in this chain; the evidence is consistent with the log having been replaced or rolled back.",
    },
  });

  it("an anchor the chain has outrun: question one yes, question two no", () => {
    const [q1, q2] = triptych(LAGGING, TIER_A);
    expect(q1.standing).toBe("answered-yes");
    expect(q1.answer).not.toContain("not whole");
    expect(q1.narrative).toBeUndefined();
    expect(q2.standing).toBe("answered-no");
    expect(q2.answer).toContain("1 record sits beyond");
    expect(q2.narrative).toContain("unanchored tail");
  });

  it("an anchor that names nothing here: question one yes, question two no", () => {
    const [q1, q2] = triptych(FOREIGN, TIER_A);
    expect(q1.standing).toBe("answered-yes");
    expect(q1.narrative).toBeUndefined();
    expect(q2.standing).toBe("answered-no");
    expect(q2.answer).toContain("does not name a record");
  });

  it("a pattern this build does not know: the facts answer, and the sentence is shown as unguided", () => {
    const [q1] = triptych(
      response({
        diagnosis: {
          pattern: "something_new",
          at_seq: null,
          expected: null,
          narrative: "A sentence from a newer verifier.",
        },
      }),
      TIER_A,
    );
    expect(q1.standing).toBe("answered-yes");
    expect(q1.answer).toContain("no guidance");
    expect(q1.narrative).toBe("A sentence from a newer verifier.");
  });

  it("places a sentence by the package's question, not by a list kept here (T10)", () => {
    // A pattern this build has never heard of, placed by the package under
    // question two: its sentence leaves panel one alone.
    const [q1] = triptych(
      response({
        diagnosis: {
          pattern: "a_newer_completeness_pattern",
          question: "completeness",
          at_seq: null,
          expected: null,
          narrative: "About the anchor.",
        },
      }),
      TIER_A,
    );
    expect(q1.standing).toBe("answered-yes");
    expect(q1.narrative).toBeUndefined();
    expect(q1.answer).not.toContain("no guidance");
  });

  it("answers from the package's consistent when the facts it sees are not in the response", () => {
    const [q1] = triptych(response({ consistent: false }), TIER_A);
    expect(q1.standing).toBe("answered-no");
  });

  it("a cut container is still no, whatever chain_ok says", () => {
    const [q1] = triptych(
      response({
        chain: { ...response().chain, count: 2 },
        container: { ...response().container, well_formed: false, malformed: "truncated record" },
        diagnosis: null,
      }),
      TIER_A,
    );
    expect(q1.standing).toBe("answered-no");
    expect(q1.answer).toContain("not whole");
  });
});

// --- question three ---------------------------------------------------------

group("question three is honest about having nothing", () => {
  it("is unavailable, not failed", () => {
    // This file carries no witness. That is an absence in the file, not a
    // defect in the log — and not a property of tier A either: an external
    // witness is tier-independent (checked against palimpsests 0.12.0).
    const [, , q3] = triptych(response(), TIER_A);
    expect(q3.standing).toBe("unavailable");
  });

  it("names the clock the times came from", () => {
    const [, , q3] = triptych(response(), TIER_A);
    expect(q3.answer).toContain("UNSYNCED");
  });

  it("says when the clock changed status mid-chain", () => {
    const [, , q3] = triptych(response(), {
      ...TIER_A,
      time_trust_values: [
        { value: 1, name: "UNSYNCED" },
        { value: 3, name: "NTP_SYNCED" },
      ],
    });
    expect(q3.answer).toContain("changed status mid-chain");
  });

  it("reports mixed tiers rather than picking one", () => {
    const [, , q3] = triptych(response(), {
      ...TIER_A,
      assurance_tiers: [
        { value: 0, name: "A" },
        { value: 1, name: "B" },
      ],
    });
    expect(q3.basis).toContain("mixed tiers");
  });

  it("does not invent a name for a tier this build does not know", () => {
    const [, , q3] = triptych(response(), {
      ...TIER_A,
      assurance_tiers: [{ value: 7, name: null }],
    });
    expect(q3.basis).toContain("tier 7");
  });
});

// --- the rule that outranks the others --------------------------------------

group("no panel accuses anyone of anything", () => {
  const cases: Array<[string, VerificationResponse, ChainSubject]> = [
    ["sound", response(), TIER_A],
    [
      "truncated",
      response({
        diagnosis: {
          pattern: "truncated_tail",
          at_seq: null,
          expected: null,
          narrative: "The container ends in the middle of a record.",
        },
      }),
      TIER_A,
    ],
    [
      "replaced",
      response({
        completeness: {
          complete_to_anchor: false,
          anchor_lag: null,
          anchor_reason: "the anchored head names no record in this chain",
        },
        anchor: ANSWERED,
      }),
      TIER_A,
    ],
    [
      // The newest branch, and the one most likely to reach for a verdict:
      // a body that does not match its digest is the closest this tool
      // comes to evidence of alteration, and it still only names records.
      "body mismatch",
      response({
        container: {
          well_formed: true,
          malformed: null,
          bytes_parsed: 966,
          bytes_total: 966,
          body_digest_mismatches: [3],
        },
      }),
      TIER_A,
    ],
  ];

  it.each(cases)("%s says nothing about intent", (_name, v, subject) => {
    // L4. The narrative field is the package's own words and is exempt —
    // we carry it verbatim — but every sentence this module writes is ours.
    for (const panel of triptych(v, subject)) {
      const ours = `${panel.question} ${panel.answer} ${panel.basis}`.toLowerCase();
      for (const forbidden of ["tamper", "corrupt", "invalid", "malicious", "attack", "fraud", "altered", "modified"]) {
        expect(ours).not.toContain(forbidden);
      }
    }
  });

  it("never writes the word valid, in any panel", () => {
    const panels: Panel[] = triptych(response(), TIER_A);
    expect(panels.map((p) => p.answer).join(" ")).not.toMatch(/\bvalid\b/i);
  });
});

// --- a file with no records (C-17b) ------------------------------------------

group("question one for a file with no records", () => {
  const empty = (pattern: string, narrative: string) =>
    response({
      chain: { ...response().chain, count: 0, head: "00".repeat(32) },
      container: { ...response().container, well_formed: pattern !== "not_a_container", bytes_parsed: 0 },
      diagnosis: { pattern, at_seq: null, expected: null, narrative, code: null },
    });

  it("never reads as linked, and says the file is not a chain", () => {
    const v = empty("not_a_container", "The file does not begin with a PALA-1 record.");
    const [panel] = triptych(v, TIER_A);
    expect(panel.standing).toBe("answered-no");
    expect(panel.answer).toContain("not a chain");
    expect(panel.answer).not.toMatch(/linked, but|does not hold/);
    expect(panel.narrative).toBe("The file does not begin with a PALA-1 record.");
  });

  it("says plainly that nothing was checked when no record is there", () => {
    const v = empty("empty_container", "The container holds no records.");
    const [panel] = triptych(v, TIER_A);
    expect(panel.standing).toBe("answered-no");
    expect(panel.answer).toContain("nothing in it was linked or checked");
  });
});
