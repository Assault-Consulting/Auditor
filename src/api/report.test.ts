// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { attestation, reportFacts, reportHealth, reportHealthNote, reportView, VERDICT_MEANING } from "./report";
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
    expect(attestation()).toContain("not a certification");
    expect(attestation().toLowerCase()).not.toMatch(/compliant|certified|valid log/);
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

group("what report /2 says beyond its verdict (T13)", () => {
  it("names the diagnosis with its code and question, the violation codes, the manifest", () => {
    const facts = reportFacts({
      diagnosis: { pattern: "record_violation", code: "genesis_not_first", at_seq: 3, question: "consistency" },
      chain: { violation_codes: [[3, "genesis_not_first"]] },
      manifest: { filename: "x.segments.json", status: "matches", sha256: "ab".repeat(32), detail: null },
    });
    expect(facts).toEqual([
      { label: "Diagnosis", value: "record_violation (genesis_not_first) at #3 — about question one, consistency" },
      { label: "Violation codes", value: "#3 genesis_not_first" },
      { label: "Segments manifest", value: `x.segments.json — matches, SHA-256 ${"ab".repeat(8)}…` },
    ]);
  });

  it("ignores what it does not know and shows nothing that is absent", () => {
    expect(reportFacts({ diagnosis: null, manifest: null, a_newer_key: { x: 1 } })).toEqual([]);
  });
});

group("the report's own health section (E-04)", () => {
  const health = {
    note: "advisory: the record's own account",
    boots: { basis: "proved order", count: 2, resumed_after_truncated_tail: 0, with_time_trust_change: 0 },
    anchors: { basis: "the monotonic clock, within one boot", count: 1, boots_without_anchor: 1, widest_gap_ns: 830548, widest_gap_boot_first_seq: 0 },
    wall_clock: { basis: "wall against monotonic", steps: 0, regressions: 0, slews: 0, largest_delta_ns: null, largest_at_seq: null, drift_boots_measured: 2, drift_slope_ppm_min: -43.416, drift_slope_ppm_max: 625.215 },
    spans: { basis: "proved order", closed: 0, open: 0 },
  };

  it("is null when not asked for — never healthy", () => {
    expect(reportHealth({ health: null })).toBeNull();
  });

  it("says each group with the clock it names", () => {
    expect(reportHealth({ health })).toEqual([
      { label: "Boots", value: "2", basis: "proved order" },
      { label: "Anchors", value: "1, widest gap 831 µs (boot starting at #0), 1 boot without one", basis: "the monotonic clock, within one boot" },
      { label: "Wall clock", value: "0 steps, 0 regressions, 0 slews; drift −43.4 to +625.2 ppm over 2 boots", basis: "wall against monotonic" },
      { label: "Spans", value: "0 closed, 0 open", basis: "proved order" },
    ]);
    expect(reportHealthNote({ health })).toBe("advisory: the record's own account");
  });
});
