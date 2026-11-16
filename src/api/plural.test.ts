// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { againstLine, count } from "./plural";
import { parseSearch, SEARCH_HELP } from "./search";

group("counts and the anchor profile, in words (H2)", () => {
  it("says one boot and two boots", () => {
    expect(count(1, "boot")).toBe("1 boot");
    expect(count(2, "boot")).toBe("2 boots");
    expect(count(0, "span")).toBe("0 spans");
    expect(count(1, "anchor source")).toBe("1 anchor source");
  });

  it("calls no anchor no anchor, never a profile named none", () => {
    expect(againstLine("none")).toBe("without an anchor");
    expect(againstLine("desk")).toBe('against anchor profile "desk"');
  });
});

group("the search help lists only what the bar reads (H6)", () => {
  it("every query form it shows parses to something other than a refusal", () => {
    const queries = SEARCH_HELP.map(([form]) => form).filter((f) => !/^[/jknb ]+$/.test(f));
    expect(queries.length).toBeGreaterThanOrEqual(6);
    for (const q of queries) {
      expect(parseSearch(q)?.kind, q).not.toBe("unsupported");
      expect(parseSearch(q), q).not.toBeNull();
    }
  });
});
