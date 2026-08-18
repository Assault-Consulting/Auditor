// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The sidecar session: where it is, and the token that opens it.
 *
 * The token arrives over Tauri IPC and nowhere else (ADR-0002). There is no
 * fallback that invents one, and no development mode that skips it: a security
 * control which only exists in the build nobody runs day to day is a control
 * nobody notices breaking.
 */

import { invoke } from "@tauri-apps/api/core";

export interface Session {
  port: number;
  token: string;
}

/** Raised when the page is not running inside the desktop shell. */
export class NoShellError extends Error {
  constructor() {
    super("not running inside the desktop shell");
    this.name = "NoShellError";
  }
}

let cached: Session | null = null;

/**
 * Ask the shell for this launch's session.
 *
 * Cached because the shell mints one token per launch; asking twice is not
 * wrong, but a component that re-renders is not a reason to cross the IPC
 * bridge again.
 */
export async function getSession(): Promise<Session> {
  if (cached) return cached;
  try {
    cached = await invoke<Session>("sidecar_session");
    return cached;
  } catch {
    // `pnpm dev` in a plain browser has no shell behind it. That is a normal
    // way to work on the frontend, so it gets its own error type and a screen
    // that says so, rather than a generic failure that reads like a bug.
    throw new NoShellError();
  }
}

export interface Health {
  status: string;
  version: string;
  package: string;
  spec: string;
  authenticated: boolean;
}

/**
 * Read the sidecar's liveness and identity.
 *
 * `/health` is the one route that needs no token, so the shell can tell
 * "starting" apart from "refusing". The header is sent anyway: this function
 * is also the proof that the token the shell handed over is the one the
 * sidecar is enforcing.
 */
export async function getHealth(session: Session): Promise<Health> {
  const r = await fetch(`http://127.0.0.1:${session.port}/health`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!r.ok) {
    throw new Error(`sidecar answered ${r.status}`);
  }
  return (await r.json()) as Health;
}
