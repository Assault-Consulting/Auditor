// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { reportFileName, saveError, savedLine } from "./saveFile";
import { NoShellError } from "./session";

group("saving an artifact (D-07)", () => {
  it("offers the chain's own name with .report.json appended", () => {
    expect(reportFileName({ subject: { filename: "chain.pala" } })).toBe("chain.pala.report.json");
  });

  it("falls back to report.json when the report names no file", () => {
    expect(reportFileName({})).toBe("report.json");
    expect(reportFileName({ subject: { filename: "  " } })).toBe("report.json");
    expect(reportFileName({ subject: { filename: 7 } })).toBe("report.json");
  });

  it("says where the file went, its digest, and how to check it", () => {
    const line = savedLine({
      path: "/home/a/chain.pala.report.json",
      digest_path: "/home/a/chain.pala.report.json.sha256",
      sha256: "ab".repeat(32),
      bytes: 10,
    });
    expect(line).toContain("/home/a/chain.pala.report.json");
    expect(line).toContain("ab".repeat(32));
    expect(line).toContain("sha256sum -c chain.pala.report.json.sha256");
  });

  it("names the digest file by its base name on Windows paths too", () => {
    const line = savedLine({
      path: "C:\\r\\x.json",
      digest_path: "C:\\r\\x.json.sha256",
      sha256: "0".repeat(64),
      bytes: 1,
    });
    expect(line).toContain("sha256sum -c x.json.sha256");
  });

  it("keeps the shell's own refusal, and reads anything else as no shell", () => {
    const refused = saveError("/ro/x.json: permission denied");
    expect(refused).not.toBeInstanceOf(NoShellError);
    expect(refused.message).toBe("/ro/x.json: permission denied");
    expect(saveError(new TypeError("no __TAURI_INTERNALS__"))).toBeInstanceOf(NoShellError);
  });
});
