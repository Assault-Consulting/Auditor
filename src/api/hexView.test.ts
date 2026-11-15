// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import { describe as group, expect, it } from "vitest";

import { BYTES_PER_ROW, hexView, offsetLabel, tlvLabel } from "./hexView";
import type { RecordBytesView } from "./generated/types";

/** A made-up record: the numbers are the view's input, not a claim about the format. */
function view(over: Partial<RecordBytesView> = {}): RecordBytesView {
  return {
    seq: 3,
    index: 3,
    offset: 512,
    header_hex: "aa".repeat(20),
    body_hex: "bb".repeat(10),
    body_len: 10,
    body_shown: 10,
    header_fields: [
      { name: "magic", offset: 0, length: 4 },
      { name: "seq", offset: 4, length: 8 },
    ],
    header_tlvs: [{ type: 7, value_offset: 16, length: 2 }],
    body_tlvs: [{ type: 0x0101, value_offset: 24, length: 4 }],
    ...over,
  };
}

group("the raw view lays out the package's bytes and spans (C-06d)", () => {
  it("puts header and body bytes in rows of sixteen, in file order", () => {
    const v = hexView(view());
    expect(v.headerLen).toBe(20);
    expect(v.rows.map((r) => r.at)).toEqual([0, 16]);
    expect(v.rows[0]!.cells).toHaveLength(BYTES_PER_ROW);
    expect(v.rows[1]!.cells).toHaveLength(14);
    expect(v.rows[1]!.cells.map((c) => c.hex).join("")).toBe("aa".repeat(4) + "bb".repeat(10));
    expect(v.rows[1]!.cells[3]!.inBody).toBe(false);
    expect(v.rows[1]!.cells[4]!.inBody).toBe(true);
    expect(v.fileOffset).toBe(512);
  });

  it("names each byte by the span the package gave, and leaves the rest unnamed", () => {
    const v = hexView(view());
    const owner = (at: number) => {
      const cell = v.rows.flatMap((r) => r.cells).find((c) => c.at === at)!;
      return cell.segment === null ? null : v.segments[cell.segment]!.label;
    };
    expect(owner(0)).toBe("magic");
    expect(owner(11)).toBe("seq");
    expect(owner(12)).toBeNull();
    expect(owner(16)).toBe("TLV 7 (0x0007)");
    expect(owner(18)).toBeNull();
    expect(owner(24)).toBe("TLV 257 (0x0101)");
    expect(owner(28)).toBeNull();
    expect(v.segments.map((s) => s.zone)).toEqual(["field", "field", "header-tlv", "body-tlv"]);
    const opens = v.rows.flatMap((r) => r.cells).filter((c) => c.opens).map((c) => c.at);
    expect(opens).toEqual([0, 4, 16, 24]);
  });

  it("says why nothing is named when the package does not interpret the header", () => {
    const v = hexView(view({ header_fields: null, header_tlvs: null, body_tlvs: null }));
    expect(v.segments).toEqual([]);
    expect(v.rows.flatMap((r) => r.cells).every((c) => c.segment === null)).toBe(true);
    expect(v.notes[0]).toMatch(/does not interpret this header/);
    expect(v.notes[1]).toMatch(/no TLV layout for this body/);
    expect(v.notes.join(" ")).not.toMatch(/unnamed: the package names TLV values/);
  });

  it("says a body without a layout is shown as stored — an encrypted one, say", () => {
    const v = hexView(view({ body_tlvs: null }));
    expect(v.notes.some((n) => /no TLV layout for this body/.test(n))).toBe(true);
    expect(v.notes.some((n) => /does not interpret this header/.test(n))).toBe(false);
  });

  it("says nothing about a body layout when there is no body", () => {
    const v = hexView(view({ body_hex: "", body_len: 0, body_shown: 0, body_tlvs: null }));
    expect(v.notes.some((n) => /body/.test(n))).toBe(false);
    expect(v.rows.flatMap((r) => r.cells).some((c) => c.inBody)).toBe(false);
  });

  it("says how much of a long body was drawn, and draws no span past it", () => {
    const v = hexView(
      view({
        body_hex: "bb".repeat(4),
        body_len: 4000,
        body_shown: 4,
        body_tlvs: [{ type: 1, value_offset: 22, length: 3990 }],
      }),
    );
    expect(v.notes).toContain(
      "The first 4 of the body's 4000 bytes are shown; the rest are in the file, not drawn here.",
    );
    const cells = v.rows.flatMap((r) => r.cells);
    expect(cells).toHaveLength(24);
    expect(cells.filter((c) => c.segment === 3).map((c) => c.at)).toEqual([22, 23]);
  });

  it("lets the first span listed name a byte two spans claim", () => {
    const v = hexView(view({ header_tlvs: [{ type: 9, value_offset: 2, length: 4 }] }));
    const cells = v.rows.flatMap((r) => r.cells);
    expect(cells[2]!.segment).toBe(0);
    expect(cells[4]!.segment).toBe(1);
  });

  it("prints offsets and TLV types as given", () => {
    expect(offsetLabel(0)).toBe("0000");
    expect(offsetLabel(0x9c)).toBe("009c");
    expect(offsetLabel(0x12345)).toBe("12345");
    expect(tlvLabel(0x0101)).toBe("TLV 257 (0x0101)");
  });
});
