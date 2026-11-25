// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The words the native shell draws itself, sent to it in the window's
 * language (L-05). These are the file dialogs' filter names and the print
 * window's title.
 *
 * Their translations sit in the catalogs under `shell.*` like any other, and
 * the Rust side keeps none (`src-tauri/src/shell_text.rs`). The names below
 * are the ones that file accepts. A test holds the two lists to each other.
 */

import { invoke } from "@tauri-apps/api/core";

import { onLocaleChange, t } from "./index";

export const SHELL_LABELS = [
  "chain",
  "segment_set",
  "all_files",
  "json_lines",
  "bundle",
  "consistency_proof",
  "signed_statement",
  "public_key",
  "anchor_file",
  "pkcs11_module",
  "print_title",
] as const;

export function shellLabels(): Record<string, string> {
  return Object.fromEntries(SHELL_LABELS.map((name) => [name, t(`shell.${name}`)]));
}

/**
 * Send the labels now and on every change of language. Outside the desktop
 * shell (a browser, a test) there is nobody to send them to. A refusal
 * leaves the shell's English in place, which is not worth a message: the
 * dialog still works.
 */
export function syncShellText(): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => {};
  const send = (): void => {
    invoke("set_shell_text", { labels: shellLabels() }).catch(() => {});
  };
  send();
  return onLocaleChange(send);
}
