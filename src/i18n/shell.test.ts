// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { CATALOGS } from "./index";
import { SHELL_LABELS, shellLabels } from "./shell";

const RUST = import.meta.glob("../../src-tauri/src/shell_text.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

group("the shell's own words (L-05)", () => {
  it("names exactly the labels the Rust side accepts", () => {
    const source = Object.values(RUST)[0]!;
    const accepted = [...source.matchAll(/^\s+"(\w+)" => &mut out\.\w+,$/gm)].map((m) => m[1]);
    expect(accepted.length).toBeGreaterThan(0);
    expect([...accepted].sort()).toEqual([...SHELL_LABELS].sort());
  });

  it("has every label in English, short enough for the shell to take", () => {
    const labels = shellLabels();
    for (const name of SHELL_LABELS) {
      expect(CATALOGS.en![`shell.${name}`], name).toBeTypeOf("string");
      expect([...labels[name]!].length).toBeLessThanOrEqual(120);
    }
  });

  it("keeps every language's labels to one short line", () => {
    for (const [tag, catalog] of Object.entries(CATALOGS)) {
      for (const name of SHELL_LABELS) {
        const text = catalog[`shell.${name}`];
        if (typeof text !== "string") continue;
        expect([...text].length, `${tag} ${name}`).toBeLessThanOrEqual(120);
        expect(/\p{Cc}/u.test(text), `${tag} ${name}`).toBe(false);
      }
    }
  });
});
