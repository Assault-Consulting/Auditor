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

import { t, tn } from "../i18n";
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
      : tn("export.records", summary.records);
  if (summary.consistent === true) {
    return {
      consistent: true,
      text: t("export.summary.consistent", { records }),
    };
  }
  if (summary.consistent === null) {
    return {
      consistent: null,
      text: t("export.summary.unknown", { records }),
    };
  }
  const reasons: string[] = [];
  if (summary.well_formed === false) reasons.push(t("export.reason.not_parsed"));
  const mismatches = summary.body_digest_mismatches;
  if (mismatches.length > 0) {
    reasons.push(
      mismatches.length === 1
        ? t("export.reason.body.one", { seqs: seqList(mismatches) })
        : t("export.reason.body.many", { n: mismatches.length, seqs: seqList(mismatches) }),
    );
  }
  if (summary.chain_ok === false) reasons.push(t("export.reason.no_link"));
  const why = reasons.length > 0 ? reasons.join("; ") : t("export.reason.unnamed");
  return {
    consistent: false,
    text: t("export.summary.inconsistent", { why, records }),
  };
}

/**
 * Said beside the export, before it is made. The format's own statement of
 * what an export is (docs/specs/export/pala-jsonl-1.md), in a sentence.
 */
export const exportNote = (): string => t("export.note");

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
  const read = (text: string, which: "first" | "last"): number | null | string => {
    const typed = text.trim();
    if (typed === "") return null;
    const bound = t(`range.${which}`);
    if (!/^\d+$/.test(typed)) return t("range.not_number", { which: bound, text: typed });
    const n = Number(typed);
    return Number.isSafeInteger(n) ? n : t("range.too_large", { which: bound, text: typed });
  };
  const fromSeq = read(fromText, "first");
  if (typeof fromSeq === "string") return { kind: "refused", reason: fromSeq };
  const toSeq = read(toText, "last");
  if (typeof toSeq === "string") return { kind: "refused", reason: toSeq };
  if (fromSeq !== null && toSeq !== null && fromSeq > toSeq) {
    return { kind: "refused", reason: t("range.backwards", { from: fromSeq, to: toSeq }) };
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
