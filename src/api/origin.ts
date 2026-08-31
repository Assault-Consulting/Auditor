// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * Origin: what was declared active when a record was written — F9.
 *
 * `origin_at(seq)` collapses two different facts into the same null,
 * checked directly against `palimpsests.audit.reader.AuditReader
 * .origin_at`: no model has been declared active yet, and one was
 * declared and then explicitly unloaded (a MODEL_UNLOAD record) — both
 * leave its running state at `None`. F9 asks for different wording for
 * each ("not stated in this file" versus "no model active"), and the
 * data available here cannot tell them apart. Rendering two different
 * sentences from one null would be inventing the distinction rather than
 * reading it, so this slice renders the one sentence the null actually
 * supports, and the rest is U11 (`DEVELOPMENT-PLAN.md`, §2).
 */

import type { OriginModel } from "./generated/types";

/**
 * The declared origin, resolved for display — or null, passed through
 * unchanged. `OriginModel`'s own docstring is explicit that every field
 * here is a Recorded claim, never a proof of what actually ran (L3).
 */
export interface OriginCard {
  role: string;
  modelDigest: string;
  configDigest: string;
  sinceSeq: number;
  detail: string | null;
}

export function originCard(model: OriginModel | null): OriginCard | null {
  if (model === null) return null;
  return {
    role: model.role,
    modelDigest: model.model_digest,
    configDigest: model.config_digest,
    sinceSeq: model.since_seq,
    detail: model.detail,
  };
}
