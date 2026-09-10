// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { originCard } from "./origin";
import type { OriginModel, OriginState } from "./generated/types";

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

group("origin state, resolved for display (C-08b, U11)", () => {
  it("carries every field through when active, since OriginModel's own claim is that all of them are Recorded", () => {
    const state: OriginState = {
      state: "active",
      origin: model({ role: "engine.wasm", since_seq: 900, detail: "resumed after crash" }),
    };
    expect(originCard(state)).toEqual({
      state: "active",
      role: "engine.wasm",
      modelDigest: "ab" + "00".repeat(31),
      configDigest: "cd" + "00".repeat(31),
      sinceSeq: 900,
      detail: "resumed after crash",
    });
  });

  it("is its own state when unloaded, distinct from never having been declared", () => {
    const state: OriginState = { state: "unloaded", origin: null };
    expect(originCard(state)).toEqual({ state: "unloaded" });
  });

  it("is its own state when nothing has been declared at all", () => {
    const state: OriginState = { state: "not_stated", origin: null };
    expect(originCard(state)).toEqual({ state: "not_stated" });
  });
});
