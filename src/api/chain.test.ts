// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The client's one job: turning status codes into named outcomes.
 *
 * These are the first tests this frontend has had. Until now `tsc` was the
 * only check on any of it — which caught type errors and nothing about
 * behaviour, and let a CSS edit that stripped a rule's declarations pass a
 * green `vite build`.
 *
 * What is worth testing here is the mapping, because it is the thing a
 * component must never do for itself. `if (response.status === 409)` in a
 * view is a number somebody will eventually compare against the wrong one,
 * and 409 in this API means something specific and unforgiving: the file
 * changed underneath an open session, so the previous answer must not be
 * shown any longer.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotAChainError,
  NotFoundError,
  RefusedError,
  SidecarError,
  SubjectChangedError,
  chainTimeline,
  closeChain,
  openChain,
  verifyChain,
} from "./chain";
import type { Session } from "./session";

const SESSION: Session = { port: 8771, token: "test-token" };

/** The arguments of the nth fetch, refusing to guess when there was none. */
function callArgs(fetchMock: typeof fetch, n = 0): [string, RequestInit] {
  const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls[n];
  if (call === undefined) throw new Error(`fetch was not called ${n + 1} time(s)`);
  return call as [string, RequestInit];
}

/** A fetch that answers once, with a status and a body. */
function answering(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the client sends", () => {
  it("carries the session token on every call", async () => {
    const fetchMock = answering(201, { session_id: "s1" });
    vi.stubGlobal("fetch", fetchMock);

    await openChain(SESSION, "/tmp/chain.pala");

    const [, init] = callArgs(fetchMock);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it("talks to the port the shell handed over, on loopback", async () => {
    const fetchMock = answering(201, { session_id: "s1" });
    vi.stubGlobal("fetch", fetchMock);

    await openChain({ port: 9931, token: "t" }, "/tmp/chain.pala");

    const [called] = callArgs(fetchMock);
    expect(called).toBe("http://127.0.0.1:9931/session");
  });

  it("escapes the profile name rather than pasting it into the query", async () => {
    // A profile called "desk &co" is legal and would otherwise truncate the
    // query string, silently verifying against a different profile than the
    // one asked for — which "not checked" would then look identical to.
    const fetchMock = answering(200, { session_id: "s1" });
    vi.stubGlobal("fetch", fetchMock);

    await verifyChain(SESSION, "s1", "desk &co");

    const [called] = callArgs(fetchMock);
    expect(called).toContain("profile=desk%20%26co");
  });

  it("asks for proved order unless wall time is chosen", async () => {
    // L3 as a default rather than as a warning: the axis a caller gets
    // without saying anything is the one the chain establishes.
    const fetchMock = answering(200, { axis: "seq" });
    vi.stubGlobal("fetch", fetchMock);

    await chainTimeline(SESSION, "s1");

    const [called] = callArgs(fetchMock);
    expect(called).toContain("axis=seq");
    expect(called).not.toContain("align=");
  });

  it("sends the alignment only when one was asked for", async () => {
    const fetchMock = answering(200, { axis: "wall" });
    vi.stubGlobal("fetch", fetchMock);

    await chainTimeline(SESSION, "s1", { axis: "wall", align: "day", buckets: 400 });

    const [called] = callArgs(fetchMock);
    expect(called).toContain("axis=wall");
    expect(called).toContain("align=day");
    expect(called).toContain("buckets=400");
  });
});

describe("status codes become named outcomes", () => {
  it("422 is not a chain", async () => {
    vi.stubGlobal("fetch", answering(422, { detail: "the file holds no PALA-1 records" }));
    await expect(openChain(SESSION, "/tmp/notes.txt")).rejects.toBeInstanceOf(
      NotAChainError,
    );
  });

  it("422 on a browse endpoint is the query, not the file", async () => {
    // The same status carries two meanings on this surface, and they send a
    // reader to different places. Opening a container answers 422 when the
    // bytes are not a chain; /timeline answers 422 when the parameters were
    // refused. Sharing one error type would make a mistyped axis report that
    // the operator's file was unreadable — a message that sends them to
    // inspect evidence which is perfectly fine.
    //
    // Both halves are asserted. The confusion this guards against is between
    // two names, so proving the right one is raised is only half of it.
    vi.stubGlobal("fetch", answering(422, { detail: "unknown axis: 'monotonic'" }));

    const raised = await chainTimeline(SESSION, "s1", { axis: "wall" }).catch(
      (e: unknown) => e,
    );

    expect(raised).toBeInstanceOf(RefusedError);
    expect(raised).not.toBeInstanceOf(NotAChainError);
    // The sidecar's own sentence survives, so the screen can say what was
    // actually refused rather than a category name.
    expect((raised as Error).message).toContain("monotonic");
  });

  it("409 is the subject having changed, and has its own type", async () => {
    // Its own type on purpose: a caller must be unable to fold this into a
    // generic failure and carry on showing the previous verdict.
    vi.stubGlobal("fetch", answering(409, { detail: "chain.pala has changed" }));
    await expect(verifyChain(SESSION, "s1")).rejects.toBeInstanceOf(
      SubjectChangedError,
    );
  });

  it("404 is not found", async () => {
    vi.stubGlobal("fetch", answering(404, { detail: "no such session" }));
    await expect(verifyChain(SESSION, "gone")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("401 keeps its status rather than becoming an anonymous failure", async () => {
    vi.stubGlobal("fetch", answering(401, { detail: "bad or missing session token" }));
    await expect(openChain(SESSION, "/tmp/chain.pala")).rejects.toMatchObject({
      name: "SidecarError",
      status: 401,
    });
  });

  it("carries the sidecar's own sentence, not a rewritten one", async () => {
    vi.stubGlobal("fetch", answering(422, { detail: "the file holds no PALA-1 records" }));
    await expect(openChain(SESSION, "/tmp/x")).rejects.toThrow(
      "the file holds no PALA-1 records",
    );
  });

  it("falls back to the status text when the body is not JSON", async () => {
    // A client that throws while reporting a failure tells the user nothing
    // about either.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    await expect(openChain(SESSION, "/tmp/x")).rejects.toBeInstanceOf(SidecarError);
  });
});

describe("closing", () => {
  it("treats a missing session as closed", async () => {
    // Closing something already closed is the caller getting what they asked
    // for. Surfacing it would make every cleanup path write a handler that
    // does nothing.
    vi.stubGlobal("fetch", answering(404, { detail: "no such session" }));
    await expect(closeChain(SESSION, "gone")).resolves.toBeUndefined();
  });

  it("still reports a real failure", async () => {
    vi.stubGlobal("fetch", answering(401, { detail: "bad or missing session token" }));
    await expect(closeChain(SESSION, "s1")).rejects.toBeInstanceOf(SidecarError);
  });
});
