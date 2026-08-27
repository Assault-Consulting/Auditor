// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The boot screen's wording, as a function of state.
 *
 * These functions lived inside App.tsx and had no tests — not by decision,
 * but because a 738-line component file is where testable code stops being
 * tested. Two of them have been wrong twice each, in ways a type could never
 * catch: the value was always a valid string, and the string said something
 * that had stopped being true.
 *
 * So the tests here are about **claims**, not rendering. The rule they
 * enforce is the product's own: nothing may say a thing is unwired after it
 * is wired, and nothing may say the screen holds no result once it holds
 * one.
 *
 * Both of those were checked by mutation rather than assumed. Hardcoding the
 * advisory row to "wired" fails the first group; freezing the footnote to
 * its pre-verdict sentence fails the second. Every test here passed on the
 * first run, which looks identical for a test that carries weight and one
 * that carries none — so the weight was demonstrated instead.
 */

import { describe as group, expect, it } from "vitest";

import { choiceLine, footnoteFor, panelsFor, rowsFor } from "./bootScreen";
import type { ChainState } from "./chainState";
import type { Chronoscope } from "./chronoscope";
import type { SessionResponse, VerificationResponse } from "./generated/types";
import type { Choice, Probe } from "../state";

const SUBJECT: SessionResponse["subject"] = {
  filename: "chain.pala",
  path: "/tmp/chain.pala",
  bytes: 512,
  sha256: "a".repeat(64),
  records: 5,
  first_seq: 0,
  last_seq: 4,
  boots: 1,
  spans: 0,
  assurance_tiers: [{ value: 0, name: "A" }],
  time_trust_values: [{ value: 1, name: "UNSYNCED" }],
};

const OPENED: SessionResponse = {
  session_id: "s1",
  subject: SUBJECT,
  verifier: { package: "palimpsests 0.10.0", spec: "PALA-1 format_version 1" },
};

function result(over: Partial<VerificationResponse> = {}): VerificationResponse {
  return {
    session_id: "s1",
    subject_sha256: SUBJECT.sha256,
    verifier: OPENED.verifier,
    chain: {
      chain_ok: true,
      count: 5,
      head: "b".repeat(64),
      breaks: [],
      gaps: [],
      violations: [],
      uninterpretable: [],
    },
    container: {
      well_formed: true,
      malformed: null,
      bytes_parsed: 512,
      bytes_total: 512,
      body_digest_mismatches: [],
    },
    completeness: {
      complete_to_anchor: null,
      anchor_lag: null,
      anchor_reason: null,
    },
    anchor: null,
    anchor_attempts: [],
    diagnosis: null,
    advisory: { count: 0, items: [] },
    ...over,
  };
}

const VERIFIED: ChainState = {
  kind: "verified",
  opened: OPENED,
  profile: "none",
  sources: [],
  result: result(),
};

const READY: Probe = {
  kind: "ready",
  health: {
    status: "ok",
    version: "0.0.1",
    package: "palimpsests 0.10.0",
    spec: "PALA-1 format_version 1",
    authenticated: true,
  },
  session: { port: 8771, token: "t" },
};

const RAIL: Chronoscope = {
  basis: "recorded",
  watermark: "writer's clock · UNSYNCED",
  days: [
    { date: "2026-08-17", start_ns: 0, count: 3, safety: 0, anchor: 0, empty: false, stepped: false },
    { date: "2026-08-18", start_ns: 1, count: 0, safety: 0, anchor: 0, empty: true, stepped: false },
  ],
  first_date: "2026-08-17",
  last_date: "2026-08-18",
  segments: [],
  pins: [],
  pins_note: "No external witness in this file.",
};

const rowNamed = (rows: ReturnType<typeof rowsFor>, name: string) =>
  rows.find((r) => r.name === name);

// --- nothing may claim to be unwired after it is wired ----------------------

group("the wired-status panel", () => {
  it("reports every component as wired once a chain is verified", () => {
    // The failure this catches, twice over: a row left saying "wired" or a
    // plan reference after the thing shipped. A status display read as
    // current and not current is worse than none at all.
    const rows = rowsFor(READY, VERIFIED, RAIL);

    for (const name of [
      "open a chain",
      "verdict triptych",
      "anchor provenance",
      "advisory lane",
    ]) {
      expect(rowNamed(rows, name)?.live, name).toBe(true);
      expect(rowNamed(rows, name)?.state, name).not.toBe("wired");
    }
  });

  it("reports the rail by its size rather than by a word", () => {
    // A count cannot go stale the way "wired" did: it is derived from the
    // thing it describes.
    expect(rowNamed(rowsFor(READY, VERIFIED, RAIL), "chronoscope")?.state).toBe("2 days");
    expect(rowNamed(rowsFor(READY, VERIFIED, null), "chronoscope")?.live).toBe(false);
  });

  it("says a component is not live before anything is open", () => {
    const rows = rowsFor(READY, { kind: "empty" }, null);
    expect(rowNamed(rows, "open a chain")?.live).toBe(false);
    expect(rowNamed(rows, "verdict triptych")?.state).toBe("wired");
  });

  it("names a disabled token gate in a way nobody reads as fine", () => {
    const rows = rowsFor(
      { ...READY, health: { ...READY.health, authenticated: false } },
      { kind: "empty" },
      null,
    );
    expect(rowNamed(rows, "session token")?.state).toBe("DISABLED");
    expect(rowNamed(rows, "session token")?.live).toBe(false);
  });

  it("still lists the pending components when the sidecar never started", () => {
    // The panel's job is to say what is wired. A failed probe changes what
    // the top rows say, not whether the rest are reported at all.
    const rows = rowsFor({ kind: "failed", detail: "no python" }, { kind: "empty" }, null);
    expect(rowNamed(rows, "sidecar")?.state).toBe("did not start");
    expect(rowNamed(rows, "verdict triptych")).toBeDefined();
  });
});

// --- nothing may say "no result" once there is one --------------------------

group("the footnote", () => {
  it("refuses the overclaim once a verdict is on screen", () => {
    // The risk after a check is not that someone misses the verdict; it is
    // that they read it as certification. This line has been wrong twice by
    // going stale, so it follows the state rather than describing a moment.
    const line = footnoteFor(READY, VERIFIED);
    expect(line).toContain("certify nothing");
    expect(line).not.toContain("Nothing on this screen is a verification result");
  });

  it("says nothing is a result before a check has run", () => {
    expect(footnoteFor(READY, { kind: "open", opened: OPENED })).toContain(
      "Nothing on this screen is a verification result",
    );
  });

  it("explains a missing shell as a way of working, not a failure", () => {
    const line = footnoteFor({ kind: "no-shell" }, { kind: "empty" });
    expect(line).toContain("pnpm tauri dev");
    expect(line.toLowerCase()).not.toContain("error");
  });

  it("carries the sidecar's own words when it did not start", () => {
    expect(footnoteFor({ kind: "failed", detail: "python not found" }, { kind: "empty" })).toContain(
      "python not found",
    );
  });
});

// --- the questions are questions until they are answers ---------------------

group("the panels", () => {
  it("shows the three standing questions with no chain checked", () => {
    const { panels, live } = panelsFor({ kind: "empty" });

    expect(live).toBe(false);
    expect(panels).toHaveLength(3);
    // Not "not-checked": nothing was asked at all, and borrowing the
    // standing that means "asked and unanswerable" would put a real
    // verification state on a screen that has not run one.
    expect(panels.every((p) => p.standing === "unavailable")).toBe(true);
    expect(panels.every((p) => p.answer === "")).toBe(true);
  });

  it("hands over to the verifier's own panels once checked", () => {
    const { panels, live } = panelsFor(VERIFIED);

    expect(live).toBe(true);
    expect(panels).toHaveLength(3);
    expect(panels.some((p) => p.answer !== "")).toBe(true);
  });

  it("keeps showing questions while a check is running", () => {
    // Mid-check the previous answers must not linger as though they were
    // about this run.
    expect(panelsFor({ kind: "verifying", opened: OPENED, profile: "none" }).live).toBe(false);
  });
});

// --- a cancelled dialog is not a state of any chain -------------------------

group("the choice line", () => {
  it("says nothing when nothing has been reached for", () => {
    expect(choiceLine({ kind: "idle" })).toBeNull();
  });

  it("reports a cancelled dialog as an ordinary outcome", () => {
    const line = choiceLine({ kind: "cancelled" });
    expect(line).toContain("nothing was opened");
  });

  it("says how many files were dropped and that only one was used", () => {
    // Silence here would be the screen pretending one file arrived. §22 has
    // not decided what several files mean, so it says what it did instead.
    const choice: Choice = { kind: "extra-dropped", total: 3 };
    const line = choiceLine(choice);
    expect(line).toContain("3 files");
    expect(line).toContain("only the first");
  });
});
