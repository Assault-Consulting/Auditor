// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Origin: what was declared active when a record was written — F9.
 *
 * Three states, not the two a bare null used to collapse. Before U11
 * (released 0.11.0), `origin_at()` returned null for two different
 * facts — nothing had been declared yet, and something was declared and
 * then explicitly ended by a MODEL_UNLOAD — and this slice could render
 * only the one sentence that null actually supported. The sidecar's
 * `/origin` now answers with a named `state` for all three
 * (`DEVELOPMENT-PLAN.md`, C-08b), so each gets its own sentence here.
 */

import type { OriginState } from "./generated/types";

/**
 * The declared origin, resolved for display. `OriginState.origin`'s own
 * docstring is explicit that every field is a Recorded claim, never a
 * proof of what actually ran (L3) — carried through unchanged into the
 * `"active"` case below, never into the other two, which have no origin
 * to be a claim about.
 */
export type OriginCard =
  | {
      state: "active";
      role: string;
      modelDigest: string;
      configDigest: string;
      sinceSeq: number;
      detail: string | null;
    }
  | { state: "unloaded" }
  | { state: "not_stated" };

/**
 * T20. From palimpsests 0.15 the configuration digest is taken over the
 * RFC 8785 (JCS) form, so the same parameters digest differently either side
 * of the 0.14 → 0.15 upgrade. Said under the digest, because a new origin at
 * that boundary otherwise reads as a configuration change.
 */
export const CONFIG_DIGEST_NOTE =
  "the writer's claim. Writers from palimpsests 0.15 digest the canonical (RFC 8785) form, so the same configuration digests differently across the 0.14 → 0.15 upgrade: a new origin there is not by itself a change of configuration — the boot's WRITER_OPEN names the writer's version";

export function originCard(view: OriginState): OriginCard {
  if (view.state === "active" && view.origin !== null) {
    return {
      state: "active",
      role: view.origin.role,
      modelDigest: view.origin.model_digest,
      configDigest: view.origin.config_digest,
      sinceSeq: view.origin.since_seq,
      detail: view.origin.detail,
    };
  }
  if (view.state === "unloaded") return { state: "unloaded" };
  return { state: "not_stated" };
}
