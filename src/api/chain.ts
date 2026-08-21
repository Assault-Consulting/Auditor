// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The typed client for the sidecar's chain endpoints.
 *
 * Every response shape here comes from `./generated/types`, which is
 * generated from the sidecar's OpenAPI schema and diffed by CI. A response
 * model changing shape is a compile error in this file rather than a field
 * that renders empty.
 *
 * The work this module actually does is **turning status codes into named
 * outcomes**. `docs/API.md` explains why each code was chosen; the point of
 * repeating the mapping here is that a caller should never write
 * `if (response.status === 409)`. A number in a component is a number
 * somebody will eventually compare against the wrong one.
 */

import type {
  SessionResponse,
  VerificationResponse,
} from "./generated/types";
import type { Session } from "./session";

/** The path resolved and the bytes are not a PALA-1 container (422). */
export class NotAChainError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NotAChainError";
  }
}

/**
 * The file changed under an open session (409).
 *
 * Deliberately its own type. A verdict about bytes that have since changed
 * is worse than no verdict, so a caller must be unable to fold this into a
 * generic failure and carry on displaying the previous answer.
 */
export class SubjectChangedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SubjectChangedError";
  }
}

/** No such session, or no such anchor profile (404). */
export class NotFoundError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NotFoundError";
  }
}

/** The sidecar refused the token (401), or answered in a way we do not model. */
export class SidecarError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "SidecarError";
    this.status = status;
  }
}

function url(session: Session, path: string): string {
  return `http://127.0.0.1:${session.port}${path}`;
}

function headers(session: Session): HeadersInit {
  return {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
}

async function detailOf(response: Response): Promise<string> {
  // The sidecar answers errors as {"detail": "..."}. Falling back to the
  // status text rather than throwing here: a client that fails while
  // reporting a failure tells the user nothing about either.
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : response.statusText;
  } catch {
    return response.statusText;
  }
}

async function raise(response: Response): Promise<never> {
  const detail = await detailOf(response);
  switch (response.status) {
    case 404:
      throw new NotFoundError(detail);
    case 409:
      throw new SubjectChangedError(detail);
    case 422:
      throw new NotAChainError(detail);
    default:
      throw new SidecarError(response.status, detail);
  }
}

/**
 * Open a container and learn what it is.
 *
 * Says nothing about whether the chain verifies — that is a separate call,
 * so that identity can be established whether or not the check passes.
 */
export async function openChain(
  session: Session,
  path: string,
): Promise<SessionResponse> {
  const response = await fetch(url(session, "/session"), {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ path }),
  });
  if (!response.ok) await raise(response);
  return (await response.json()) as SessionResponse;
}

/**
 * Ask the verifier about an open session.
 *
 * `profile` names an anchor profile. The default asks question one only and
 * leaves question two not checked, which is an answer rather than a failure.
 *
 * The profile is percent-encoded rather than pasted into the query. A
 * profile named `desk &co` is legal, and pasting it would truncate the query
 * string — verifying against a different profile than the one asked for,
 * whose "not checked" result would look identical to a legitimate one.
 */
export async function verifyChain(
  session: Session,
  sessionId: string,
  profile = "none",
): Promise<VerificationResponse> {
  const response = await fetch(
    url(session, `/session/${sessionId}/verify?profile=${encodeURIComponent(profile)}`),
    { headers: headers(session) },
  );
  if (!response.ok) await raise(response);
  return (await response.json()) as VerificationResponse;
}

/**
 * Release a session.
 *
 * A 404 here is swallowed on purpose: closing something already closed is
 * the caller getting what they asked for, and surfacing it would make every
 * cleanup path write an exception handler that does nothing.
 */
export async function closeChain(
  session: Session,
  sessionId: string,
): Promise<void> {
  const response = await fetch(url(session, `/session/${sessionId}`), {
    method: "DELETE",
    headers: headers(session),
  });
  if (!response.ok && response.status !== 404) await raise(response);
}
