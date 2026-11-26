// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * The package's fixed sentences, shown in the chosen language by name (R19,
 * Palimpsests 0.15.1).
 *
 * A few of the report's sentences are not about any chain: they are the
 * same every time ("advisory items do not affect the verdict", "proved
 * order"). The package names them (`NOTES`, `HEALTH_BASES`) and writes the
 * name beside the text (`note_id`, `basis_id`). The catalogs translate a
 * *name*, `fixed.note.<id>` and `fixed.basis.<id>`. A test holds the English
 * catalog to the package's text letter for letter, so English is still the
 * package's own words (L-03).
 *
 * Without a name, or with one this build does not know, the text is shown
 * as the package wrote it. That covers a report from 0.15.0, which carries
 * no names, and a name added later. A sentence is never matched by its
 * English.
 */

import vocabulary from "./generated/vocabulary.json";
import { t, verbatim } from "../i18n";

const NOTES = vocabulary.notes as Record<string, string>;
const BASES = vocabulary.health_bases as Record<string, string>;

const known = (table: Record<string, string>, id: unknown): id is string =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(table, id);

/** A note by name, in the chosen language; else the package's text. */
export function fixedNote(id: unknown, text: string | null | undefined): string | null {
  if (known(NOTES, id)) return t(`fixed.note.${id}`);
  return text == null ? null : verbatim(text);
}

/** A health basis by name, in the chosen language; else the package's text. */
export function fixedBasis(id: unknown, text: string | null | undefined): string | null {
  if (known(BASES, id)) return t(`fixed.basis.${id}`);
  return text == null ? null : verbatim(text);
}
