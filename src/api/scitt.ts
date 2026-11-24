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

import { t } from "../i18n";
import type { StatementCheckView } from "./generated/types";
import { count } from "./plural";
import { NoShellError, type Session } from "./session";

export const scittNote = (): string => t("scitt.note");

/**
 * Each refusal code the package has; its words are the catalogs'
 * (`scitt.refusal.<code>`) — the check that failed, beside the package's
 * own sentence. Held to the package's `STATEMENT_REFUSAL_CODES` by
 * vocabulary.test.ts.
 */
export const KNOWN_REFUSALS: readonly string[] = [
  "chain_too_short",
  "content_type_unknown",
  "detached_payload",
  "format_id_mismatch",
  "head_mismatch",
  "indefinite_length_map",
  "key_type_mismatch",
  "non_deterministic_encoding",
  "not_cose_sign1",
  "payload_keys_mismatch",
  "payload_malformed",
  "protected_header_malformed",
  "protected_labels_mismatch",
  "range_invalid",
  "repeated_key",
  "root_malformed",
  "root_mismatch",
  "signature_invalid",
  "trailing_bytes",
  "unprotected_header_malformed",
  "unsupported_alg",
];

export interface StatementAnswer {
  accepted: boolean;
  lines: string[];
}

export function statementAnswer(c: StatementCheckView): StatementAnswer {
  if (!c.accepted) {
    const code = c.code ?? "unknown";
    const words = KNOWN_REFUSALS.includes(code) ? t(`scitt.refusal.${code}`) : code;
    return {
      accepted: false,
      lines: [
        t("scitt.refused", { words, code }),
        // The verifier's sentence, verbatim (L-03).
        ...(c.detail ? [t("scitt.refused.verifier", { detail: c.detail })] : []),
        t("scitt.refused.why"),
      ],
    };
  }
  const at = c.checked_at_seq;
  const range =
    c.first_seq != null && c.last_seq != null ? t("scitt.accepted.range", { first: c.first_seq, last: c.last_seq }) : "";
  const root =
    c.root_status === "recomputed"
      ? t("scitt.accepted.root_recomputed", { last: c.last_seq ?? "?" })
      : c.root_status === "carried, not recomputed"
        ? t("scitt.accepted.root_carried")
        : "";
  const grown =
    at !== null && at < c.records_here - 1 ? t("scitt.accepted.grown", { records: count(c.records_here, "record") }) : "";
  return {
    accepted: true,
    lines: [
      t("scitt.accepted", { seq: at ?? "?", range, version: c.version ?? "?", root, grown }),
      t("scitt.accepted.id", { id: String(c.statement_id).slice(0, 16) }),
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
