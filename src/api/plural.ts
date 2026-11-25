// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * A count with its noun, in the chosen language's plural — "1 boot",
 * "2 boots"; in Ukrainian one / few / many. The forms are in the catalogs
 * (`count.<noun>`), chosen by `Intl.PluralRules` (L-01).
 */

import { t, tn } from "../i18n";

export type CountNoun = "anchor" | "anchor_source" | "boot" | "day" | "hash" | "item" | "record" | "safety_record" | "span";

export function count(n: number, noun: CountNoun): string {
  return tn(`count.${noun}`, n);
}

/** How the screen names an anchor profile: "none" is no anchor, not a profile called none. */
export function againstLine(profile: string): string {
  return profile === "none" ? t("against.none") : t("against.profile", { profile });
}
