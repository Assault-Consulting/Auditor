// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Choosing a container: a file dialog, or a file dropped on the window.
 *
 * Both routes produce **a path and nothing else**. The frontend never reads
 * a container's bytes — it hands the path to the sidecar, which opens it
 * through the seam (ADR-0001).
 *
 * That is why the dialog is invoked as our own Tauri command rather than
 * through `@tauri-apps/plugin-dialog`. The plugin's `open()` adds every
 * chosen path to the webview's filesystem and asset protocol scopes, which
 * would grant exactly the capability the invariant forbids — and it would
 * arrive as a permission rather than as code, where no scan would catch it.
 * The plugin's own documentation recommends the dedicated command we use.
 *
 * Drag and drop needs no plugin at all: the event is part of the core
 * webview API and carries `paths` only.
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { NoShellError } from "./session";

/**
 * Ask the user for a container.
 *
 * Resolves to `null` when the dialog was **cancelled**, which is an ordinary
 * outcome and must not be shown as a failure. Throws {@link NoShellError}
 * when there is no desktop shell behind the page — the `pnpm dev` case.
 */
export async function pickChainFile(): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_chain_file");
  } catch {
    throw new NoShellError();
  }
}

/**
 * Call `handler` when files are dropped on the window.
 *
 * Returns the unlisten function, which the caller must invoke when its
 * component goes away — an orphaned listener keeps firing into a handler
 * whose state no longer exists.
 *
 * Multiple paths are passed through unchanged rather than reduced to the
 * first. Segment sequences — several files that are one logical chain — are
 * an open question in FUNCTIONALITY.md §22, and silently dropping the rest
 * here would decide it by accident.
 */
export async function onChainFilesDropped(
  handler: (paths: string[]) => void,
): Promise<() => void> {
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop" && event.payload.paths.length > 0) {
      handler(event.payload.paths);
    }
  });
  return unlisten;
}
