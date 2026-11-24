// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The second file a verdict rests on (palimpsests 0.13, U17).
 *
 * A segment whose first record declares a continuation is diagnosed
 * against the segments manifest beside it. The verifier names that file,
 * the status it decided, the digest of the bytes it read and, when the
 * status is not plain, why. This module turns that into one line under the
 * diagnosis — and, as everywhere else here, it states what was checked,
 * never more: "names the same predecessor" is agreement between two
 * declarations, not proof of the records they describe.
 *
 * The session refuses to answer once the manifest changes (C-13a), so the
 * digest shown is not decoration: it is the identity of half the evidence.
 */

import { t } from "../i18n";
import type { ManifestReadingModel } from "./generated/types";

export interface ManifestLine {
  /** One sentence: which file, and what it said. */
  text: string;
  /** The manifest's path, when there was one to look for. */
  path: string | null;
  /** Hex SHA-256 of the bytes the verifier read; null when none were read. */
  sha256: string | null;
  /** The package's own reason, verbatim, when it gave one. */
  detail: string | null;
  /** True for a status this build has no sentence for. */
  unrecognised: boolean;
}

/** The statuses this module has a sentence for — held to the package's (T11). */
export const KNOWN_STATUSES: readonly string[] = ["matches", "contradicts", "declared_only"];

export function manifestLine(manifest: ManifestReadingModel | null | undefined): ManifestLine | null {
  if (manifest === null || manifest === undefined) return null;
  const { path, status, sha256, detail } = manifest;
  const at = path === null ? null : t("manifest.at", { path });
  let text: string;
  let unrecognised = false;
  if (path === null) {
    text = t("manifest.none");
  } else if (status === "matches") {
    text = t("manifest.matches", { at });
  } else if (status === "contradicts") {
    text = t("manifest.contradicts", { at });
  } else if (status === "declared_only" && sha256 === null) {
    text = t("manifest.not_read", { path });
  } else if (status === "declared_only") {
    text = t("manifest.set_aside", { path });
  } else {
    unrecognised = true;
    text = t("manifest.unknown", { at, status });
  }
  return { text, path, sha256, detail, unrecognised };
}
