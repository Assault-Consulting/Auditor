// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * What the application knows about the chain in front of it.
 *
 * A state machine rather than a bag of booleans, because the states here are
 * mutually exclusive and the interesting ones are the failures. A component
 * holding `{ loading, error, subject }` can render "loading" and an error at
 * once, or show a stale subject beside a fresh failure — and the second of
 * those is the one that matters: a subject left on screen after the file
 * changed underneath it is the application asserting something it no longer
 * knows.
 *
 * Kept out of the component so it can be tested without rendering anything.
 */

import {
  NotAChainError,
  SidecarError,
  SubjectChangedError,
  closeChain,
  openChain,
} from "./chain";
import type { SessionResponse } from "./generated/types";
import type { Session } from "./session";

export type ChainState =
  /** Nothing chosen. The honest starting point, not an error. */
  | { kind: "empty" }
  /** A path was chosen and the sidecar has not answered yet. */
  | { kind: "opening"; path: string }
  /** Open. Identity established; nothing said about whether it verifies. */
  | { kind: "open"; opened: SessionResponse }
  /** The bytes are not a container. Distinct from a chain that fails. */
  | { kind: "not-a-chain"; path: string; detail: string }
  /** The file moved under us. Whatever was on screen is no longer about it. */
  | { kind: "subject-changed"; detail: string }
  /** Anything else the sidecar said, with its own words. */
  | { kind: "failed"; detail: string };

/**
 * Open `path`, replacing whatever was open before.
 *
 * The previous session is closed first, and failures in that close are
 * ignored: the user asked for a new chain, and refusing to give them one
 * because the old one would not let go is answering the wrong question. The
 * consequence is a leaked session in the sidecar, which dies with the
 * window — a bounded cost, unlike a stuck application.
 */
export async function openPath(
  session: Session,
  previous: ChainState,
  path: string,
  onState: (state: ChainState) => void,
): Promise<void> {
  if (previous.kind === "open") {
    await closeChain(session, previous.opened.session_id).catch(() => undefined);
  }

  onState({ kind: "opening", path });

  try {
    onState({ kind: "open", opened: await openChain(session, path) });
  } catch (err) {
    onState(describe(err, path));
  }
}

/**
 * Turn a client error into a state.
 *
 * Every branch keeps the sidecar's own sentence. Rewriting it here would
 * mean the screen says something the service did not, which is the same
 * mistake as replacing a verifier's narrative with our own.
 */
export function describe(err: unknown, path: string): ChainState {
  if (err instanceof NotAChainError) {
    return { kind: "not-a-chain", path, detail: err.message };
  }
  if (err instanceof SubjectChangedError) {
    return { kind: "subject-changed", detail: err.message };
  }
  if (err instanceof SidecarError) {
    return { kind: "failed", detail: `${err.message} (HTTP ${err.status})` };
  }
  return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
}

/**
 * The line the screen shows for a state.
 *
 * Here rather than in the component so the wording is testable. Wording is
 * a correctness concern in this product: `docs/API.md` and L4 both say the
 * tool describes rather than accuses, and a sentence is the easiest place
 * for that to slip.
 */
export function chainLine(state: ChainState): string {
  switch (state.kind) {
    case "empty":
      return "No chain open. Nothing on this screen is a verification result.";
    case "opening":
      return `Opening ${state.path}…`;
    case "open": {
      const s = state.opened.subject;
      return `${s.filename} — ${s.records} records, ${s.boots} boots. Not verified yet.`;
    }
    case "not-a-chain":
      // Not "invalid", and not "corrupt". The file is not a container; that
      // says nothing about whether anyone did anything to it.
      return `${state.path} is not a PALA-1 container: ${state.detail}`;
    case "subject-changed":
      return `The file changed since it was opened, so nothing here describes it any more: ${state.detail}`;
    case "failed":
      return `The sidecar could not answer: ${state.detail}`;
  }
}
