// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { ATTESTATION, HTML_WITHHELD, reportView, VERDICT_MEANING } from "./report";
import type { ReportResponse } from "./generated/types";

function response(over: Partial<ReportResponse> = {}): ReportResponse {
  return {
    session_id: "s",
    subject_sha256: "ab".repeat(32),
    format: "pala-verification-report/1",
    verdict: "partial",
    report: {
      format: "pala-verification-report/1",
      verdict: "partial",
      checked_at: { wall_ns: 1_786_056_060_000_000_000, note: "the auditing machine's clock" },
    },
    json_text: '{"format":"pala-verification-report/1"}',
    html_text: "<!DOCTYPE html><title>report</title>",
    ...over,
  };
}

group("the package's report, shown (D-01)", () => {
  it("carries the package's verdict and its own sentence for it, unchanged", () => {
    for (const verdict of ["sound", "partial", "violation"]) {
      const view = reportView(response({ verdict }));
      expect(view.verdict).toBe(verdict);
      expect(view.meaning).toBe(VERDICT_MEANING[verdict]);
      expect(view.unrecognised).toBe(false);
    }
  });

  it("never calls a partial report sound, and says completeness was not checked", () => {
    const view = reportView(response({ verdict: "partial" }));
    expect(view.meaning).toContain("completeness was NOT checked");
    expect(view.meaning).not.toMatch(/\bheld\b/);
  });

  it("shows a verdict this build has no words for as it came, with F7's sentence", () => {
    const view = reportView(response({ verdict: "inconclusive" }));
    expect(view.verdict).toBe("inconclusive");
    expect(view.unrecognised).toBe(true);
    expect(view.meaning).toBe("chain-checked, not interpretable by this verifier version");
  });

  it("does not mistake an inherited name for a verdict it knows", () => {
    expect(reportView(response({ verdict: "constructor" })).unrecognised).toBe(true);
    expect(reportView(response({ verdict: "toString" })).unrecognised).toBe(true);
  });

  it("names whose clock built it, from the report's own note", () => {
    const view = reportView(response());
    expect(view.checkedAtIso).toBe("2026-08-06T22:41:00.000Z");
    expect(view.checkedAtNote).toBe("the auditing machine's clock");
  });

  it("copies the package's text, not a re-serialisation", () => {
    const text = '{"format":"pala-verification-report/1",  "verdict":"partial"}';
    expect(reportView(response({ json_text: text })).jsonText).toBe(text);
  });

  it("states what a report is, and that it certifies nothing", () => {
    expect(ATTESTATION).toContain("not a certification");
    expect(ATTESTATION.toLowerCase()).not.toMatch(/compliant|certified|valid log/);
  });
});

group("an empty container on report /1 (0.14)", () => {
  const narrative =
    "The container holds no records. Nothing in it contradicts the format, and nothing in it is a chain: the check passes because there was nothing to check, not because a log was found intact.";

  it("keeps the package's verdict and puts the diagnosis in place of 'sound as far as checked'", () => {
    const view = reportView(
      response({
        verdict: "partial",
        report: { format: "pala-verification-report/1", verdict: "partial", diagnosis: { pattern: "empty_container", narrative } },
      }),
    );
    expect(view.verdict).toBe("partial");
    expect(view.meaning).toBe(narrative);
    expect(view.meaning).not.toContain("sound as far as checked");
    expect(view.meaningFromDiagnosis).toBe(true);
  });

  it("renders an empty file read against an anchor as any violation", () => {
    const view = reportView(
      response({
        verdict: "violation",
        report: {
          format: "pala-verification-report/1",
          verdict: "violation",
          diagnosis: { pattern: "replaced_or_rolled_back", narrative: "a log was written and is not here" },
        },
      }),
    );
    expect(view.meaning).toBe(VERDICT_MEANING.violation);
    expect(view.meaningFromDiagnosis).toBe(false);
  });

  it("leaves every other partial report with the general sentence", () => {
    const view = reportView(response());
    expect(view.meaning).toBe(VERDICT_MEANING.partial);
    expect(view.meaningFromDiagnosis).toBe(false);
  });
});

group("the package's HTML page (D-01b)", () => {
  it("carries the package's page as it came", () => {
    const view = reportView(response({ html_text: "<!DOCTYPE html><p>x</p>" }));
    expect(view.htmlText).toBe("<!DOCTYPE html><p>x</p>");
    expect(view.htmlWithheld).toBe(false);
  });

  it("withholds it for an empty container on report /1, and says why", () => {
    const view = reportView(
      response({
        report: {
          format: "pala-verification-report/1",
          verdict: "partial",
          diagnosis: { pattern: "empty_container", narrative: "nothing to check" },
        },
      }),
    );
    expect(view.htmlWithheld).toBe(true);
    expect(HTML_WITHHELD).toContain("0.15");
    expect(HTML_WITHHELD).toContain("The JSON above is the same report");
  });

  it("offers it for an empty file read against an anchor — a violation", () => {
    const view = reportView(
      response({
        verdict: "violation",
        report: {
          format: "pala-verification-report/1",
          verdict: "violation",
          diagnosis: { pattern: "replaced_or_rolled_back", narrative: "a log was written and is not here" },
        },
      }),
    );
    expect(view.htmlWithheld).toBe(false);
  });
});
