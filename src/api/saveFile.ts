// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Saving one of Auditor's own artifacts to a file (D-07).
 *
 * The dialog runs in the desktop shell and the file is written there, to the
 * path the user chose in that dialog (`save_artifact` in src-tauri/src/lib.rs).
 * This side hands over a suggested name and the text, and receives where it
 * landed and its SHA-256 — it never names a path to write to, and the webview
 * holds no filesystem permission at all. The digest goes beside the file as
 * `<name>.sha256`, in `sha256sum`'s own format, so it travels with it.
 */

import { invoke } from "@tauri-apps/api/core";

import { NoShellError } from "./session";

/** What the shell wrote, and where. */
export interface SavedArtifact {
  path: string;
  digest_path: string;
  sha256: string;
  bytes: number;
}

/**
 * Ask the shell to save `contents`. Resolves to `null` when the dialog was
 * cancelled — an ordinary outcome, not a failure. A refusal from the shell
 * (an unwritable place) rejects with its own sentence; no shell at all
 * rejects with {@link NoShellError}.
 */
export async function saveArtifact(
  suggestedName: string,
  contents: string,
): Promise<SavedArtifact | null> {
  try {
    return await invoke<SavedArtifact | null>("save_artifact", { suggestedName, contents });
  } catch (err) {
    throw saveError(err);
  }
}

/** The shell's own refusal arrives as a string; anything else means no shell. */
export function saveError(err: unknown): Error {
  return typeof err === "string" ? new Error(err) : new NoShellError();
}

/**
 * The name the save dialog offers for a report: the chain's own file name with
 * `.report.json` appended, so the two sort together and the report names what
 * it is about. A subject the report does not name falls back to `report.json`.
 */
export function reportFileName(report: Record<string, unknown>): string {
  const subject = report.subject as { filename?: unknown } | undefined;
  const name = typeof subject?.filename === "string" ? subject.filename.trim() : "";
  return name === "" ? "report.json" : `${name}.report.json`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The sentence shown once a file is written. */
export function savedLine(saved: SavedArtifact): string {
  return (
    `Saved to ${saved.path} — SHA-256 ${saved.sha256}, written beside it as ` +
    `${baseName(saved.digest_path)}; check with: sha256sum -c ${baseName(saved.digest_path)}`
  );
}
