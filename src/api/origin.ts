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
