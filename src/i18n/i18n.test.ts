// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe as group, expect, it } from "vitest";

import { catalogProblems } from "./check";
import { CATALOGS, LOCALES, getLocale, localeName, missing, negotiate, setLocale, t, tn } from "./index";

const en = CATALOGS.en!;

group("every catalog in locales/ passes the guards (L-04)", () => {
  it("English is there, first, and is the source", () => {
    expect(LOCALES[0]).toBe("en");
    expect(localeName("en")).toBe("English");
  });

  for (const tag of LOCALES) {
    it(`${tag} (${localeName(tag)}) has English's keys, placeholders and its own plural forms`, () => {
      expect(catalogProblems(tag, CATALOGS[tag]!, en)).toEqual([]);
    });
  }
});

group("the guards catch what a translation can get wrong", () => {
  const uk = {
    "meta.name": "Українська",
    "count.record": { one: "{n} запис", other: "{n} записів" },
    "against.profile": "щодо профілю",
  };
  const source = {
    "meta.name": "English",
    "count.record": { one: "{n} record", other: "{n} records" },
    "against.profile": "against anchor profile \"{profile}\"",
    "against.none": "without an anchor",
  };

  it("a missing key, a missing plural form, a lost placeholder", () => {
    expect(catalogProblems("uk", uk, source)).toEqual([
      "missing against.none",
      'count.record: no "few" form, which uk needs',
      'count.record: no "many" form, which uk needs',
      "against.profile: placeholders {} where English has {profile}",
    ]);
  });

  it("a form the language does not have, and a key English does not have", () => {
    const ja = { "meta.name": "日本語", "count.record": { one: "{n}", other: "{n} 件" }, "x.y": "z", "against.profile": "{profile}", "against.none": "-" };
    expect(catalogProblems("ja", ja, source)).toEqual([
      "extra x.y, which English does not have",
      'count.record: a "one" form ja does not have',
    ]);
  });
});

group("the mechanism (L-01)", () => {
  afterEach(() => setLocale("en"));

  it("negotiates an exact tag, then the base language, then English", () => {
    expect(negotiate(["uk-UA", "en-US"], ["en", "uk"])).toBe("uk");
    expect(negotiate(["de-AT", "fr"], ["en", "fr"])).toBe("fr");
    expect(negotiate(["zh-Hant"], ["en"])).toBe("en");
  });

  it("fills placeholders by name and chooses a plural by the platform's rule", () => {
    expect(tn("count.record", 1)).toBe("1 record");
    expect(tn("count.record", 2)).toBe("2 records");
    expect(tn("count.record", 12345)).toBe("12,345 records");
    expect(t("against.profile", { profile: "prod" })).toBe('against anchor profile "prod"');
  });

  it("an unknown language falls back to English", () => {
    setLocale("xx");
    expect(getLocale()).toBe("en");
  });

  it("counts a key no catalog has instead of hiding it", () => {
    expect(t("no.such.key")).toBe("no.such.key");
    expect(missing()).toContain("no.such.key");
  });
});
