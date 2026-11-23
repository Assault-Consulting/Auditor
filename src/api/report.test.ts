// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { ATTESTATION, reportView, VERDICT_MEANING } from "./report";
import type { ReportResponse } from "./generated/types";

function response(over: Partial<ReportResponse> = {}): ReportResponse {
  return {
    session_id: "s",
    subject_sha256: "ab".repeat(32),
    format: "pala-verification-report/2",
    verdict: "partial",
    report: {
      format: "pala-verification-report/2",
      verdict: "partial",
      checked_at: { wall_ns: 1_786_056_060_000_000_000, note: "the auditing machine's clock" },
    },
    json_text: '{"format":"pala-verification-report/2"}',
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
    const text = '{"format":"pala-verification-report/2",  "verdict":"partial"}';
    expect(reportView(response({ json_text: text })).jsonText).toBe(text);
  });

  it("states what a report is, and that it certifies nothing", () => {
    expect(ATTESTATION).toContain("not a certification");
    expect(ATTESTATION.toLowerCase()).not.toMatch(/compliant|certified|valid log/);
  });
});

group("the package's HTML page (D-01b)", () => {
  it("carries the package's page as it came", () => {
    const view = reportView(response({ html_text: "<!DOCTYPE html><p>x</p>" }));
    expect(view.htmlText).toBe("<!DOCTYPE html><p>x</p>");
  });

  it("offers it for an empty container too (R7)", () => {
    const view = reportView(
      response({
        html_text: "<p>nothing was checked</p>",
        report: {
          format: "pala-verification-report/2",
          verdict: "empty",
          diagnosis: { pattern: "empty_container", narrative: "nothing to check" },
        },
      }),
    );
    expect(view.htmlText).toBe("<p>nothing was checked</p>");
    expect("htmlWithheld" in view).toBe(false);
  });
});

group("the verdict empty (report /2, 0.15)", () => {
  it("has the package's own sentence and is not folded into partial", () => {
    const view = reportView(response({
      format: "pala-verification-report/2",
      verdict: "empty",
      report: {
        format: "pala-verification-report/2",
        verdict: "empty",
        diagnosis: { pattern: "empty_container", narrative: "nothing to check" },
      },
    }));
    expect(view.unrecognised).toBe(false);
    expect(view.meaning).toBe(VERDICT_MEANING.empty);
    expect(view.meaning).toContain("nothing was checked");
    // The verdict says it itself: no gloss from the diagnosis over the top.
    expect(view.meaning).not.toBe("nothing to check");
  });
});
