// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Anchor profiles, made and changed in the window (E-08).
 *
 * An anchor is a head kept somewhere other than the log. Without one,
 * question two ("is this all of it?") cannot be answered. A profile is an
 * ordered list of places to look for that head, and the first that answers
 * wins.
 *
 * The sidecar keeps profiles in a file in this OS's data directory. That
 * file names where to look and never holds a secret: a token's PIN is a
 * keychain *account*. What a head means is the package's business, so this
 * module only says what a source needs before it is sent, in the user's
 * language. The sidecar checks again and refuses by name.
 */

import { invoke } from "@tauri-apps/api/core";

import { t } from "../i18n";
import type { AnchorProfile, AnchorSourceSpec, AnchorStore, KeychainStatus } from "./generated/types";
import { NoShellError, type Session } from "./session";

/** The kinds this window offers, in the order it offers them. */
export const SOURCE_KINDS = ["file", "keychain", "manual", "pkcs11"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** A profile name: one line, 1–64 characters, as the sidecar requires. */
export const MAX_NAME = 64;

const HEAD = /^[0-9a-fA-F]{64}$/;

/** What is wrong with a draft before it is sent, or null. */
export function nameProblem(name: string, taken: string[], editing: string | null): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return t("anchors.name.empty");
  if (trimmed.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(trimmed)) return t("anchors.name.long", { max: MAX_NAME });
  if (trimmed === "none") return t("anchors.name.none");
  if (trimmed !== editing && taken.includes(trimmed)) return t("anchors.name.taken", { name: trimmed });
  return null;
}

/** What a source still needs, or null when it has what its kind requires. */
export function sourceProblem(source: AnchorSourceSpec): string | null {
  const filled = (v: string | null | undefined) => (v ?? "").trim() !== "";
  switch (source.kind) {
    case "file":
      return filled(source.path) ? null : t("anchors.need.path");
    case "keychain":
      return filled(source.account) ? null : t("anchors.need.account");
    case "manual":
      return HEAD.test((source.head ?? "").trim()) ? null : t("anchors.need.head");
    case "pkcs11":
      return filled(source.module_path) && filled(source.token_label) && filled(source.pin_account)
        ? null
        : t("anchors.need.pkcs11");
    default:
      return t("anchors.need.kind", { kind: source.kind });
  }
}

/**
 * Only the fields a source's kind uses, trimmed. Switching a source from
 * file to keychain in the form must not leave the old path in the profile,
 * where it would be shown as if it meant something.
 */
export function cleanSource(source: AnchorSourceSpec): AnchorSourceSpec {
  const v = (x: string | null | undefined) => (x ?? "").trim();
  const detail = v(source.detail);
  const base = { kind: source.kind, ...(detail ? { detail } : {}) };
  switch (source.kind) {
    case "file":
      return { ...base, path: v(source.path) };
    case "keychain":
      return { ...base, account: v(source.account) };
    case "manual":
      return { ...base, head: v(source.head).toLowerCase() };
    case "pkcs11": {
      const object = v(source.object_label);
      return {
        ...base,
        module_path: v(source.module_path),
        token_label: v(source.token_label),
        pin_account: v(source.pin_account),
        ...(object ? { object_label: object } : {}),
      };
    }
    default:
      return { ...source };
  }
}

/** One line naming a source, for the list of profiles. */
export function sourceLine(source: AnchorSourceSpec): string {
  switch (source.kind) {
    case "file":
      return t("anchors.line.file", { path: source.path ?? "" });
    case "keychain":
      return t("anchors.line.keychain", { account: source.account ?? "" });
    case "manual":
      return t("anchors.line.manual", { head: (source.head ?? "").slice(0, 12) });
    case "pkcs11":
      return t("anchors.line.pkcs11", { token: source.token_label ?? "" });
    default:
      return source.kind;
  }
}

function url(session: Session, path: string): string {
  return `http://127.0.0.1:${session.port}${path}`;
}

function headers(session: Session): HeadersInit {
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

/** The sidecar's own words for a refusal; a 422's field errors joined. */
async function refusal(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return new Error(body.detail);
    if (Array.isArray(body.detail)) {
      const parts = body.detail.map((d: { msg?: unknown }) => (typeof d.msg === "string" ? d.msg : "")).filter(Boolean);
      if (parts.length > 0) return new Error(parts.join("; "));
    }
  } catch {
    // fall through to the status
  }
  return new Error(t("anchors.refused.status", { status: response.status }));
}

export async function saveProfile(session: Session, name: string, sources: AnchorSourceSpec[]): Promise<AnchorProfile> {
  const response = await fetch(url(session, `/anchors/profiles/${encodeURIComponent(name)}`), {
    method: "PUT",
    headers: headers(session),
    body: JSON.stringify({ name, sources }),
  });
  if (!response.ok) throw await refusal(response);
  return (await response.json()) as AnchorProfile;
}

export async function deleteProfile(session: Session, name: string): Promise<void> {
  const response = await fetch(url(session, `/anchors/profiles/${encodeURIComponent(name)}`), {
    method: "DELETE",
    headers: headers(session),
  });
  if (!response.ok) throw await refusal(response);
}

export async function getStore(session: Session): Promise<AnchorStore> {
  const response = await fetch(url(session, "/anchors/store"), { headers: headers(session) });
  if (!response.ok) throw await refusal(response);
  return (await response.json()) as AnchorStore;
}

export async function getKeychain(session: Session): Promise<KeychainStatus> {
  const response = await fetch(url(session, "/anchors/keychain"), { headers: headers(session) });
  if (!response.ok) throw await refusal(response);
  return (await response.json()) as KeychainStatus;
}

/**
 * Put a head into this machine's secret store under `account`. The head is
 * checked here first: a mistyped head persists, and would make question two
 * answer "the head names no record" for as long as it stays.
 */
export async function storeKeychainHead(session: Session, account: string, head: string): Promise<void> {
  if (account.trim() === "") throw new Error(t("anchors.need.account"));
  if (!HEAD.test(head.trim())) throw new Error(t("anchors.need.head"));
  const response = await fetch(url(session, "/anchors/keychain"), {
    method: "PUT",
    headers: headers(session),
    body: JSON.stringify({ account: account.trim(), head: head.trim().toLowerCase() }),
  });
  if (!response.ok) throw await refusal(response);
}

/** The native dialog for a head file or a PKCS#11 module; `null` is cancelled. */
export async function pickAnchorPath(kind: "file" | "pkcs11"): Promise<string | null> {
  try {
    return await invoke<string | null>(kind === "file" ? "pick_anchor_file" : "pick_pkcs11_module");
  } catch {
    throw new NoShellError();
  }
}
