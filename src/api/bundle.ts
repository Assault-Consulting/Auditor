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
export const BUNDLE_NOTE =
  "An evidence bundle: the selected records, an inclusion proof for each one a proof window covers, the verification and the anchor, in one tar a recipient re-checks from the specification alone (check_bundle.py, in Auditor's repository, does it with Python's standard library). Derived and unsigned — the chain stays authoritative. A selection, at most 100,000 records: an excerpt around a finding, not the archive.";

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
  if (firstSeq === null || lastSeq === null) return "the file holds no records to bundle";
  const lo = range.fromSeq ?? firstSeq;
  const hi = range.toSeq ?? lastSeq;
  if (lo > lastSeq || hi < firstSeq) {
    return `#${lo}–#${hi} lies outside this file's records, #${firstSeq}–#${lastSeq}`;
  }
  const width = hi - lo + 1;
  if (width > BUNDLE_MAX) {
    return `a bundle selects at most ${BUNDLE_MAX.toLocaleString("en")} records, and #${lo}–#${hi} is ${width.toLocaleString("en")} — narrow the range around what is to be shown, or export the records`;
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
  const range = f.from_seq !== null && f.to_seq !== null ? ` #${f.from_seq}–#${f.to_seq}` : "";
  const records = f.records === null ? "" : `${count(f.records, "record")}${range}`;
  const proven =
    f.proven === null || f.records === null
      ? ""
      : f.proven === f.records
        ? ", each with an inclusion proof"
        : f.proven === 0
          ? ", none with an inclusion proof — the chain carries no proof window over them; the verification inside still covers them"
          : `, ${f.proven} of them with an inclusion proof — the others lie outside any proof window the chain carries`;
  const head = f.head ? ` Head ${f.head.slice(0, 16)}….` : "";
  if (f.consistent === false) {
    return {
      consistent: false,
      text: `The bundle holds ${records}${proven}. Its verification says the file is not consistent — bundled as it is, for inspection.${head}`,
    };
  }
  return {
    consistent: f.consistent,
    text: `The bundle holds ${records}${proven}.${f.consistent === true ? " Its verification says the file is consistent." : ""}${head}`,
  };
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
