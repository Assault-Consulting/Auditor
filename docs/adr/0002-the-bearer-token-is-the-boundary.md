<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# ADR-0002: The bearer token is the sidecar's boundary; CORS is not

- **Status:** Accepted
- **Date:** 2026-08-17
- **Scope:** `sidecar/auditor_sidecar/main.py`, `src-tauri/`, the frontend
- **Related:** `SECURITY.md`, `ARCHITECTURE.md` §2, §6

## Context

The frontend runs in a webview and needs to reach the sidecar over HTTP on
loopback. Three facts collide.

1. The sidecar reads **arbitrary file paths on request**. It is the most
   sensitive surface in the application.
2. The webview's origin is not the sidecar's origin. Under Tauri 2 it is
   `tauri://localhost` on macOS and Linux, `http://tauri.localhost` on
   Windows, and `http://localhost:1420` while developing against Vite. Every
   call the frontend makes is cross-origin, so without a CORS policy the
   browser refuses every response.
3. The obvious fix — allow all origins — would mean any web page the user has
   open could talk to a service that reads their filesystem.

The tempting shortcut, and the one this ADR exists to rule out, is to add
`allow_origins=["*"]` because a status indicator will not turn green
otherwise. That is deciding a trust boundary for a cosmetic reason.

## Decision

**The per-launch bearer token is the boundary. CORS is a narrowing control,
and is never described or relied on as protection.**

Concretely:

1. **The token is mandatory** on every route except `/health`. The desktop
   shell generates it at launch with a cryptographic RNG, passes it to the
   sidecar in the environment, and hands it to the frontend over Tauri IPC.
   It is compared with `secrets.compare_digest`. It never travels in a URL
   and never in a cookie.

2. **CORS allows four exact origins** — the three webview origins above and
   the Vite dev server — with **no wildcard** and
   **`allow_credentials=False`**. Allowing credentials would invite a
   cookie-based session later, and a cookie is precisely what a cross-site
   request carries by default.

3. **The CORS middleware is registered after the token middleware**, and
   therefore runs outside it. A preflight `OPTIONS` carries no
   `Authorization` header; if the token check ran first, every preflight
   would be refused and the browser would report the failure as a CORS error
   rather than a 401 — an hour spent debugging the wrong layer. Starlette
   builds its stack in reverse order of registration, so this ordering is
   load-bearing and is pinned by a test.

4. **The sidecar binds `127.0.0.1` only**, pinned by a test that fails on
   `0.0.0.0`.

5. **The port is chosen by the shell** and passed in the environment. The
   shell is the process that can observe a collision and retry; a hard-coded
   port makes two windows on one machine fight silently.

## What each control actually buys

Stating this plainly is the point of the ADR, because the two are routinely
confused:

| Control | Stops | Does **not** stop |
|---|---|---|
| Bearer token | Any local process that does not have it | Nothing, if it leaks |
| CORS allowlist | A web page in the user's browser reading responses | `curl`, or any non-browser caller |
| Loopback bind | Anything off-machine | Anything on-machine |

CORS is enforced by the browser, not the server. A local process with `curl`
ignores it completely. So the allowlist buys exactly one thing: an ordinary
page the user happens to have open cannot probe the unauthenticated
`/health` endpoint and learn that this application is installed and which
verifier it links against. That is worth having and it is not a boundary.

## Alternatives considered

**Proxy every call through Tauri IPC, so the webview never speaks HTTP.**
Genuinely stronger — there would be no listening socket reachable from a
browser at all. Rejected for now on cost: it means hand-writing an IPC
command for every endpoint and re-implementing streaming and pagination
across the bridge, and it would make the generated OpenAPI client (A-07)
useless. Revisit if the sidecar ever exposes something more dangerous than
reads, or before the first signed release.

**Unix domain socket / named pipe instead of TCP.** Removes the port
collision problem and is unreachable from a browser. Rejected because
webviews cannot speak to a UDS from `fetch`, so it forces the IPC-proxy
design above. Same revisit trigger.

**No token in development, token only in release builds.** Rejected. The
untested configuration is the one that breaks, and a security control that
only exists in the build nobody runs day-to-day is a control nobody notices
breaking. The token is on everywhere; running the sidecar manually without
one prints a warning naming what has been disabled.

## Consequences

- The frontend cannot reach the sidecar until the shell has handed it a
  token. There is no anonymous path, and no development shortcut that
  bypasses one.
- `/health` remains unauthenticated by design (ADR context in
  `main.py`): the shell polls it to decide when the sidecar is up, and a
  probe that can fail for two different reasons cannot distinguish them. It
  discloses versions and nothing else.
- Adding an origin to the allowlist is a security review, not a
  configuration tweak, and the list is pinned by tests that fail when it
  widens.
- If the IPC-proxy alternative is later adopted, this ADR is superseded
  rather than amended: the boundary moves, and a decision that moves a
  boundary deserves its own record.
