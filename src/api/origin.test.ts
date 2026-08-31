// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { originCard } from "./origin";
import type { OriginModel } from "./generated/types";

function model(over: Partial<OriginModel> = {}): OriginModel {
  return {
    role: "engine.native",
    model_digest: "ab" + "00".repeat(31),
    config_digest: "cd" + "00".repeat(31),
    since_seq: 4,
    detail: null,
    ...over,
  };
}

group("what origin_at answered", () => {
  it("passes null through unchanged — the sidecar already resolved it", () => {
    // A real answer, not an absence: this is "not stated in this file"
    // (or, indistinguishably, "unloaded" — see the module doc for why
    // the null is not split into two sentences here).
    expect(originCard(null)).toBeNull();
  });

  it("carries every field through, since OriginModel's own claim is that all of them are Recorded", () => {
    const card = originCard(
      model({ role: "engine.wasm", since_seq: 900, detail: "resumed after crash" }),
    );
    expect(card).toEqual({
      role: "engine.wasm",
      modelDigest: "ab" + "00".repeat(31),
      configDigest: "cd" + "00".repeat(31),
      sinceSeq: 900,
      detail: "resumed after crash",
    });
  });
});
