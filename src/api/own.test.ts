// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { ownEntry } from "./own";

group("a lookup by a package-supplied name", () => {
  const table: Record<string, string> = { ok: "returned" };

  it("finds the table's own entries", () => {
    expect(ownEntry(table, "ok")).toBe("returned");
  });

  it("never finds what the object inherits", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(ownEntry(table, name)).toBeUndefined();
    }
  });
});
