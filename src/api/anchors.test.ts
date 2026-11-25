// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it, vi } from "vitest";

import { cleanSource, nameProblem, saveProfile, sourceLine, sourceProblem, storeKeychainHead } from "./anchors";

const SESSION = { port: 1, token: "tok" };
const HEAD = "ab".repeat(32);

group("an anchor profile before it is sent (E-08)", () => {
  it("names what a name lacks", () => {
    expect(nameProblem("", [], null)).not.toBeNull();
    expect(nameProblem("   ", [], null)).not.toBeNull();
    expect(nameProblem("none", [], null)).not.toBeNull();
    expect(nameProblem("x".repeat(65), [], null)).not.toBeNull();
    expect(nameProblem("a\nb", [], null)).not.toBeNull();
    expect(nameProblem("desk", ["desk"], null)).not.toBeNull();
    // Keeping its own name while editing is not a clash.
    expect(nameProblem("desk", ["desk"], "desk")).toBeNull();
    expect(nameProblem("desk", [], null)).toBeNull();
  });

  it("names what each kind of source still needs", () => {
    expect(sourceProblem({ kind: "file", path: " " })).not.toBeNull();
    expect(sourceProblem({ kind: "file", path: "/srv/head.json" })).toBeNull();
    expect(sourceProblem({ kind: "keychain", account: "" })).not.toBeNull();
    expect(sourceProblem({ kind: "keychain", account: "desk" })).toBeNull();
    expect(sourceProblem({ kind: "manual", head: HEAD.slice(1) })).not.toBeNull();
    expect(sourceProblem({ kind: "manual", head: `  ${HEAD.toUpperCase()} ` })).toBeNull();
    expect(sourceProblem({ kind: "pkcs11", module_path: "/m.so", token_label: "t" })).not.toBeNull();
    expect(sourceProblem({ kind: "pkcs11", module_path: "/m.so", token_label: "t", pin_account: "p" })).toBeNull();
    expect(sourceProblem({ kind: "carrier-pigeon" })).not.toBeNull();
  });

  it("sends only the fields a source's kind uses", () => {
    // A source switched from file to keychain in the form keeps no path.
    expect(cleanSource({ kind: "keychain", account: " desk ", path: "/old", detail: "" })).toEqual({
      kind: "keychain",
      account: "desk",
    });
    expect(cleanSource({ kind: "manual", head: HEAD.toUpperCase(), detail: " from the handover " })).toEqual({
      kind: "manual",
      head: HEAD,
      detail: "from the handover",
    });
    expect(cleanSource({ kind: "pkcs11", module_path: "/m.so", token_label: "t", pin_account: "p", object_label: " " })).toEqual({
      kind: "pkcs11",
      module_path: "/m.so",
      token_label: "t",
      pin_account: "p",
    });
  });

  it("shows a head typed in by its start only", () => {
    expect(sourceLine({ kind: "manual", head: HEAD })).toContain(HEAD.slice(0, 12));
    expect(sourceLine({ kind: "manual", head: HEAD })).not.toContain(HEAD);
  });
});

group("talking to the sidecar", () => {
  it("puts a profile under its encoded name", async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify({ name: "desk &co", sources: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetched);
    await saveProfile(SESSION, "desk &co", [{ kind: "file", path: "/p" }]);
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/anchors/profiles/desk%20%26co");
    expect(init.method).toBe("PUT");
    vi.unstubAllGlobals();
  });

  it("says a refusal in the sidecar's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "profiles cannot be changed: x" }), { status: 409 })),
    );
    await expect(saveProfile(SESSION, "desk", [])).rejects.toThrow("profiles cannot be changed: x");
    vi.unstubAllGlobals();
  });

  it("refuses a mistyped head before it reaches the secret store", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    await expect(storeKeychainHead(SESSION, "desk", "abc")).rejects.toThrow();
    expect(fetched).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
