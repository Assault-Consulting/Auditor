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
  verifyChain,
} from "./chain";
import type {
  AnchorSourceSpec,
  SessionResponse,
  VerificationResponse,
} from "./generated/types";
import type { Session } from "./session";

export type ChainState =
  /** Nothing chosen. The honest starting point, not an error. */
  | { kind: "empty" }
  /** A path was chosen and the sidecar has not answered yet. */
  | { kind: "opening"; path: string }
  /** Open. Identity established; nothing said about whether it verifies. */
  | { kind: "open"; opened: SessionResponse }
  /** A check is running against a named profile. Still open, still known. */
  | { kind: "verifying"; opened: SessionResponse; profile: string }
  /**
   * Checked. The answer is the verifier's; this state only carries it.
   *
   * `sources` is the profile as configured, kept alongside the result
   * because the result cannot supply it: resolution stops at the first
   * source that answers, so the ones after it are absent from
   * `anchor_attempts` entirely. Without the configured list there is no way
   * to tell a source that was empty from one nobody asked.
   */
  | {
      kind: "verified";
      opened: SessionResponse;
      profile: string;
      sources: AnchorSourceSpec[];
      result: VerificationResponse;
    }
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
  const previouslyOpen = openedOf(previous);
  if (previouslyOpen !== null) {
    await closeChain(session, previouslyOpen.session_id).catch(() => undefined);
  }

  onState({ kind: "opening", path });

  try {
    onState({ kind: "open", opened: await openChain(session, path) });
  } catch (err) {
    onState(describe(err, path));
  }
}

/**
 * Ask the verifier about an open chain.
 *
 * Deliberately a separate action from opening. Identity is established
 * first and on its own, so a reader can confirm they hold the same bytes a
 * check ran against **whether or not that check passed** — and so someone
 * can look at what a file is without being handed a verdict they did not
 * ask for.
 *
 * `verifying` and `verified` both carry `opened`, so the subject never
 * disappears while a check runs and never has to be re-fetched afterwards.
 * A screen that loses what the file is while asking about it would make the
 * separation above pointless in practice.
 *
 * `sources` is the profile as the user configured it, and it is passed in
 * rather than read back from the result because the result does not contain
 * it — see the note on the `verified` state.
 */
export async function verifyOpen(
  session: Session,
  state: ChainState,
  profile: string,
  sources: AnchorSourceSpec[],
  onState: (state: ChainState) => void,
): Promise<void> {
  const opened = openedOf(state);
  if (opened === null) return;

  onState({ kind: "verifying", opened, profile });

  try {
    const result = await verifyChain(session, opened.session_id, profile);
    onState({ kind: "verified", opened, profile, sources, result });
  } catch (err) {
    // A changed subject is not a failed verification. It means nothing on
    // screen describes the file any more, including the identity block, so
    // the state drops `opened` rather than keeping a subject that is no
    // longer about anything.
    onState(describe(err, opened.subject.path));
  }
}

/** The open session behind a state, when there is one. */
export function openedOf(state: ChainState): SessionResponse | null {
  switch (state.kind) {
    case "open":
    case "verifying":
    case "verified":
      return state.opened;
    default:
      return null;
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
    case "verifying":
      return `${state.opened.subject.filename} — checking against anchor profile "${state.profile}"…`;
    case "verified": {
      const s = state.opened.subject;
      // The line stays about the artifact. What the check found belongs in
      // the panels, where each question keeps its own answer — summarising
      // it here would be the single verdict field this API refuses to have.
      return `${s.filename} — ${s.records} records, ${s.boots} boots. Checked against "${state.profile}".`;
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
