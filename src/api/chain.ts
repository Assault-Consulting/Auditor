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
  AnchorProfile,
  BootView,
  RecordView,
  SessionResponse,
  SpanView,
  Timeline,
  VerificationResponse,
} from "./generated/types";
import type { Session } from "./session";

/**
 * The sidecar refused the request's parameters (422).
 *
 * Distinct from NotAChainError even though the status is the same, because
 * the two send a reader to different places. "This file is not a PALA-1
 * container" is about the evidence; "there is no axis called monotonic" is
 * about the request. Collapsing them would have made a mistyped query
 * parameter report that the operator's file was unreadable.
 *
 * The status shared two meanings the moment /timeline gained its refusals.
 * Nothing failed — 422 is 422 — which is why the mapping had to be split
 * here rather than left to be noticed by whoever saw the wrong message.
 */
export class RefusedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RefusedError";
  }
}

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

/**
 * Turn a failed response into a named outcome.
 *
 * `unprocessable` says what a 422 means *for this call*, because the status
 * carries two meanings on this surface: opening a container answers 422 when
 * the bytes are not a chain, and a browse endpoint answers 422 when the
 * parameters were refused. A caller of one must not receive the other's
 * error type — the message it produces would send someone to inspect a file
 * that is perfectly fine.
 */
async function raise(
  response: Response,
  unprocessable: (detail: string) => Error = (d) => new NotAChainError(d),
): Promise<never> {
  const detail = await detailOf(response);
  switch (response.status) {
    case 404:
      throw new NotFoundError(detail);
    case 409:
      throw new SubjectChangedError(detail);
    case 422:
      throw unprocessable(detail);
    default:
      throw new SidecarError(response.status, detail);
  }
}

/**
 * Every anchor profile this sidecar knows, including the empty one.
 *
 * `none` is always present and is a real profile: it asks question one and
 * leaves question two not checked. A chooser that filtered it out would make
 * "verify without an anchor" look unavailable rather than default.
 */
export async function listProfiles(session: Session): Promise<AnchorProfile[]> {
  const response = await fetch(url(session, "/anchors/profiles"), {
    headers: headers(session),
  });
  if (!response.ok) await raise(response);
  return (await response.json()) as AnchorProfile[];
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
 * Record density along one axis.
 *
 * `axis` defaults to proved order because that is what the chain
 * establishes; wall time is a claim and is opt-in (L3).
 *
 * `align: "day"` makes each bucket one UTC calendar day, which is what the
 * date rail needs and what a uniform timeline cannot give it: a uniform
 * bucket of roughly a day straddles midnight, so a record just after one
 * would be labelled with the previous date. The sidecar refuses the
 * combination with `axis: "seq"` rather than dropping the alignment — a
 * sequence number has no calendar, and returning uniform buckets marked
 * `align: "day"` would be worse than refusing.
 */
export async function chainTimeline(
  session: Session,
  sessionId: string,
  options: { axis?: "seq" | "wall"; buckets?: number; align?: "day" } = {},
): Promise<Timeline> {
  const query = new URLSearchParams({ axis: options.axis ?? "seq" });
  if (options.buckets !== undefined) query.set("buckets", String(options.buckets));
  if (options.align !== undefined) query.set("align", options.align);

  const response = await fetch(
    url(session, `/session/${sessionId}/timeline?${query}`),
    { headers: headers(session) },
  );
  // A 422 here is about the query, not about the file — see RefusedError.
  if (!response.ok) await raise(response, (d) => new RefusedError(d));
  return (await response.json()) as Timeline;
}

/**
 * The boots in this container, and the spans.
 *
 * Two calls rather than one, because they are two questions and the sidecar
 * answers them separately — and because a screen that could show boots would
 * otherwise be blocked by a span list it does not need.
 *
 * Browsing consults no verdict. A chain that fails verification is still
 * browsed: inspecting evidence that did not pass is half of what this tool
 * is for, so a failed check must not close the lists.
 */
export async function chainBoots(
  session: Session,
  sessionId: string,
): Promise<BootView[]> {
  const response = await fetch(url(session, `/session/${sessionId}/boots`), {
    headers: headers(session),
  });
  // A 422 on a browse endpoint is about the request, not about the file.
  if (!response.ok) await raise(response, (d) => new RefusedError(d));
  return (await response.json()) as BootView[];
}

export async function chainSpans(
  session: Session,
  sessionId: string,
): Promise<SpanView[]> {
  const response = await fetch(url(session, `/session/${sessionId}/spans`), {
    headers: headers(session),
  });
  if (!response.ok) await raise(response, (d) => new RefusedError(d));
  return (await response.json()) as SpanView[];
}

/**
 * One record by sequence number.
 *
 * `NotFoundError` here means what it says on this endpoint specifically:
 * this container holds no such record — a segment covering 400–900 legitimately
 * has no record 12. That is a fact about the file's range, not about the
 * session, and a caller must not read it as "the chain is gone" the way a
 * 404 on `/session/{id}` itself would mean.
 */
export async function getRecord(
  session: Session,
  sessionId: string,
  seq: number,
): Promise<RecordView> {
  const response = await fetch(url(session, `/session/${sessionId}/record/${seq}`), {
    headers: headers(session),
  });
  if (!response.ok) await raise(response);
  return (await response.json()) as RecordView;
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
