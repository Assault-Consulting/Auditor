// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe as group, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { printOpened, printReport } from "./saveFile";
import { NoShellError } from "./session";

group("printing the package's HTML report (D-02)", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("hands the page to the shell as it is, and nothing else", async () => {
    invoke.mockResolvedValue(null);
    await printReport("<html>the package's page</html>");
    expect(invoke).toHaveBeenCalledWith("print_report", { html: "<html>the package's page</html>" });
  });

  it("passes the shell's own refusal on as its sentence", async () => {
    invoke.mockImplementation(() => Promise.reject("the report page is 2000000 bytes, … \"Save HTML…\" …"));
    await expect(printReport("x")).rejects.toThrow(/Save HTML/);
  });

  it("says there is no shell when there is none", async () => {
    invoke.mockImplementation(() => Promise.reject(new TypeError("no __TAURI_INTERNALS__")));
    await expect(printReport("x")).rejects.toBeInstanceOf(NoShellError);
  });

  it("says where the page went and what the dialog offers, claiming nothing about it", () => {
    expect(printOpened()).toMatch(/window of its own/);
    expect(printOpened()).toMatch(/PDF/);
  });
});
