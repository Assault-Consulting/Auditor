// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The anchor chain, laid out as it was actually walked.
 *
 * `AnchorSource` resolution is availability-first: the sources are tried in
 * the user's order and the first that answers wins. L2 says a completeness
 * claim is worth exactly as much as the anchor behind it, which is why the
 * verification response carries **every source consulted**, not only the one
 * that answered.
 *
 * This module adds the part the response cannot carry.
 *
 * Resolution stops at the first answer, so sources *after* it never appear
 * in `anchor_attempts` at all — a three-source profile whose second source
 * answers reports two attempts. Checked against the sidecar rather than
 * assumed. To an operator who put the keychain third, "nothing about the
 * keychain" and "the keychain was empty" look identical, and they are not
 * the same situation: one means the store had no head, the other means
 * nobody asked it. So the profile's own source list is folded in and the
 * unreached links are shown as unreached.
 */

import type { AnchorAttemptModel, AnchorSourceSpec } from "./generated/types";

export type LinkOutcome =
  /** This source answered, and its head is what the check used. */
  | "answered"
  /** Consulted; it holds nothing. Normal, and not a failure. */
  | "absent"
  /** Consulted; it exists and could not be read. */
  | "error"
  /** Never consulted — an earlier source had already answered. */
  | "not-reached";

export interface ProvenanceLink {
  /** Position in the user's order, from 1. */
  order: number;
  kind: string;
  /** Which particular source — a path, an account, free text. */
  detail: string;
  outcome: LinkOutcome;
  /** Our sentence about this link. */
  note: string;
  /** The sidecar's own words, when it produced any. Never rewritten. */
  error?: string;
}

/** A source spec rendered as the one line that identifies it. */
function detailOf(spec: AnchorSourceSpec): string {
  // `detail` is optional in the schema because the server defaults it, so a
  // client cannot assume it arrived. tsc caught the assumption; the empty
  // string and the missing field mean the same thing here and are treated
  // as one.
  const free = spec.detail ?? "";
  switch (spec.kind) {
    case "file":
      return spec.path ?? "(no path)";
    case "keychain":
      return `keychain account ${spec.account ?? "(unnamed)"}`;
    case "manual":
      return free !== "" ? free : "a head entered by hand";
    default:
      return free !== "" ? free : spec.kind;
  }
}

function noteFor(outcome: LinkOutcome, kind: string): string {
  switch (outcome) {
    case "answered":
      return "Answered. This is the head the check was made against.";
    case "absent":
      // Absent is normal. A sentence that made it sound like a fault would
      // send an operator to fix a source that is working as configured.
      return "Nothing stored here.";
    case "error":
      return "Could not be read.";
    case "not-reached":
      return `Not consulted — an earlier source had already answered, so the ${kind} source was never asked.`;
  }
}

/**
 * The links, in the user's order, including the ones never reached.
 *
 * `sources` is the profile as configured. Pass an empty list when it is not
 * known — the attempts alone still render correctly, they just cannot show
 * what was never tried.
 */
export function provenance(
  attempts: AnchorAttemptModel[],
  sources: AnchorSourceSpec[] = [],
): ProvenanceLink[] {
  const links: ProvenanceLink[] = attempts.map((a, i) => ({
    order: i + 1,
    kind: a.source_kind,
    detail: a.source_detail,
    outcome: a.outcome as LinkOutcome,
    note: noteFor(a.outcome as LinkOutcome, a.source_kind),
    ...(a.error !== null ? { error: a.error } : {}),
  }));

  // Anything the profile lists beyond what was tried was never reached.
  // Positional rather than matched by identity: resolution walks the list in
  // order and stops, so the untried tail is exactly the tail.
  for (let i = attempts.length; i < sources.length; i += 1) {
    const spec = sources[i];
    if (spec === undefined) continue;
    links.push({
      order: i + 1,
      kind: spec.kind,
      detail: detailOf(spec),
      outcome: "not-reached",
      note: noteFor("not-reached", spec.kind),
    });
  }

  return links;
}

/**
 * One line for the whole chain, for a screen that has room for one.
 *
 * Never reduces to the answering source alone. Presenting that as "the"
 * anchor while silently skipping one the operator believed was
 * authoritative is the failure L2 is written against.
 */
export function provenanceSummary(links: ProvenanceLink[]): string {
  if (links.length === 0) return "No anchor sources were configured.";

  const answered = links.find((l) => l.outcome === "answered");
  const errors = links.filter((l) => l.outcome === "error").length;
  const absent = links.filter((l) => l.outcome === "absent").length;

  const parts: string[] = [];
  if (answered !== undefined) {
    parts.push(`answered by ${answered.kind} (${answered.detail})`);
  } else {
    parts.push("no source answered");
  }
  if (absent > 0) parts.push(`${absent} empty`);
  // Errors are named even when something later answered. A source that
  // could not be read is a thing to fix, whether or not the check succeeded
  // without it.
  if (errors > 0) parts.push(`${errors} could not be read`);

  return `${links.length} ${links.length === 1 ? "source" : "sources"}: ${parts.join(", ")}.`;
}
