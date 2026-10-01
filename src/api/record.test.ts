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

import { PARSED_FROM_WIRE_NOTE, recordCard, REPORTED_BY_CLIENT_NOTE } from "./record";
import type { RecordView } from "./generated/types";

function view(over: Partial<RecordView> = {}): RecordView {
  return {
    seq: 12,
    index: 12,
    record_type: 4,
    type_name: "EVENT",
    kind: null,
    kind_name: null,
    boot_id: "b00t",
    span_id: null,
    parent_span_id: null,
    prev_hash: "ab" + "00".repeat(31),
    record_hash: "cd" + "00".repeat(31),
    prev_seq: 11,
    wall_clock_ns: 1_700_000_000_000_000_000,
    monotonic_ns: 42,
    assurance_tier: { value: 2, name: "B" },
    time_trust: { value: 1, name: "UNSYNCED" },
    body_len: 0,
    body_tlv_types: null,
    key_id: null,
    acknowledged: null,
    shredded_by: null,
    detail: null,
    recurrence_count: null,
    acknowledged_by: null,
    acknowledges: null,
    ack_latency_ns: null,
    operator_id: null,
    disposition: null,
    source: null,
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

  it("carries index separately from seq", () => {
    // A rotated chain's index and seq diverge (C-06b); the card must not
    // conflate them by carrying only one.
    const card = recordCard(view({ seq: 900, index: 3 }));
    expect(card.seq).toBe(900);
    expect(card.index).toBe(3);
  });

  it("carries prev_hash through as the record's own unverified claim", () => {
    const hash = "ab" + "00".repeat(31);
    const card = recordCard(view({ prev_hash: hash }));
    expect(card.prevHash).toBe(hash);
  });

  it("carries a null prev_hash through for a GENESIS-declared record", () => {
    // The sidecar has already resolved ZERO32 to null (§_hash_or_none);
    // the card must not reinterpret it, only pass it on.
    const card = recordCard(view({ prev_hash: null }));
    expect(card.prevHash).toBeNull();
  });

  it("carries the record's own hash through (C-06c, U10)", () => {
    const hash = "ef" + "11".repeat(31);
    const card = recordCard(view({ record_hash: hash }));
    expect(card.recordHash).toBe(hash);
  });

  it("carries prev_seq through as the seq to jump to, not seq - 1", () => {
    // The sidecar has already resolved the predecessor by file position
    // (see this module's own docstring); the card must not reinterpret
    // it, only pass it on — least of all by recomputing seq - 1 itself.
    const card = recordCard(view({ seq: 900, prev_seq: 3 }));
    expect(card.prevSeq).toBe(3);
  });

  it("carries a null prev_seq through when there is nowhere to jump", () => {
    const card = recordCard(view({ prev_seq: null }));
    expect(card.prevSeq).toBeNull();
  });

  it("carries acknowledged=true through for an acked candidate (C-07c, U13)", () => {
    const card = recordCard(view({ acknowledged: true }));
    expect(card.acknowledged).toBe(true);
  });

  it("carries acknowledged=false through for an unacked candidate", () => {
    const card = recordCard(view({ acknowledged: false }));
    expect(card.acknowledged).toBe(false);
  });

  it("carries a null acknowledged through for a record that is not a candidate", () => {
    // Not false — "not acknowledged" and "not the kind of record that
    // gets acknowledged" are different facts.
    const card = recordCard(view({ acknowledged: null }));
    expect(card.acknowledged).toBeNull();
  });

  it("carries shredded_by through as the shredding record's seq (C-07c, U15)", () => {
    const card = recordCard(view({ shredded_by: 42 }));
    expect(card.shredded).toBe(42);
  });

  it("carries a null shredded through for a record that is not shredded", () => {
    const card = recordCard(view({ shredded_by: null }));
    expect(card.shredded).toBeNull();
  });

  it("carries detail through as the record's own text (C-07b, U12)", () => {
    const card = recordCard(view({ detail: "guard escalation x3" }));
    expect(card.detail).toBe("guard escalation x3");
  });

  it("carries a null detail through for a record with none", () => {
    const card = recordCard(view({ detail: null }));
    expect(card.detail).toBeNull();
  });

  it("carries recurrenceCount through for a SAFETY record with a detail", () => {
    const card = recordCard(view({ detail: "sensor timeout", recurrence_count: 2 }));
    expect(card.recurrenceCount).toBe(2);
  });

  it("carries a null recurrenceCount through for a non-SAFETY record or one with no detail", () => {
    // Not 0 — the sidecar's own distinction: nothing to count is a
    // different fact from "this detail never recurs".
    const card = recordCard(view({ recurrence_count: null }));
    expect(card.recurrenceCount).toBeNull();
  });
});

// --- the oversight loop in full (C-07c) -------------------------------------

group("which ack, read both ways", () => {
  it("carries the ack that acknowledges a candidate", () => {
    const card = recordCard(view({ acknowledged: true, acknowledged_by: 6, ack_latency_ns: 0 }));
    expect(card.acknowledgedBy).toBe(6);
  });

  it("carries the candidate an ack acknowledges, and its own fields", () => {
    const card = recordCard(
      view({
        acknowledges: 3,
        operator_id: "01".repeat(16),
        disposition: { value: 1, name: "DISMISSED" },
      }),
    );
    expect(card.acknowledges).toBe(3);
    expect(card.operatorId).toBe("01".repeat(16));
    expect(card.disposition?.name).toBe("DISMISSED");
  });
});

group("ack latency says whose clock, and when it cannot be said", () => {
  it("is absent for a candidate nobody acknowledged", () => {
    expect(recordCard(view({ acknowledged: false })).ackLatency).toBeNull();
  });

  it("names the writer's clock when it is measured", () => {
    const card = recordCard(
      view({ acknowledged: true, acknowledged_by: 6, ack_latency_ns: 125_000_000_000 }),
    );
    expect(card.ackLatency).toEqual({
      kind: "measured",
      ns: 125_000_000_000,
      text: "2 min 5 s later, by the writer's clock",
    });
  });

  it("says a cross-boot pair has no latency, rather than showing a number", () => {
    // acknowledged_by non-null with a null latency is the sidecar's way of
    // saying a restart sits between the two.
    const card = recordCard(view({ acknowledged: true, acknowledged_by: 9, ack_latency_ns: null }));
    expect(card.ackLatency?.kind).toBe("cross-boot");
    expect(card.ackLatency?.text).toContain("no latency is computed across a restart");
  });

  it("shows a backwards clock as it is, not clamped to zero", () => {
    const card = recordCard(
      view({ acknowledged: true, acknowledged_by: 6, ack_latency_ns: -5_000_000_000 }),
    );
    expect(card.ackLatency?.text).toBe("the writer's clock puts the ack 5 s before the candidate");
  });

  it("never presents the figure as proved", () => {
    const card = recordCard(
      view({ acknowledged: true, acknowledged_by: 6, ack_latency_ns: 3_600_000_000_000 }),
    );
    expect(card.ackLatency?.text).toContain("writer's clock");
    expect(card.ackLatency?.text.toLowerCase()).not.toContain("proved");
  });
});

// --- client-reported provenance (C-12) ---------------------------------------

group("the evidence mark on a tool call or result", () => {
  it("is absent on a record that cannot carry one", () => {
    expect(recordCard(view({ source: null })).source).toBeNull();
  });

  it("carries the profile's own sentence for a reported call, verbatim", () => {
    const card = recordCard(view({ source: { value: 1, name: "reported-by-client" } }));
    expect(card.source?.kind).toBe("reported");
    expect(card.source?.label).toBe("reported by client");
    expect(card.source?.note).toBe(REPORTED_BY_CLIENT_NOTE);
    // The boundary is the whole reason the mark exists.
    expect(card.source?.note).toContain("never that the tool actually ran");
  });

  it("names a wire-parsed call as the serve's observation, not as nothing", () => {
    const card = recordCard(view({ source: { value: 0, name: "parsed-from-wire" } }));
    expect(card.source?.kind).toBe("wire");
    expect(card.source?.note).toBe(PARSED_FROM_WIRE_NOTE);
  });

  it("keeps an unknown value's number and guesses neither way", () => {
    // Guessing "wire" would upgrade a claim; guessing "reported" would
    // downgrade an observation.
    const card = recordCard(view({ source: { value: 7, name: null } }));
    expect(card.source?.kind).toBe("unknown");
    expect(card.source?.value).toBe(7);
    expect(card.source?.note).toBe("chain-checked, not interpretable by this verifier version");
  });

  it("never calls a reported call verified, observed or proved", () => {
    const card = recordCard(view({ source: { value: 1, name: "reported-by-client" } }));
    const text = `${card.source?.label} ${card.source?.note}`.toLowerCase();
    for (const claim of ["verified", "observed", "proved", "proven"]) {
      expect(text).not.toContain(claim);
    }
  });
});
