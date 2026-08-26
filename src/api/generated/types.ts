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
 * One source that was consulted, and what came back.
 */
export interface AnchorAttemptModel {
  /** 'manual', 'file' or 'keychain'. */
  source_kind: string;
  /** Which one — a path, or free text. */
  source_detail: string;
  /** 'answered', 'absent' or 'error'. Three states, never two: absent is normal, error is a source that exists and could not be read, and merging them would hide a corrupt anchor file behind 'no anchor configured'. */
  outcome: string;
  /** Why, when the outcome is 'error'. */
  error: string | null;
}

/**
 * An ordered list of places to look for a trusted head.
 *
 * Order is meaningful and is the user's: the first source that answers wins,
 * and the ones before it are reported as tried. That is why resolution is
 * availability-first — a source that errors does not stop the walk — and why
 * the provenance view has to show what was skipped rather than only what
 * answered.
 */
export interface AnchorProfile {
  /** Profile name, used as the verify parameter. */
  name: string;
  /** Tried in order; the first that answers is used. */
  sources: Array<AnchorSourceSpec>;
}

/**
 * The head that answered, and where it came from.
 */
export interface AnchorReadingModel {
  /** Which kind of source answered. */
  source_kind: string;
  /** Which particular one. */
  source_detail: string;
  /** When the source was read. */
  observed_at_ns: number | null;
  /** The hex head this check was made against. */
  head: string;
}

/**
 * One place a trusted head might live.
 *
 * The shell owns the concrete sources; the package owns what a head means
 * (L2). A spec is therefore plain data — no package type appears in a
 * request model.
 */
export interface AnchorSourceSpec {
  /** 'manual', 'file' or 'keychain'. */
  kind: string;
  /** For kind='manual': the 64-character hex head, as handed over. */
  head?: string | null;
  /** For kind='file': path to a FileAnchor head file. */
  path?: string | null;
  /** For kind='keychain': the account name the head is stored under. The service name is fixed by the application, so this is the only part an operator chooses. */
  account?: string | null;
  /** Free text shown beside this source in the provenance view. */
  detail?: string;
}

/**
 * Question one, first half: do these records link to each other?
 *
 * Always answerable. It needs no key and no anchor — only the bytes in
 * front of it — which is why it is the one question a chain can never
 * decline to answer.
 *
 * **It is a header walk.** Whether each record still *is* the bytes its
 * header claims is a separate question, answered by
 * :class:`ContainerCheck`. A consumer that renders `chain_ok` alone will
 * show a sound file when a body has been swapped.
 */
export interface ChainResult {
  /** Whether every record header links to its predecessor. Headers only — see ContainerCheck.body_digest_mismatches for whether the bodies still match their digests. */
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
  /** Every assurance tier the chain's records carry, not just the latest. More than one means the platform guarantee changed mid-chain, and the verdict wording cannot then be a single sentence — so the set is reported rather than reduced. */
  assurance_tiers: Array<NamedValue>;
  /** Every wall-clock trust level the chain's records carry. More than one means the writer's clock changed status mid-chain, which qualifies every wall-time claim in the file. */
  time_trust_values: Array<NamedValue>;
}

/**
 * Question two: is what I hold all of it?
 *
 * The only question that can go unasked, and the answer must say so.
 */
export interface Completeness {
  /** True, False, or null. Null means NO ANCHOR ANSWERED — either none was configured, or every source in the profile was absent — so the question was never asked. It is not a pass and must never be rendered as one. */
  complete_to_anchor: boolean | null;
  /** Records present beyond the anchored head, when there are any. */
  anchor_lag: number | null;
  /** The verifier's sentence explaining an incomplete answer. */
  anchor_reason: string | null;
}

/**
 * Whether each record is the bytes its own header claims.
 *
 * A different question from the one `ChainResult` answers. The chain is
 * about how records link to each other; this is about whether a record's
 * body still hashes to the `body_digest` its header carries.
 *
 * `AuditReader.verify()` does not perform this comparison — that is by
 * design, and it is why verification needs no keys. The walk comes from the
 * package's report builder, so the shell never decides what a body digest
 * means.
 */
export interface ContainerCheck {
  /** Whether the container parsed end to end as PALA-1. */
  well_formed: boolean;
  /** The parser's sentence, when it could not finish. */
  malformed: string | null;
  /** Bytes the parser consumed. */
  bytes_parsed: number;
  /** Bytes in the file. */
  bytes_total: number;
  /** Sequence numbers whose body does not hash to the digest their header carries. NON-EMPTY MEANS THE HEADER CHAIN CAN STILL BE INTACT — a swapped body leaves every link verifying, so a consumer that renders chain_ok alone would show a sound file. The answer to 'is what I hold internally consistent?' requires this list to be empty as well. */
  body_digest_mismatches: Array<number>;
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
 * Store a head in the secret store under an account name.
 */
export interface KeychainSeedRequest {
  /** Account name to store it under. */
  account: string;
  /** The 64-character hex head. */
  head: string;
}

/**
 * Whether this machine has a usable secret store at all.
 */
export interface KeychainStatus {
  /** False means there is nowhere on this machine to keep an anchor — a headless box with no Secret Service, a session without credentials, or the keyring extra not installed. Distinct from 'your anchor was not found', and a UI that conflates the two sends the operator to look for a value that could never have been read. */
  available: boolean;
  /** What to do about it, when there is something to do. */
  detail: string;
}

/**
 * A header enum value, with the package's name for it.
 *
 * Both halves travel. The name is what a person reads; the number is what
 * survives a name table changing and what can be checked against the
 * specification. `name` is null when this verifier build has no name for
 * the value — which is a real answer, and better than a label invented to
 * fill the gap.
 */
export interface NamedValue {
  /** The raw header value. */
  value: number;
  /** The package's name, or null if this build does not know it. */
  name: string | null;
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
  /** The body-digest walk. Required rather than optional: a response that could omit it would let a consumer answer question one from the header chain alone. */
  container: ContainerCheck;
  completeness: Completeness;
  /** The source that answered, or null when none did. A completeness answer is worth exactly as much as the anchor behind it, so the two are never separated. */
  anchor: AnchorReadingModel | null;
  /** Every source consulted, in order, including those that were absent or failed. The answering source alone would let a UI present it as 'the' anchor while silently skipping a source the operator believed was authoritative. */
  anchor_attempts: Array<AnchorAttemptModel>;
  /** Present only when something failed. */
  diagnosis: DiagnosisModel | null;
  advisory: AdvisoryModel;
}
