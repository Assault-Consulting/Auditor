// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0
//
// GENERATED FILE — do not edit.
//
// Produced by scripts/generate_api_client.py from the sidecar's OpenAPI
// schema. CI regenerates this and fails on any difference, so an edit here
// is reverted by the next run rather than merged.
//
// To change these types, change the response model in
// sidecar/auditor_sidecar/models.py and run:
//
//     python scripts/generate_api_client.py

/**
 * One thing worth a human's attention that changes no verdict.
 */
export interface AdvisoryItemModel {
  /** Stable key, e.g. mono_regression_in_boot. */
  code: string;
  /** Where, when the item has a location. */
  at_seq: number | null;
  /** Hex boot identifier, when scoped to one. */
  boot_id: string | null;
  /** The package's description of this item. */
  detail: string | null;
}

/**
 * The advisory channel, carried apart from the verdict on purpose.
 */
export interface AdvisoryModel {
  /** How many items. */
  count: number;
  /** The items themselves. */
  items: Array<AdvisoryItemModel>;
  /** Carried in the payload rather than left to the UI. A consumer that receives advisory items beside chain_ok will eventually treat them as part of it. */
  note?: string;
}

/**
 * Question one: is what I hold internally consistent?
 *
 * Always answerable. It needs no key and no anchor — only the bytes in
 * front of it — which is why it is the one question a chain can never
 * decline to answer.
 */
export interface ChainResult {
  /** Whether every record links to its predecessor. */
  chain_ok: boolean;
  /** Records the verifier walked. */
  count: number;
  /** Hex digest of the last record in the chain. */
  head: string;
  /** Sequence numbers where prev_hash does not name the predecessor. */
  breaks: Array<number>;
  /** Skipped sequence numbers. A gap is a break whether or not the hashes on either side happen to link. */
  gaps: Array<number>;
  /** (seq, reason) pairs for normative MUSTs the record broke. Kept as pairs: a seq without its reason is a number nobody can act on. */
  violations: Array<Array<unknown>>;
  /** Records with an unknown format version or record type. Chain-checked and reported, never rejected — the verifier not understanding a record is not the same as the record being wrong. */
  uninterpretable: Array<number>;
}

/**
 * What the container *is*, stated before any verdict about it.
 *
 * Separate from the verification result on purpose: a reader of a report
 * must be able to confirm they are holding the same artifact the check ran
 * against, independently of whether that check passed.
 */
export interface ChainSubject {
  /** The file's name, for display only. */
  filename: string;
  /** Absolute path as opened. */
  path: string;
  /** File size on disk, in bytes. */
  bytes: number;
  /** SHA-256 of the file as opened. Identifies the artifact; a report naming only a filename identifies nothing. */
  sha256: string;
  /** Number of records the reader found. */
  records: number;
  /** Lowest sequence number present. */
  first_seq: number | null;
  /** Highest sequence number present. */
  last_seq: number | null;
  /** Distinct boot identifiers present. */
  boots: number;
  /** Distinct spans present. */
  spans: number;
}

/**
 * Question two: is what I hold all of it?
 *
 * The only question that can go unasked, and the answer must say so.
 */
export interface Completeness {
  /** True, False, or null. Null means NO ANCHOR WAS SUPPLIED and the question was never asked — it is not a pass and must never be rendered as one. */
  complete_to_anchor: boolean | null;
  /** Records present beyond the anchored head, when there are any. */
  anchor_lag: number | null;
  /** The verifier's sentence explaining an incomplete answer. */
  anchor_reason: string | null;
}

/**
 * What the failure looks like, rather than that there was one.
 *
 * The pattern is the machine-readable part and a consumer may key visuals
 * off it. The narrative is the package's own sentence, carried verbatim:
 * a shell may show a localised sentence beside it, never instead of it, or
 * the report stops saying what the verifier said.
 */
export interface DiagnosisModel {
  /** One of: truncated_tail, prefix_absent, seq_gap, chain_break, record_violation, unanchored_tail, replaced_or_rolled_back. */
  pattern: string;
  /** Where, when the pattern has a location. */
  at_seq: number | null;
  /** What the verifier expected to find. */
  expected: string | null;
  /** The verifier's own description, verbatim. */
  narrative: string;
}

export interface HTTPValidationError {
  detail?: Array<ValidationError>;
}

/**
 * Liveness, and the identity of the verifier behind this service.
 *
 * The verifier identity is part of the liveness answer rather than a
 * separate endpoint because a verification result is only meaningful
 * alongside the verifier that produced it. A shell that knows the service is
 * up but not what it is linked against knows less than it needs.
 */
export interface HealthResponse {
  /** 'ok' when the service is serving. */
  status: string;
  /** Version of this sidecar. */
  version: string;
  /** The verifier package and version, e.g. 'palimpsests 0.8.0'. */
  package: string;
  /** The wire format the linked verifier implements, e.g. 'PALA-1 format_version 1'. */
  spec: string;
  /** Whether the session token gate is enforced. False means the sidecar was started without a token and any local process can reach it — a development affordance, never a supported configuration. */
  authenticated: boolean;
}

/**
 * Open a container.
 */
export interface SessionRequest {
  /** Absolute path to a .pala container. */
  path: string;
}

/**
 * A session over one open container.
 */
export interface SessionResponse {
  /** Opaque handle for subsequent calls. */
  session_id: string;
  /** What this session is about. */
  subject: ChainSubject;
  /** The verifier package and wire format behind this session. Carried on the session rather than fetched separately, because a result is only meaningful alongside the verifier that produced it. */
  verifier: Record<string, string>;
}

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

/**
 * The verifier's answer, passed through rather than summarised.
 *
 * There is deliberately no single "valid" field. The three questions have
 * three separate answers, one of which can be "not asked", and any field
 * that collapsed them would be the shell deciding what a verdict means.
 */
export interface VerificationResponse {
  /** The session this answer is about. */
  session_id: string;
  /** Digest of the file this answer describes. Repeated here so a verification result cannot be separated from its subject. */
  subject_sha256: string;
  /** Package and wire format behind it. */
  verifier: Record<string, string>;
  chain: ChainResult;
  completeness: Completeness;
  /** Present only when something failed. */
  diagnosis: DiagnosisModel | null;
  advisory: AdvisoryModel;
}
