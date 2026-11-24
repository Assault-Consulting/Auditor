// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * An external witness: a SCITT Signed Statement about this chain (E-06).
 *
 * An issuer publishes one digest — the chain's head, and in a v3 statement
 * the derived root over every record up to it — signed under its key. The
 * package's `verify_statement` (channel 8) checks it; this module asks and
 * words the answer. Displayed, never minted: Auditor signs and registers
 * nothing. And receipts are not checked — whether a transparency service
 * registered a statement is that service's protocol, not the package's.
 *
 * A refusal names the check that failed, never a cause: a statement for
 * another chain, a corrupted download and a forgery are all refused.
 */

import { invoke } from "@tauri-apps/api/core";

import type { StatementCheckView } from "./generated/types";
import { NoShellError, type Session } from "./session";

export const SCITT_NOTE =
  "A statement someone published about this chain — its head, and in a v3 statement the root over every record up to it — signed under their key. Checked against a key you choose: the key is what you trust, so it is yours to pick. A statement says the chain had this head when it was signed, by whoever holds that key. Whether a transparency service registered it is that service's receipt, not checked here.";

/**
 * Each refusal code the package has, in a few words — the check that failed.
 * The package's own sentence is shown beside it. Held to the package's
 * `STATEMENT_REFUSAL_CODES` by vocabulary.test.ts.
 */
export const REFUSAL_WORDING: Record<string, string> = {
  chain_too_short: "this chain is shorter than the statement's range",
  content_type_unknown: "not a statement construction the package knows",
  detached_payload: "the payload is not inside the statement",
  format_id_mismatch: "not a statement about a PALA-1 chain",
  head_mismatch: "it commits to another head than this chain has there",
  indefinite_length_map: "written in a CBOR form the package does not accept",
  key_type_mismatch: "the key is not of the type its algorithm needs",
  non_deterministic_encoding: "not in the one encoding the package accepts",
  not_cose_sign1: "not a COSE_Sign1 statement",
  payload_keys_mismatch: "its payload does not hold what its construction says",
  payload_malformed: "its payload cannot be read",
  protected_header_malformed: "its signed header cannot be read",
  protected_labels_mismatch: "its signed header holds other labels than the construction's",
  range_invalid: "the range it reports is not a range",
  repeated_key: "a key appears twice in one of its maps",
  root_malformed: "its root is not 32 bytes",
  root_mismatch: "its root is not this chain's root over the same records",
  signature_invalid: "the signature does not verify under this key",
  trailing_bytes: "bytes follow the statement, outside what was signed",
  unprotected_header_malformed: "its unsigned header cannot be read",
  unsupported_alg: "signed with an algorithm the package does not verify",
};

export const KNOWN_REFUSALS: readonly string[] = Object.keys(REFUSAL_WORDING);

export interface StatementAnswer {
  accepted: boolean;
  lines: string[];
}

export function statementAnswer(c: StatementCheckView): StatementAnswer {
  if (!c.accepted) {
    const code = c.code ?? "unknown";
    const words = REFUSAL_WORDING[code] ?? code;
    return {
      accepted: false,
      lines: [
        `Not accepted: ${words} (${code}).`,
        ...(c.detail ? [`The verifier: “${c.detail}”`] : []),
        "A refusal names the check that failed, not why — a statement about another chain, a damaged file and one signed with another key are refused alike.",
      ],
    };
  }
  const at = c.checked_at_seq;
  const range = c.first_seq !== null && c.last_seq !== null ? ` (it reports #${c.first_seq}–#${c.last_seq})` : "";
  const root =
    c.root_status === "recomputed"
      ? ` Its root over records #0–#${c.last_seq} was recomputed here and matches.`
      : c.root_status === "carried, not recomputed"
        ? " It carries a root, not recomputed here."
        : "";
  const grown =
    at !== null && at < c.records_here - 1
      ? ` The chain has grown since: it now holds ${c.records_here} records.`
      : "";
  return {
    accepted: true,
    lines: [
      `Accepted: signed under this key, committing to this chain's head at #${at}${range}, a ${c.version} statement.${root}${grown}`,
      `Statement id ${String(c.statement_id).slice(0, 16)}… — what to refer to it by.`,
    ],
  };
}

export async function checkStatement(
  session: Session,
  sessionId: string,
  statementPath: string,
  keyPath: string,
): Promise<StatementCheckView> {
  const r = await fetch(`http://127.0.0.1:${session.port}/session/${sessionId}/scitt/check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ statement_path: statementPath, key_path: keyPath }),
  });
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const b = (await r.json()) as { detail?: unknown };
      if (typeof b.detail === "string") detail = b.detail;
    } catch {
      /* the status says it */
    }
    throw new Error(detail);
  }
  return (await r.json()) as StatementCheckView;
}

/** The statement, then the key. `null` is a cancelled dialog. */
export async function pickStatementAndKey(): Promise<{ statement: string; key: string } | null> {
  try {
    const statement = await invoke<string | null>("pick_signed_statement");
    if (statement === null) return null;
    const key = await invoke<string | null>("pick_public_key");
    return key === null ? null : { statement, key };
  } catch {
    throw new NoShellError();
  }
}
