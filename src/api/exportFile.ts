// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The package's record export, written where the user chooses (D-06).
 *
 * `pala-jsonl/1` is written by the package's `export_jsonl`; the desktop
 * shell asks the sidecar for it and streams it straight into the chosen file
 * (`export_records` in src-tauri/src/lib.rs). This side names a session and a
 * range, and receives where the file landed and its SHA-256 — it never sees
 * the export itself, which runs to hundreds of megabytes on a large chain, and
 * never names a path.
 */

import { invoke } from "@tauri-apps/api/core";

import { type SavedArtifact, saveError } from "./saveFile";

/**
 * Said beside the export, before it is made. The format's own statement of
 * what an export is (docs/specs/export/pala-jsonl-1.md), in a sentence.
 */
export const EXPORT_NOTE =
  "A readable view of the binary log — derived, never authoritative: it carries no signature and enters no hash. Its summary line describes the whole file, a range included, and reads no anchor, so completeness is not checked. Whatever is concluded from it is concluded about the record each line names, and checked there.";

/** `chain.pala` → `chain.pala.jsonl`; no name → `export.jsonl`. */
export function exportFileName(filename: string | null | undefined): string {
  const name = typeof filename === "string" ? filename.trim() : "";
  return name === "" ? "export.jsonl" : `${name}.jsonl`;
}

export type ExportRange =
  | { kind: "range"; fromSeq: number | null; toSeq: number | null }
  | { kind: "refused"; reason: string };

/**
 * The two optional bounds as typed. Empty means unbounded on that side; a
 * bound is a whole number of at least zero; a start after the end is refused
 * here rather than sent — an empty export is an answer to a question nobody
 * meant to ask.
 */
export function parseRange(fromText: string, toText: string): ExportRange {
  const read = (text: string, which: string): number | null | string => {
    const t = text.trim();
    if (t === "") return null;
    if (!/^\d+$/.test(t)) return `the ${which} bound is not a record number: ${t}`;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : `the ${which} bound is too large: ${t}`;
  };
  const fromSeq = read(fromText, "first");
  if (typeof fromSeq === "string") return { kind: "refused", reason: fromSeq };
  const toSeq = read(toText, "last");
  if (typeof toSeq === "string") return { kind: "refused", reason: toSeq };
  if (fromSeq !== null && toSeq !== null && fromSeq > toSeq) {
    return { kind: "refused", reason: `the range starts at #${fromSeq}, after its end at #${toSeq}` };
  }
  return { kind: "range", fromSeq, toSeq };
}

/**
 * Ask the shell to export. Resolves to `null` when the dialog was cancelled;
 * a refusal (the file changed, an unwritable place, a cut-short stream)
 * rejects with its own sentence.
 */
export async function exportRecords(
  sessionId: string,
  range: { fromSeq: number | null; toSeq: number | null },
  suggestedName: string,
): Promise<SavedArtifact | null> {
  try {
    return await invoke<SavedArtifact | null>("export_records", {
      sessionId,
      fromSeq: range.fromSeq,
      toSeq: range.toSeq,
      suggestedName,
    });
  } catch (err) {
    throw saveError(err);
  }
}
