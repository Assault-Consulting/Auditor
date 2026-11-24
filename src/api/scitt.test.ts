// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { statementAnswer } from "./scitt";

const base = {
  accepted: true,
  code: null,
  detail: null,
  version: "v3",
  statement_id: "ab".repeat(32),
  head: "cd".repeat(32),
  first_seq: 0,
  last_seq: 7,
  root: "ef".repeat(32),
  root_status: "recomputed",
  checked_at_seq: 7,
  records_here: 8,
};

group("a SCITT statement, worded (E-06)", () => {
  it("says what was accepted, and that the root was recomputed here", () => {
    const a = statementAnswer(base);
    expect(a.accepted).toBe(true);
    expect(a.lines[0]).toBe(
      "Accepted: signed under this key, committing to this chain's head at #7 (it reports #0–#7), a v3 statement. Its root over records #0–#7 was recomputed here and matches.",
    );
    expect(a.lines[1]).toContain("Statement id abababababababab");
  });

  it("says when the chain has grown since the statement", () => {
    expect(statementAnswer({ ...base, records_here: 40 }).lines[0]).toContain("The chain has grown since: it now holds 40 records.");
  });

  it("names the failed check, never a cause", () => {
    const a = statementAnswer({ ...base, accepted: false, code: "signature_invalid", detail: "bad sig", version: null });
    expect(a.accepted).toBe(false);
    expect(a.lines[0]).toBe("Not accepted: the signature does not verify under this key (signature_invalid).");
    expect(a.lines[1]).toBe("The verifier: “bad sig”");
    expect(a.lines[2]).toContain("refused alike");
  });

  it("shows a code this build cannot name as the package gave it", () => {
    expect(statementAnswer({ ...base, accepted: false, code: "newer_code", detail: null }).lines[0]).toBe(
      "Not accepted: newer_code (newer_code).",
    );
  });
});
