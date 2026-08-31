// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

/**
 * What a record card says about a record it was actually given.
 *
 * The subject is the three ambiguous-null cases `RecordView` carries:
 * an unnamed type, a kind that either does not exist or exists unnamed, and
 * a body that is absent, opaque, cleartext or undecoded. Each pair of nulls
 * means something different, and collapsing any of them is the failure
 * worth a test.
 */

import { describe as group, expect, it } from "vitest";

import { recordCard } from "./record";
import type { RecordView } from "./generated/types";

function view(over: Partial<RecordView> = {}): RecordView {
  return {
    seq: 12,
    record_type: 4,
    type_name: "EVENT",
    kind: null,
    kind_name: null,
    boot_id: "b00t",
    span_id: null,
    parent_span_id: null,
    wall_clock_ns: 1_700_000_000_000_000_000,
    monotonic_ns: 42,
    assurance_tier: { value: 2, name: "B" },
    time_trust: { value: 1, name: "UNSYNCED" },
    body_len: 0,
    body_tlv_types: null,
    key_id: null,
    ...over,
  };
}

// --- the type name: named, or F7's own sentence for unnamed --------------

group("what a record's type is", () => {
  it("carries the package's name when this build has one", () => {
    const card = recordCard(view({ type_name: "SAFETY" }));
    expect(card.typeLabel).toEqual({ named: true, name: "SAFETY" });
    expect(card.note).toBeNull();
  });

  it("uses F7's exact sentence for a type this build cannot name", () => {
    // Not "unknown type", not "unrecognised": the spec's own wording, so a
    // reader searching for this sentence finds the same one everywhere it
    // appears.
    const card = recordCard(view({ type_name: null }));
    expect(card.typeLabel).toEqual({ named: false });
    expect(card.note).toBe("chain-checked, not interpretable by this verifier version");
  });
});

// --- the kind: absent, unnamed, or named — three states, not two ---------

group("what a record's kind is", () => {
  it("reports no kind at all for a type that never carries one", () => {
    // GENESIS, BOOT and ANCHOR: kind is null by design, not a gap.
    const card = recordCard(view({ kind: null, kind_name: null }));
    expect(card.kindLabel).toEqual({ has: false });
  });

  it("keeps the raw number when a kind exists but this build cannot name it", () => {
    // The actual gap — distinct from "no kind at all" even though both
    // leave kind_name null.
    const card = recordCard(view({ kind: 77, kind_name: null }));
    expect(card.kindLabel).toEqual({ has: true, named: false, raw: 77 });
  });

  it("carries the package's name when this build has one", () => {
    const card = recordCard(view({ kind: 3, kind_name: "INCIDENT_CANDIDATE" }));
    expect(card.kindLabel).toEqual({ has: true, named: true, name: "INCIDENT_CANDIDATE" });
  });
});

// --- the body: none, opaque, cleartext or undecoded — never guessed at ---

group("what a record's body is", () => {
  it("is none for a record type with no body", () => {
    const card = recordCard(view({ body_len: 0, key_id: null, body_tlv_types: null }));
    expect(card.body).toEqual({ state: "none" });
  });

  it("is opaque whenever key_id says the body is encrypted", () => {
    // key_id decides this, never the presence of body_tlv_types: an
    // encrypted body has none to show, but the reason is the key, not the
    // absence.
    const card = recordCard(view({ body_len: 40, key_id: 3, body_tlv_types: null }));
    expect(card.body).toEqual({ state: "opaque" });
  });

  it("lists the TLV types present in a cleartext body", () => {
    const card = recordCard(
      view({ body_len: 12, key_id: null, body_tlv_types: [1, 4] }),
    );
    expect(card.body).toEqual({ state: "cleartext", tlvTypes: [1, 4] });
  });

  it("is cleartext-and-empty for a decoded body containing nothing, not none", () => {
    // [] and null mean different things on RecordView, and the card must
    // not fold a decoded-empty body into "no body" — the record does carry
    // one, it is just empty.
    const card = recordCard(view({ body_len: 4, key_id: null, body_tlv_types: [] }));
    expect(card.body).toEqual({ state: "cleartext", tlvTypes: [] });
  });

  it("is undecoded for a present, unencrypted body this build cannot parse", () => {
    const card = recordCard(view({ body_len: 8, key_id: null, body_tlv_types: null }));
    expect(card.body).toEqual({ state: "undecoded" });
  });
});

// --- the envelope fields pass through, formatted where they need it ------

group("the envelope", () => {
  it("carries seq, boot, span and lineage through unchanged", () => {
    const card = recordCard(
      view({ seq: 900, boot_id: "abc123", span_id: "s-1", parent_span_id: "s-0" }),
    );
    expect(card.seq).toBe(900);
    expect(card.bootId).toBe("abc123");
    expect(card.spanId).toBe("s-1");
    expect(card.parentSpanId).toBe("s-0");
  });

  it("renders wall_clock_ns as an ISO instant", () => {
    const card = recordCard(view({ wall_clock_ns: 0 }));
    expect(card.wallClockIso).toBe("1970-01-01T00:00:00.000Z");
  });
});
