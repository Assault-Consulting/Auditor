// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The package's record export, written where the user chooses (D-06).
 *
 * `pala-jsonl/1` is written by the package's `export_jsonl`; the desktop
 * shell asks the sidecar for it and streams it straight into the chosen file
 * (`export_records` in src-tauri/src/lib.rs). This side names a session and a
 * range, and receives where the file landed, its SHA-256 and what the
 * export's summary line says about the file — it never sees the export
 * itself, which runs to hundreds of megabytes on a large chain, and never
 * names a path.
 */

import { invoke } from "@tauri-apps/api/core";

import { type SavedArtifact, saveError } from "./saveFile";

/**
 * What the export's own summary line says, as the shell read it out of the
 * file it just wrote. The package's words, copied — never computed here.
 * Every field can be missing: the format is open, and a summary without a
 * key is still a summary.
 */
export interface ExportSummary {
  records: number | null;
  consistent: boolean | null;
  chain_ok: boolean | null;
  well_formed: boolean | null;
  body_digest_mismatches: number[];
}

/** The saved export: where it went, its digest, and what its summary says. */
export interface ExportedArtifact extends SavedArtifact {
  summary: ExportSummary;
}

/** The line shown under a saved export, and whether it is a warning. */
export interface SummaryLine {
  consistent: boolean | null;
  text: string;
}

/** At most this many record numbers are named before "and N more". */
const NAMED_SEQS = 10;

function seqList(seqs: number[]): string {
  const named = seqs.slice(0, NAMED_SEQS).map((s) => `#${s}`).join(", ");
  return seqs.length > NAMED_SEQS ? `${named} and ${seqs.length - NAMED_SEQS} more` : named;
}

/**
 * What the summary says about the file the export was made from, in one
 * line. A summary that says the file is not consistent is shown with its
 * reasons — and the export is kept: an export of a failing file is exactly
 * what someone examining the failure needs. Nothing here says who or why.
 */
export function summaryLine(summary: ExportSummary): SummaryLine {
  const records =
    summary.records === null
      ? ""
      : ` ${summary.records} ${summary.records === 1 ? "record" : "records"} in the file.`;
  if (summary.consistent === true) {
    return {
      consistent: true,
      text: `The export's summary: consistent — the headers link, the container parses to its end, and every body matches its digest.${records} Completeness was not checked.`,
    };
  }
  if (summary.consistent === null) {
    return {
      consistent: null,
      text: `The export's summary does not say whether the file is consistent.${records}`,
    };
  }
  const reasons: string[] = [];
  if (summary.well_formed === false) reasons.push("the container does not parse to its end");
  const mismatches = summary.body_digest_mismatches;
  if (mismatches.length > 0) {
    reasons.push(
      mismatches.length === 1
        ? `the body of record ${seqList(mismatches)} does not match the digest its header carries`
        : `${mismatches.length} record bodies (${seqList(mismatches)}) do not match the digest their header carries`,
    );
  }
  if (summary.chain_ok === false) reasons.push("the header chain does not link");
  const why = reasons.length > 0 ? reasons.join("; ") : "for a reason the summary does not name";
  return {
    consistent: false,
    text: `The export's summary says the file is not consistent: ${why}.${records} The export was saved as it is — it is a view of that file, for examining it.`,
  };
}

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
 * rejects with its own sentence. A file that is not consistent is not a
 * refusal: the export is saved, and its summary says so.
 */
export async function exportRecords(
  sessionId: string,
  range: { fromSeq: number | null; toSeq: number | null },
  suggestedName: string,
): Promise<ExportedArtifact | null> {
  try {
    return await invoke<ExportedArtifact | null>("export_records", {
      sessionId,
      fromSeq: range.fromSeq,
      toSeq: range.toSeq,
      suggestedName,
    });
  } catch (err) {
    throw saveError(err);
  }
}
