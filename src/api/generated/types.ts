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
