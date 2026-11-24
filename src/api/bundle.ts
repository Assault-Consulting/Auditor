// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The evidence bundle, written where the user chooses (E-01).
 *
 * `pala-bundle/1` is assembled by the package's `assemble_bundle`: the
 * selected records, an inclusion proof for each one a window covers, the
 * verification, the anchor. The desktop shell streams it into the chosen file
 * (`save_bundle` in src-tauri/src/lib.rs), so this side names a session, a
 * range and a profile, and receives where it landed, its SHA-256 and what the
 * package said about it. It never holds the tar and never names a path.
 *
 * **A bundle is a selection.** It carries each record and its proof path,
 * so it outgrows its source: at most {@link BUNDLE_MAX} records — the
 * sidecar's bound, said here so the range is refused before the button is
 * pressed rather than after the dialog.
 */

import { invoke } from "@tauri-apps/api/core";

import { t } from "../i18n";
import type { ExportRange } from "./exportFile";
import { count } from "./plural";
import { type SavedArtifact, saveError } from "./saveFile";

/** The sidecar's `MAX_BUNDLE_RECORDS`, measured on 0.15 (pala_seam.py). */
export const BUNDLE_MAX = 100_000;

/** What the package said about the bundle; every field may be missing. */
export interface BundleFacts {
  format: string | null;
  records: number | null;
  proven: number | null;
  head: string | null;
  chain_ok: boolean | null;
  consistent: boolean | null;
  from_seq: number | null;
  to_seq: number | null;
}

export interface BundledArtifact extends SavedArtifact {
  facts: BundleFacts;
}

/** Said beside the button: what a bundle is and what it is not. */
export const bundleNote = (): string => t("bundle.note", { max: BUNDLE_MAX });

/**
 * Whether the range as typed can be bundled, given the records present. An
 * open side reaches the file's first or last record; a selection wider than the bound is
 * refused here with the way round.
 */
export function bundleRefusal(
  range: ExportRange,
  firstSeq: number | null,
  lastSeq: number | null,
): string | null {
  if (range.kind === "refused") return range.reason;
  if (firstSeq === null || lastSeq === null) return t("bundle.refused.empty");
  const lo = range.fromSeq ?? firstSeq;
  const hi = range.toSeq ?? lastSeq;
  if (lo > lastSeq || hi < firstSeq) {
    return t("bundle.refused.outside", { from: lo, to: hi, first: firstSeq, last: lastSeq });
  }
  const width = hi - lo + 1;
  if (width > BUNDLE_MAX) {
    return t("bundle.refused.wide", { max: BUNDLE_MAX, from: lo, to: hi, width });
  }
  return null;
}

/** `chain.pala` → `chain.pala.bundle.tar`, the range in the name when one is set. */
export function bundleFileName(
  filename: string | null | undefined,
  range: { fromSeq: number | null; toSeq: number | null },
): string {
  const name = typeof filename === "string" && filename.trim() !== "" ? filename.trim() : "chain";
  const part =
    range.fromSeq === null && range.toSeq === null
      ? ""
      : `.${range.fromSeq ?? 0}-${range.toSeq ?? "end"}`;
  return `${name}${part}.bundle.tar`;
}

/** The line under a saved bundle: the package's facts, a damaged chain said as such. */
export function bundleLine(f: BundleFacts): { consistent: boolean | null; text: string } {
  const counted = f.records === null ? "" : count(f.records, "record");
  const records =
    f.records !== null && f.from_seq !== null && f.to_seq !== null
      ? t("bundle.line.range", { records: counted, from: f.from_seq, to: f.to_seq })
      : counted;
  const proven =
    f.proven === null || f.records === null
      ? ""
      : f.proven === f.records
        ? t("bundle.line.all_proven")
        : f.proven === 0
          ? t("bundle.line.none_proven")
          : t("bundle.line.some_proven", { proofs: f.proven });
  const head = f.head ? t("bundle.line.head", { head: f.head.slice(0, 16) }) : "";
  if (f.consistent === false) {
    return { consistent: false, text: t("bundle.line.inconsistent", { records, proofs: proven, head }) };
  }
  const consistent = f.consistent === true ? t("bundle.line.consistent") : "";
  return { consistent: f.consistent, text: t("bundle.line.held", { records, proofs: proven, consistent, head }) };
}

/** Ask the shell to bundle. `null` is a cancelled dialog. */
export async function saveBundle(
  sessionId: string,
  range: { fromSeq: number | null; toSeq: number | null },
  profile: string,
  suggestedName: string,
): Promise<BundledArtifact | null> {
  try {
    return await invoke<BundledArtifact | null>("save_bundle", {
      sessionId,
      fromSeq: range.fromSeq,
      toSeq: range.toSeq,
      profile,
      suggestedName,
    });
  } catch (err) {
    throw saveError(err);
  }
}
