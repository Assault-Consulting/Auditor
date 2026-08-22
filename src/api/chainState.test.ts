// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The chain state machine, tested without rendering anything.
 *
 * Two things are worth checking and neither needs a DOM: that each failure
 * reaches its own state rather than a shared "error", and that the sentences
 * shown describe rather than accuse.
 */

import { describe as group, expect, it, vi } from "vitest";

import { NotAChainError, SidecarError, SubjectChangedError } from "./chain";
import type { SessionResponse } from "./generated/types";
import {
  type ChainState,
  chainLine,
  describe,
  openPath,
  openedOf,
  verifyOpen,
} from "./chainState";
import type { Session } from "./session";

const SESSION: Session = { port: 8771, token: "t" };

// Typed rather than inferred. This fixture went stale the moment ChainSubject
// gained two required fields, and tsc found it in four places — which is the
// generated client doing its job: a model change is a compile error here
// rather than a field that renders empty on screen.
const OPENED: SessionResponse = {
  session_id: "s1",
  subject: {
    filename: "chain.pala",
    path: "/tmp/chain.pala",
    bytes: 969,
    sha256: "ab".repeat(32),
    records: 5,
    first_seq: 0,
    last_seq: 4,
    boots: 1,
    spans: 0,
    // One tier, one time-trust value: a chain written under a single
    // platform guarantee. The set shape is what matters here — a fixture
    // with one entry must not tempt anyone into treating the field as
    // scalar.
    assurance_tiers: [{ value: 0, name: "A" }],
    time_trust_values: [{ value: 1, name: "UNSYNCED" }],
  },
  verifier: { package: "palimpsests 0.9.0", spec: "PALA-1 format_version 1" },
};

const VERIFIED = {
  session_id: "s1",
  subject_sha256: "ab".repeat(32),
  verifier: { package: "palimpsests 0.9.0", spec: "PALA-1 format_version 1" },
  chain: {
    chain_ok: true,
    count: 5,
    head: "cd".repeat(32),
    breaks: [],
    gaps: [],
    violations: [],
    uninterpretable: [],
  },
  completeness: { complete_to_anchor: null, anchor_lag: null, anchor_reason: null },
  anchor: null,
  anchor_attempts: [],
  diagnosis: null,
  advisory: { count: 0, items: [], note: "advisory items do not affect the verdict" },
};

group("verifying is layered over open, not instead of it", () => {
  it("keeps the subject while the check runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(VERIFIED), { status: 200 })),
    );

    const seen: ChainState[] = [];
    await verifyOpen(SESSION, { kind: "open", opened: OPENED }, "desk", (s) => seen.push(s));

    expect(seen.map((s) => s.kind)).toEqual(["verifying", "verified"]);
    // A screen that lost what the file is while asking about it would make
    // the identity-before-verdict separation pointless in practice.
    for (const s of seen) expect(openedOf(s)).toBe(OPENED);
    vi.unstubAllGlobals();
  });

  it("does nothing when no chain is open", async () => {
    const seen: ChainState[] = [];
    await verifyOpen(SESSION, { kind: "empty" }, "none", (s) => seen.push(s));
    expect(seen).toEqual([]);
  });

  it("a changed subject drops the subject rather than keeping a stale one", async () => {
    // Not a failed verification. Nothing on screen describes the file any
    // more, the identity block included.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "has changed" }), { status: 409 })),
    );

    const seen: ChainState[] = [];
    await verifyOpen(SESSION, { kind: "open", opened: OPENED }, "desk", (s) => seen.push(s));

    expect(seen.map((s) => s.kind)).toEqual(["verifying", "subject-changed"]);
    expect(openedOf(seen[1]!)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("the line after a check stays about the artifact", () => {
    // What the check found belongs in the panels, where each question keeps
    // its own answer. Summarising it here would be the single verdict field
    // this API refuses to have.
    const line = chainLine({ kind: "verified", opened: OPENED, profile: "desk", result: VERIFIED });
    expect(line).toContain("chain.pala");
    expect(line).not.toMatch(/\b(valid|passed|failed|ok)\b/i);
  });
});

group("each failure reaches its own state", () => {
  it("a non-container is not-a-chain, and keeps the path", () => {
    const state = describe(new NotAChainError("the file holds no PALA-1 records"), "/tmp/x");
    expect(state.kind).toBe("not-a-chain");
    expect(state).toMatchObject({ path: "/tmp/x" });
  });

  it("a changed subject has its own state, never a generic failure", () => {
    // If this collapsed into "failed", a caller could keep the previous
    // subject on screen while the file underneath it is a different file.
    expect(describe(new SubjectChangedError("chain.pala has changed"), "/p").kind).toBe(
      "subject-changed",
    );
  });

  it("an HTTP error keeps its status in the detail", () => {
    const state = describe(new SidecarError(401, "bad or missing session token"), "/p");
    expect(state).toMatchObject({ kind: "failed" });
    expect(chainLine(state)).toContain("401");
  });

  it("something that is not an Error at all still produces a state", () => {
    expect(describe("network down", "/p").kind).toBe("failed");
  });
});

group("the sidecar's own words survive", () => {
  it("keeps the detail verbatim rather than rewriting it", () => {
    const state = describe(new NotAChainError("the file holds no PALA-1 records"), "/p");
    expect(chainLine(state)).toContain("the file holds no PALA-1 records");
  });
});

group("the wording describes rather than accuses", () => {
  const states: ChainState[] = [
    { kind: "empty" },
    { kind: "opening", path: "/tmp/chain.pala" },
    { kind: "open", opened: OPENED },
    { kind: "verifying", opened: OPENED, profile: "desk" },
    { kind: "verified", opened: OPENED, profile: "desk", result: VERIFIED },
    { kind: "not-a-chain", path: "/tmp/notes.txt", detail: "no PALA-1 records" },
    { kind: "subject-changed", detail: "chain.pala has changed" },
    { kind: "failed", detail: "connection refused" },
  ];

  it.each(states.map((s) => [s.kind, s] as const))(
    "%s says nothing that attributes intent",
    (_kind, state) => {
      // L4: the tool describes, the human judges. "Tampered", "corrupt" and
      // "invalid" are verdicts about a person or a file that this screen has
      // no standing to reach.
      const line = chainLine(state).toLowerCase();
      for (const forbidden of ["tamper", "corrupt", "invalid", "malicious", "attack"]) {
        expect(line).not.toContain(forbidden);
      }
    },
  );

  it("never claims a verdict before one exists", () => {
    expect(chainLine({ kind: "open", opened: OPENED })).toContain("Not verified yet");
  });
});

group("opening replaces what was open", () => {
  it("closes the previous session first", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
        return new Response(JSON.stringify(OPENED), { status: 201 });
      }),
    );

    await openPath(SESSION, { kind: "open", opened: OPENED }, "/tmp/next.pala", () => {});

    expect(calls[0]).toBe("DELETE /session/s1");
    expect(calls[1]).toBe("POST /session");
    vi.unstubAllGlobals();
  });

  it("closes the previous session even when it was already verified", async () => {
    // openedOf covers three states now. If openPath had kept checking for
    // kind === "open", verifying a chain and then opening another would have
    // leaked the first session silently.
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
        return new Response(JSON.stringify(OPENED), { status: 201 });
      }),
    );

    await openPath(
      SESSION,
      { kind: "verified", opened: OPENED, profile: "desk", result: VERIFIED },
      "/tmp/next.pala",
      () => {},
    );

    expect(calls[0]).toBe("DELETE /session/s1");
    vi.unstubAllGlobals();
  });

  it("opens anyway when the previous session refuses to close", async () => {
    // The user asked for a new chain. Refusing because the old one would not
    // let go answers the wrong question; the leaked session dies with the
    // window.
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (first) {
          first = false;
          return new Response(JSON.stringify({ detail: "nope" }), { status: 401 });
        }
        return new Response(JSON.stringify(OPENED), { status: 201 });
      }),
    );

    const seen: ChainState[] = [];
    await openPath(SESSION, { kind: "open", opened: OPENED }, "/tmp/next.pala", (s) =>
      seen.push(s),
    );

    expect(seen.map((s) => s.kind)).toEqual(["opening", "open"]);
    vi.unstubAllGlobals();
  });

  it("reports opening before it reports the outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "not a chain" }), { status: 422 })),
    );

    const seen: ChainState[] = [];
    await openPath(SESSION, { kind: "empty" }, "/tmp/notes.txt", (s) => seen.push(s));

    expect(seen.map((s) => s.kind)).toEqual(["opening", "not-a-chain"]);
    vi.unstubAllGlobals();
  });
});
