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
import { type ChainState, chainLine, describe, openPath } from "./chainState";
import type { Session } from "./session";

const SESSION: Session = { port: 8771, token: "t" };

const OPENED = {
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
  },
  verifier: { package: "palimpsests 0.9.0", spec: "PALA-1 format_version 1" },
};

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
