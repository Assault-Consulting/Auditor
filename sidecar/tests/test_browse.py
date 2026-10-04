# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Browsing a container: boots, spans and records.

Browsing answers no question about soundness, and that separation is the
point. A chain that fails verification stays fully browsed — inspecting
evidence that did not pass is half the job — so none of these endpoints
consults a verdict and none of them refuses on one.

What they do refuse on is the file having changed, for the same reason
`/verify` does: a record list read from bytes nobody holds any more looks
exactly like one that describes the file in front of you.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def _open(client: TestClient, path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def _split_points(data: bytes) -> tuple[int, int]:
    """Offsets of the second and third records, found by the container magic.

    Matches ``test_mutations.py``'s own helper of the same name and same
    exemption from the no-wire-parsing scan: a fixture needs to damage a
    specific record, and there is no package API for "give me byte offsets
    so I can corrupt them".
    """
    second = data.index(b"PALA", 4)
    third = data.index(b"PALA", second + 4)
    return second, third


# --- boots ------------------------------------------------------------------


def test_a_boot_reports_its_range_and_uptime(open_client: TestClient, chain_path) -> None:
    """Uptime is reported, and zero is one of the answers it can give.

    This asserted `> 0` when first written and failed on the Windows leg,
    which is the more useful result than a pass would have been.

    `uptime_ns` is the monotonic span between a boot's first and last
    record. Linux resolves `monotonic` to a nanosecond; Windows resolves it
    to about 15.6 milliseconds. A fixture chain written in one burst takes
    microseconds, so on Windows every record shares a single reading and the
    span is exactly zero.

    Zero is therefore a true statement about a real boot — every record
    inside one clock tick — and the test was asserting the speed of the
    platform's clock rather than anything this application does. Treating a
    legitimate value as a failure is the mistake this codebase spends its
    time refusing to make elsewhere; it is not better when a test makes it.
    """
    sid = _open(open_client, chain_path)
    boots = open_client.get(f"/session/{sid}/boots").json()

    assert len(boots) == 1
    boot = boots[0]
    assert boot["first_seq"] == 0
    assert boot["last_seq"] == 4
    assert boot["record_count"] == 5
    # Present, and the package's figure rather than a subtraction done in
    # the seam. Null would mean the package could not compute one at all,
    # which is a different answer from a boot that lasted no measurable time.
    assert isinstance(boot["uptime_ns"], int)
    assert boot["uptime_ns"] >= 0


def test_time_trust_is_a_set_not_the_latest_value(
    open_client: TestClient, chain_path
) -> None:
    """More than one value means the clock changed status mid-boot, which
    qualifies every wall-time claim inside it. Reducing to the last one
    would erase that, so the field is a list even when it holds one."""
    sid = _open(open_client, chain_path)
    values = open_client.get(f"/session/{sid}/boots").json()[0]["time_trust_values"]

    assert isinstance(values, list)
    assert values == [{"value": 1, "name": "UNSYNCED"}]


def test_anchor_cadence_reports_the_widest_gap(
    open_client: TestClient, chain_path
) -> None:
    """The useful figure: how long the chain went without an external
    witness, and therefore how wide an "existed by" bracket would be.

    Checked for presence rather than for magnitude, and deliberately: this
    is a monotonic interval like uptime_ns, so on a platform with a coarse
    clock it can legitimately be zero. Null would be the real absence — no
    anchor cadence to report — and that is what this distinguishes.
    """
    sid = _open(open_client, chain_path)
    anchors = open_client.get(f"/session/{sid}/boots").json()[0]["anchors"]

    assert anchors["count"] == 1
    assert anchors["widest_gap_ns"] is not None


def test_a_boot_that_recovered_nothing_reports_null(
    open_client: TestClient, chain_path
) -> None:
    """Null is the ordinary case rather than a missing value."""
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/boots").json()[0]["recovery_seq"] is None


# --- spans ------------------------------------------------------------------


def test_a_chain_with_no_spans_reports_an_empty_list(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/spans").json() == []


def test_an_unclosed_span_reports_a_null_end(open_client: TestClient, spanned_chain) -> None:
    """First-class evidence, not a defect.

    An interrupted operation looks exactly like this, and the record of it
    is intact. Filling `end_seq` in with the last record seen would turn a
    fact about the world into an invention of this application.
    """
    sid = _open(open_client, spanned_chain)
    spans = open_client.get(f"/session/{sid}/spans").json()

    assert len(spans) == 1
    assert spans[0]["start_seq"] is not None
    assert spans[0]["end_seq"] is None
    assert spans[0]["record_count"] >= 1


# --- records ----------------------------------------------------------------


def test_a_record_reports_its_type_and_kind_names(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]

    by_seq = {r["seq"]: r for r in records}
    assert by_seq[0]["type_name"] == "GENESIS"
    assert by_seq[3]["type_name"] == "SAFETY"
    assert by_seq[3]["kind_name"] == "INCIDENT_CANDIDATE"


# --- a record's own hash and prev_seq (C-06c, U10 released 0.11.0) ---------
#
# prev_seq is the seq to jump to for the predecessor prev_hash names — and
# it is NOT seq - 1. Confirmed by reading IncrementalVerifier.step()
# directly: the hash-link check compares a record against whatever was
# immediately before it IN THE FILE, and a seq gap is a wholly separate,
# independent check. Rotation and segments (also 0.11.0) mean a real seq
# gap with an intact hash chain is an ordinary case, not a hypothetical
# one — these tests exist because the naive "seq - 1" answer would be
# silently wrong in exactly that case, sending a reader to a record that
# either does not exist or is not the one prev_hash actually names.


def test_record_hash_is_present_and_looks_like_a_hash(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]
    for record in records:
        assert len(record["record_hash"]) == 64
        bytes.fromhex(record["record_hash"])  # raises if not hex


def test_genesis_has_no_prev_seq(open_client: TestClient, chain_path) -> None:
    """Index 0: nothing in this file to jump to, GENESIS's own declared
    zero predecessor or not."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]
    genesis = next(r for r in records if r["type_name"] == "GENESIS")
    assert genesis["index"] == 0
    assert genesis["prev_seq"] is None


def test_an_ordinary_record_s_prev_seq_is_its_file_predecessor(
    open_client: TestClient, chain_path
) -> None:
    """The unremarkable case, where index and seq happen to agree —
    checked so the remarkable case below is a contrast, not the only
    evidence this field works at all."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]
    by_seq = {r["seq"]: r for r in records}
    assert by_seq[2]["prev_seq"] == by_seq[1]["seq"]


def test_prev_seq_resolves_by_file_position_not_by_seq_minus_one(
    open_client: TestClient, chain_path
) -> None:
    """Drop the second record (index 1, seq 1) entirely: every record
    after it keeps its original seq (a real gap at 1), but each one's
    file position shifts down by one.

    The record that was seq 2 is now at index 1 in this file — file-
    adjacent to the untouched seq-0 record, not to anything at "seq 1",
    which no longer exists. `prev_seq - 1` would give 1 here: wrong,
    and not even a seq present in the file to send a reader to. The
    correct answer, read by file position, is 0.
    """
    data = chain_path.read_bytes()
    second, third = _split_points(data)
    chain_path.write_bytes(data[:second] + data[third:])

    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]
    by_seq = {r["seq"]: r for r in records}

    assert 1 not in by_seq  # confirms the gap actually exists
    now_at_index_one = by_seq[2]
    assert now_at_index_one["index"] == 1
    assert now_at_index_one["prev_seq"] == 0


def test_a_record_type_with_no_kind_reports_null(
    open_client: TestClient, chain_path
) -> None:
    """Null because GENESIS has no kind at all — which is not the same as a
    kind this build cannot name, and the two must not look alike."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]
    assert {r["seq"]: r["kind_name"] for r in records}[0] is None


def test_no_span_is_null_and_not_sixteen_zero_bytes(
    open_client: TestClient, chain_path
) -> None:
    """PALA-1 spells "no span" as ZERO16, checked against the package's own
    spans(), which skips records carrying it. Hexing it blindly would put a
    span named 00000000… on the screen and into reports."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]

    assert all(r["span_id"] is None for r in records)
    assert all(r["parent_span_id"] is None for r in records)


def test_an_unencrypted_body_reports_no_key(open_client: TestClient, chain_path) -> None:
    """key_id is an integer and zero means "no named key", not "key zero"."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]
    assert all(r["key_id"] is None for r in records)


def test_tlv_types_are_listed_and_contents_are_not(
    open_client: TestClient, chain_path
) -> None:
    """Structure, not content. Bodies may be encrypted, and what is inside a
    record needs its own decisions about keys and redaction — except
    `detail`, decoded generically now (U12, C-07b); see the dedicated
    tests below for that field specifically."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]

    safety = next(r for r in records if r["seq"] == 3)
    assert safety["body_tlv_types"] == [1, 4, 5, 6]
    # Length, not content — and asserted as "there is a body" rather than
    # against a constant, which would only be pinning the fixture's detail
    # string.
    assert safety["body_len"] > 0
    # No field anywhere carries the raw bytes.
    assert "body" not in safety


def test_a_record_with_no_body_reports_null_tlvs_not_empty(
    open_client: TestClient, chain_path
) -> None:
    """Null and [] are different facts.

    Null is "this view has no TLV types to show" — a record type with no
    body here, but an encrypted or unparseable one reaches it the same way.
    [] would mean a decoded body that contained nothing.
    """
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]

    genesis = next(r for r in records if r["seq"] == 0)
    assert genesis["body_len"] == 0
    assert genesis["body_tlv_types"] is None


# --- paging -----------------------------------------------------------------


def test_a_window_reports_where_it_sits(open_client: TestClient, chain_path) -> None:
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?offset=1&limit=2").json()

    assert [r["seq"] for r in page["records"]] == [1, 2]
    assert page["offset"] == 1
    assert page["limit"] == 2
    assert page["total"] == 5
    assert page["has_more"] is True


def test_has_more_is_stated_not_inferred(open_client: TestClient, chain_path) -> None:
    """A window ending exactly on the last record returns `limit` records and
    has nothing after it. `len(records) == limit` cannot tell those apart."""
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?offset=3&limit=2").json()

    assert len(page["records"]) == page["limit"] == 2
    assert page["has_more"] is False


def test_a_window_past_the_end_is_empty_not_an_error(
    open_client: TestClient, chain_path
) -> None:
    """Asking for records that are not there is a question with an answer."""
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?offset=99").json()

    assert page["records"] == []
    assert page["has_more"] is False
    assert page["total"] == 5


@pytest.mark.parametrize("query", ["limit=5000", "limit=0", "offset=-1"])
def test_the_page_size_is_bounded(open_client: TestClient, chain_path, query: str) -> None:
    """The caller chooses the page size and must not be able to ask for a
    response the sidecar cannot build."""
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/records?{query}").status_code == 422


# --- filters ----------------------------------------------------------------


def test_a_type_filter_narrows_the_window(open_client: TestClient, chain_path) -> None:
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?record_type=64").json()

    assert [r["seq"] for r in page["records"]] == [3]
    assert page["records"][0]["type_name"] == "SAFETY"


def test_total_counts_the_matches_not_the_file(
    open_client: TestClient, chain_path
) -> None:
    """A total counting everything would print "1 of 5" above the only row
    there is, which is a different and false statement."""
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?record_type=64").json()

    assert page["total"] == 1
    assert page["has_more"] is False


def test_a_boot_filter_keeps_that_boot(open_client: TestClient, chain_path) -> None:
    sid = _open(open_client, chain_path)
    boot_id = open_client.get(f"/session/{sid}/boots").json()[0]["boot_id"]
    page = open_client.get(f"/session/{sid}/records?boot_id={boot_id}").json()

    assert page["total"] == 5
    assert all(r["boot_id"] == boot_id for r in page["records"])


def test_filtering_by_something_absent_is_an_empty_answer(
    open_client: TestClient, chain_path
) -> None:
    """Not an error. "Show me that boot's records" has a truthful answer
    when the file does not contain that boot, and it is an empty list."""
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?boot_id={'ff' * 16}").json()

    assert page["records"] == []
    assert page["total"] == 0
    assert page["has_more"] is False


def test_filters_and_paging_compose(open_client: TestClient, chain_path) -> None:
    """The window is drawn from the matches, so has_more is about them too."""
    sid = _open(open_client, chain_path)
    boot_id = open_client.get(f"/session/{sid}/boots").json()[0]["boot_id"]
    page = open_client.get(
        f"/session/{sid}/records?boot_id={boot_id}&limit=2"
    ).json()

    assert len(page["records"]) == 2
    assert page["total"] == 5
    assert page["has_more"] is True


# --- filters by name (C-09b) ------------------------------------------------
#
# The chips a reader types — kind:, type:, tier: — are names, and the only
# authority on a name is the package. These filters compare against the name
# the package resolved on each record, so no name-to-number table exists
# anywhere on this side of the seam to drift from it.


def test_a_type_name_filter_matches_what_the_record_card_shows(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?type_name=SAFETY").json()

    assert [r["type_name"] for r in page["records"]] == ["SAFETY"]
    assert page["total"] == 1


def test_a_kind_name_filter_keeps_only_that_kind(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(
        f"/session/{sid}/records?kind_name=INCIDENT_CANDIDATE"
    ).json()

    assert page["total"] == 3
    assert {r["kind_name"] for r in page["records"]} == {"INCIDENT_CANDIDATE"}


def test_a_tier_filter_uses_the_package_tier_name(
    open_client: TestClient, chain_path
) -> None:
    """The fixture's writer defaults to tier A. Asking for A keeps
    everything; asking for B keeps nothing — an empty answer, not an
    error, the same as any other filter on a value that is not there."""
    sid = _open(open_client, chain_path)
    tiers = {
        r["assurance_tier"]["name"]
        for r in open_client.get(f"/session/{sid}/records").json()["records"]
    }
    assert tiers == {"A"}

    assert open_client.get(f"/session/{sid}/records?tier=A").json()["total"] == 5
    assert open_client.get(f"/session/{sid}/records?tier=B").json()["total"] == 0


def test_name_filters_are_exact_not_case_folded(
    open_client: TestClient, chain_path
) -> None:
    """The names are the package's. Folding case here would be a second
    opinion about what a name is — the chip parser normalises what a
    person typed, the endpoint does not guess."""
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/records?type_name=safety").json()["total"] == 0


def test_name_filters_compose_with_the_others(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    boot_id = open_client.get(f"/session/{sid}/boots").json()[0]["boot_id"]
    page = open_client.get(
        f"/session/{sid}/records?type_name=SAFETY&kind_name=OVERSIGHT_ACK&boot_id={boot_id}"
    ).json()

    assert page["total"] == 1
    assert page["records"][0]["kind_name"] == "OVERSIGHT_ACK"


def test_an_unknown_name_is_an_empty_answer(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?kind_name=NO_SUCH_KIND").json()

    assert page["records"] == []
    assert page["total"] == 0


# --- one record -------------------------------------------------------------


def test_a_record_by_sequence(open_client: TestClient, chain_path) -> None:
    sid = _open(open_client, chain_path)
    record = open_client.get(f"/session/{sid}/record/3").json()

    assert record["seq"] == 3
    assert record["type_name"] == "SAFETY"
    assert record["kind_name"] == "INCIDENT_CANDIDATE"


def test_a_record_view_is_identical_from_both_routes(
    open_client: TestClient, chain_path
) -> None:
    """One builder, so the window and the single view cannot describe the
    same record differently — which they would, eventually, if each built
    its own dict."""
    sid = _open(open_client, chain_path)
    from_window = next(
        r
        for r in open_client.get(f"/session/{sid}/records").json()["records"]
        if r["seq"] == 3
    )
    assert open_client.get(f"/session/{sid}/record/3").json() == from_window


def test_a_sequence_this_file_does_not_hold_is_404(
    open_client: TestClient, chain_path
) -> None:
    """A segment covering records 400-900 legitimately has no record 12, and
    the message says which is missing rather than implying the session is."""
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/record/99")

    assert r.status_code == 404
    assert "record 99" in r.json()["detail"]


# --- origin -----------------------------------------------------------------
#
# Three states, not the two a bare `None` could tell apart (C-08b, U11
# released 0.11.0): "active" (a model is declared running), "unloaded"
# (one was declared, then a MODEL_UNLOAD explicitly ended it), and
# "not_stated" (nothing has been declared at or before this record at
# all). `origin_at()` alone returns null for the last two alike.


def test_origin_reports_what_was_running(open_client: TestClient, chain_path) -> None:
    sid = _open(open_client, chain_path)
    state = open_client.get(f"/session/{sid}/origin?seq=4").json()

    assert state["state"] == "active"
    assert state["origin"]["role"] == "engine.native"
    assert len(state["origin"]["model_digest"]) == 64
    assert state["origin"]["since_seq"] == 2


def test_origin_names_the_record_that_declared_it(
    open_client: TestClient, chain_path
) -> None:
    """since_seq is what makes this checkable rather than a claim to accept:
    a reader jumps to that record and sees the declaration."""
    sid = _open(open_client, chain_path)
    state = open_client.get(f"/session/{sid}/origin?seq=4").json()

    declaring = open_client.get(
        f"/session/{sid}/record/{state['origin']['since_seq']}"
    ).json()
    assert declaring["kind_name"] == "MODEL_LOAD"


def test_no_origin_before_the_first_declaration_is_not_stated(
    open_client: TestClient, chain_path
) -> None:
    """200, always — the question is always answered. Before U11 this
    collapsed to the same null an unload also produces; now it is its
    own named state, distinguishable from "unloaded" on the wire."""
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/origin?seq=0")

    assert r.status_code == 200
    assert r.json() == {"state": "not_stated", "origin": None}


def test_origin_after_an_unload_is_its_own_state(
    open_client: TestClient, tmp_path
) -> None:
    """The state U11 exists for: origin_at() alone cannot tell this
    apart from "never declared" — both leave its running state at
    None — and unloaded_at() is what does."""
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "unloaded.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32)
    w.model_unload()
    unload_seq = w.seq - 1
    w.close()

    sid = _open(open_client, path)
    state = open_client.get(f"/session/{sid}/origin?seq={unload_seq}").json()

    assert state == {"state": "unloaded", "origin": None}


def test_origin_requires_a_sequence(open_client: TestClient, chain_path) -> None:
    """Origin changes along a chain, so a defaulted seq would answer a
    different question than the caller meant."""
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/origin").status_code == 422


# --- safety -------------------------------------------------------------


def test_safety_lists_only_safety_records(
    open_client: TestClient, safety_heavy_chain
) -> None:
    """Not GENESIS, BOOT, the MODEL_LOAD event, or ANCHOR — three
    INCIDENT_CANDIDATE and one OVERSIGHT_ACK, and nothing else."""
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety").json()

    assert [r["seq"] for r in page["records"]] == [3, 4, 5, 6]
    assert {r["kind_name"] for r in page["records"]} == {
        "INCIDENT_CANDIDATE",
        "OVERSIGHT_ACK",
    }


def test_safety_reports_the_kind_names_already_resolved(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/safety").json()

    assert len(page["records"]) == 1
    assert page["records"][0]["type_name"] == "SAFETY"
    assert page["records"][0]["kind_name"] == "INCIDENT_CANDIDATE"


def test_safety_carries_its_detail_text(
    open_client: TestClient, chain_path
) -> None:
    """The gap this section's own tests used to document — closed
    (U12, released 0.11.0; C-07b). `chain_path`'s one SAFETY record
    carries a real detail string, not empty."""
    sid = _open(open_client, chain_path)
    record = open_client.get(f"/session/{sid}/safety").json()["records"][0]

    assert record["detail"] == "guard escalation x3"


def test_detail_is_null_for_a_candidate_written_without_one(
    open_client: TestClient, tmp_path
) -> None:
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "no-detail.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.incident_candidate(category=1, severity=2)
    w.close()

    sid = _open(open_client, path)
    record = open_client.get(f"/session/{sid}/safety").json()["records"][0]

    assert record["detail"] is None


# --- recurrence_count (U12, C-07b) -----------------------------------------
#
# F8's own framing: "detail text and a recurrence count for identical
# details". Scoped to SAFETY the way `acknowledged` is scoped to
# INCIDENT_CANDIDATE — null for anything outside that scope, never 0.


def test_a_unique_detail_recurs_once(
    open_client: TestClient, safety_heavy_chain
) -> None:
    """safety_heavy_chain's three candidates carry distinct details
    ("first", "second", "third") — each recurs only as itself."""
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety").json()
    by_seq = {r["seq"]: r for r in page["records"]}

    assert by_seq[3]["detail"] == "first"
    assert by_seq[3]["recurrence_count"] == 1
    assert by_seq[4]["detail"] == "second"
    assert by_seq[4]["recurrence_count"] == 1


def test_a_repeated_detail_is_counted_on_every_record_that_carries_it(
    open_client: TestClient, tmp_path
) -> None:
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "repeated-detail.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.incident_candidate(category=1, severity=2, detail="sensor timeout")
    first_seq = w.seq - 1
    w.incident_candidate(category=1, severity=1, detail="unrelated")
    w.incident_candidate(category=1, severity=2, detail="sensor timeout")
    third_seq = w.seq - 1
    w.close()

    sid = _open(open_client, path)
    page = open_client.get(f"/session/{sid}/safety").json()
    by_seq = {r["seq"]: r for r in page["records"]}

    assert by_seq[first_seq]["recurrence_count"] == 2
    assert by_seq[third_seq]["recurrence_count"] == 2


def test_recurrence_count_is_null_without_a_detail(
    open_client: TestClient, tmp_path
) -> None:
    """Null, not 0 — nothing to count is a different fact from "this
    detail never recurs", and a SAFETY record with no detail at all
    has no detail to have a count of."""
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "no-detail-count.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.incident_candidate(category=1, severity=2)
    w.close()

    sid = _open(open_client, path)
    record = open_client.get(f"/session/{sid}/safety").json()["records"][0]

    assert record["recurrence_count"] is None


def test_recurrence_count_is_null_for_a_non_safety_record_even_with_a_detail(
    open_client: TestClient, tmp_path
) -> None:
    """detail is decoded generically (EVENT and SAFETY bodies alike);
    recurrence_count is F8's own SAFETY-list feature and stays null
    outside that scope regardless — a MODEL_LOAD's detail is a
    different fact than a SAFETY record's, and counting the two
    together would answer a question nobody asked."""
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "event-detail.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32, detail="engine warmed up")
    load_seq = w.seq - 1
    w.close()

    sid = _open(open_client, path)
    record = open_client.get(f"/session/{sid}/record/{load_seq}").json()

    assert record["detail"] == "engine warmed up"
    assert record["recurrence_count"] is None


def test_an_unacknowledged_candidate_is_acknowledged_false(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety").json()
    by_seq = {r["seq"]: r for r in page["records"]}

    assert by_seq[4]["kind_name"] == "INCIDENT_CANDIDATE"
    assert by_seq[4]["acknowledged"] is False


def test_an_acknowledged_candidate_is_acknowledged_true(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety").json()
    by_seq = {r["seq"]: r for r in page["records"]}

    assert by_seq[3]["kind_name"] == "INCIDENT_CANDIDATE"
    assert by_seq[3]["acknowledged"] is True


def test_acknowledged_is_null_for_a_record_that_is_not_a_candidate(
    open_client: TestClient, safety_heavy_chain
) -> None:
    """Null, not false — 'not acknowledged' and 'not the kind of
    record that gets acknowledged' are different facts, and the
    OVERSIGHT_ACK record itself must not claim the first."""
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety").json()
    by_seq = {r["seq"]: r for r in page["records"]}

    assert by_seq[6]["kind_name"] == "OVERSIGHT_ACK"
    assert by_seq[6]["acknowledged"] is None


# --- the oversight loop in full (C-07c) --------------------------------------
#
# Which ack, read both ways, from the package's own hash-verified mapping;
# the ack's own operator and disposition; and latency — a Recorded figure,
# same boot only.


def test_a_candidate_names_the_ack_that_acknowledges_it(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    by_seq = {r["seq"]: r for r in open_client.get(f"/session/{sid}/safety").json()["records"]}

    assert by_seq[3]["acknowledged_by"] == 6
    assert by_seq[4]["acknowledged_by"] is None  # not acknowledged
    assert by_seq[6]["acknowledged_by"] is None  # not a candidate


def test_an_ack_names_the_candidate_it_acknowledges(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    by_seq = {r["seq"]: r for r in open_client.get(f"/session/{sid}/safety").json()["records"]}

    assert by_seq[6]["acknowledges"] == 3
    assert by_seq[3]["acknowledges"] is None


def test_an_ack_carries_its_operator_and_disposition_as_the_package_decoded_them(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    ack = open_client.get(f"/session/{sid}/record/6").json()

    assert ack["operator_id"] == "01" * 16
    assert ack["disposition"] == {"value": 1, "name": "DISMISSED"}


def test_records_without_ack_fields_report_null_not_empty(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    candidate = open_client.get(f"/session/{sid}/record/3").json()

    assert candidate["operator_id"] is None
    assert candidate["disposition"] is None


def test_an_ack_whose_reference_does_not_verify_acknowledges_nothing(
    open_client: TestClient, tmp_path
) -> None:
    """The right seq, the wrong hash. The package does not count it, and
    neither side of the pair may look acknowledged — the advisory channel
    is where this one is named (reference_hash_mismatch)."""
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "broken-ack.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.incident_candidate(category=1, severity=2, detail="c")
    candidate_seq = w.seq - 1
    w.oversight_ack(candidate_seq, b"\xee" * 32, disposition=1, operator_id=b"\x02" * 16)
    ack_seq = w.seq - 1
    w.close()

    sid = _open(open_client, path)
    candidate = open_client.get(f"/session/{sid}/record/{candidate_seq}").json()
    ack = open_client.get(f"/session/{sid}/record/{ack_seq}").json()

    assert candidate["acknowledged"] is False
    assert candidate["acknowledged_by"] is None
    assert ack["acknowledges"] is None
    # Its own fields are still what the writer recorded — decoded, not judged.
    assert ack["operator_id"] == "02" * 16


def _controlled_clock(monkeypatch, start: int, step: int):
    import palimpsests.audit.pala_writer as pw

    clock = {"now": start}

    def _tick() -> int:
        now = clock["now"]
        clock["now"] += step
        return now

    monkeypatch.setattr(pw.time, "time_ns", _tick)
    return clock


def test_ack_latency_is_the_writers_clock_within_one_boot(
    open_client: TestClient, tmp_path, monkeypatch
) -> None:
    from palimpsests.audit.pala_writer import PalaWriter

    _controlled_clock(monkeypatch, 1_787_000_000_000_000_000, 60_000_000_000)
    path = tmp_path / "latency.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    candidate_hash = w.incident_candidate(category=1, severity=2, detail="c")
    candidate_seq = w.seq - 1
    w.model_load(b"\x11" * 32, b"\x22" * 32)  # one minute passes in between
    w.oversight_ack(candidate_seq, candidate_hash, disposition=1, operator_id=b"\x01" * 16)
    w.close()

    sid = _open(open_client, path)
    candidate = open_client.get(f"/session/{sid}/record/{candidate_seq}").json()

    assert candidate["ack_latency_ns"] == 2 * 60_000_000_000


def test_ack_latency_is_not_computed_across_a_boot(
    open_client: TestClient, tmp_path, monkeypatch
) -> None:
    """A restart sits between the two: the clock may have been set, and a
    number would span a period nobody observed. acknowledged_by stays —
    the acknowledgement is a chain fact; only the subtraction is withheld."""
    from palimpsests.audit.pala_writer import PalaWriter

    clock = _controlled_clock(monkeypatch, 1_787_000_000_000_000_000, 1_000_000_000)
    path = tmp_path / "crossboot.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    candidate_hash = w.incident_candidate(category=1, severity=2, detail="c")
    candidate_seq = w.seq - 1
    w.close()
    clock["now"] += 3_600_000_000_000

    w2 = PalaWriter.open_existing(path)
    w2.boot()
    w2.oversight_ack(candidate_seq, candidate_hash, disposition=1, operator_id=b"\x01" * 16)
    ack_seq = w2.seq - 1
    w2.close()

    sid = _open(open_client, path)
    candidate = open_client.get(f"/session/{sid}/record/{candidate_seq}").json()

    assert candidate["acknowledged_by"] == ack_seq
    assert candidate["ack_latency_ns"] is None


# --- client-reported provenance (C-12) --------------------------------------
#
# EVT_SOURCE, inference profile r5: a tool call or result the serving layer
# parsed from the wire it mediated, or one a client reported through the
# ingestion surface. The chain proves a report happened, what it digested
# and when — never that the tool ran. The mark is passed through as the
# package decoded it; this side adds nothing to it.


@pytest.fixture
def sourced_chain(tmp_path):
    from palimpsests.audit.pala_writer import (
        OUTCOME_OK,
        SOURCE_REPORTED_BY_CLIENT,
        PalaWriter,
    )

    path = tmp_path / "sourced.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    wire_hash = w.tool_call("search")  # seq 2, no tag: parsed-from-wire
    w.tool_result(2, wire_hash, OUTCOME_OK)  # seq 3
    reported_hash = w.tool_call("shell", source=SOURCE_REPORTED_BY_CLIENT)  # seq 4
    w.tool_result(4, reported_hash, OUTCOME_OK, source=SOURCE_REPORTED_BY_CLIENT)  # seq 5
    w.close()
    return path


def test_a_wire_parsed_call_says_so_rather_than_nothing(
    open_client: TestClient, sourced_chain
) -> None:
    """No tag on the wire, and still a mark: the package decodes absence as
    parsed-from-wire on kinds 8/9, calling it "a claim, not the absence of
    one". Null here would erase the distinction the profile draws."""
    sid = _open(open_client, sourced_chain)
    call = open_client.get(f"/session/{sid}/record/2").json()

    assert call["source"] == {"value": 0, "name": "parsed-from-wire"}


def test_a_client_reported_call_and_its_result_are_marked(
    open_client: TestClient, sourced_chain
) -> None:
    sid = _open(open_client, sourced_chain)
    call = open_client.get(f"/session/{sid}/record/4").json()
    result = open_client.get(f"/session/{sid}/record/5").json()

    assert call["source"] == {"value": 1, "name": "reported-by-client"}
    assert result["source"] == {"value": 1, "name": "reported-by-client"}


def test_a_record_that_cannot_carry_the_mark_reports_null(
    open_client: TestClient, sourced_chain
) -> None:
    """GENESIS, BOOT, SAFETY: the mark has no meaning there. Null, not
    parsed-from-wire — a record that was never a tool call was not observed
    on any wire."""
    sid = _open(open_client, sourced_chain)
    for seq in (0, 1):
        assert open_client.get(f"/session/{sid}/record/{seq}").json()["source"] is None


def test_a_source_filter_keeps_only_that_mark(
    open_client: TestClient, sourced_chain
) -> None:
    sid = _open(open_client, sourced_chain)
    reported = open_client.get(
        f"/session/{sid}/records?source_name=reported-by-client"
    ).json()
    wire = open_client.get(f"/session/{sid}/records?source_name=parsed-from-wire").json()

    assert [r["seq"] for r in reported["records"]] == [4, 5]
    assert [r["seq"] for r in wire["records"]] == [2, 3]


def test_a_source_filter_never_matches_an_unmarked_record(
    open_client: TestClient, chain_path
) -> None:
    """chain_path has no tool calls at all — so neither name matches anything,
    and in particular parsed-from-wire does not sweep in every record."""
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?source_name=parsed-from-wire").json()

    assert page["total"] == 0


# --- time jump, date range, anchor (C-09c) -----------------------------------
#
# All three are about the writer's clock or the anchor, and each answer has
# to carry what qualifies it. "Nearest to 22:41" is a statement about a
# Recorded clock; a date range filters on the same claim; the anchor button
# finds the record a head names, or finds nothing — never the last record.

#: 2026-08-06T22:41:00Z, the instant Phase 2's exit criterion asks about.
_AUG_6_22_41 = 1_786_056_060_000_000_000
_MINUTE = 60_000_000_000


@pytest.fixture
def evening_chain(tmp_path, monkeypatch):
    """A boot that runs across 22:41 on 6 Aug, one record a minute, with
    the SAFETY record written at exactly 22:41 by the writer's clock."""
    from palimpsests.audit.pala_writer import PalaWriter

    _controlled_clock(monkeypatch, _AUG_6_22_41 - 3 * _MINUTE, _MINUTE)
    path = tmp_path / "evening.pala"
    w = PalaWriter(path)
    w.genesis()  # 22:38
    w.boot()  # 22:39
    w.model_load(b"\x11" * 32, b"\x22" * 32)  # 22:40
    w.incident_candidate(category=1, severity=2, detail="guard tripped")  # 22:41, seq 3
    w.anchor()  # 22:42
    w.close()
    return path


def test_the_phase_2_exit_criterion_question_is_answerable(
    open_client: TestClient, evening_chain
) -> None:
    """"What happened at 22:41 on 6 Aug": the nearest record by the writer's
    clock is the SAFETY record written then, and the answer says whose
    clock it was."""
    sid = _open(open_client, evening_chain)
    near = open_client.get(f"/session/{sid}/nearest?wall_ns={_AUG_6_22_41}").json()

    assert near["seq"] == 3
    assert near["delta_ns"] == 0
    assert near["basis"] == "recorded"
    assert near["time_trust"]["name"] == "UNSYNCED"
    record = open_client.get(f"/session/{sid}/record/{near['seq']}").json()
    assert record["kind_name"] == "INCIDENT_CANDIDATE"


def test_nearest_reports_a_signed_distance(open_client: TestClient, evening_chain) -> None:
    sid = _open(open_client, evening_chain)
    # 22:41:20 — nearer to the 22:41 record than to 22:42; it reads 20 s before.
    near = open_client.get(
        f"/session/{sid}/nearest?wall_ns={_AUG_6_22_41 + 20_000_000_000}"
    ).json()

    assert near["seq"] == 3
    assert near["delta_ns"] == -20_000_000_000


def test_a_tie_resolves_to_the_lower_seq_and_says_there_was_one(
    open_client: TestClient, evening_chain
) -> None:
    """Exactly between 22:41 and 22:42: two records equally near. The lower
    seq wins deterministically, and the count makes that visible."""
    sid = _open(open_client, evening_chain)
    near = open_client.get(
        f"/session/{sid}/nearest?wall_ns={_AUG_6_22_41 + 30_000_000_000}"
    ).json()

    assert near["seq"] == 3
    assert near["equally_near"] == 1


def test_nearest_says_when_the_writers_clock_ran_backwards(
    open_client: TestClient, tmp_path, monkeypatch
) -> None:
    """The clock jumps back an hour mid-chain. "Nearest" is still answered —
    but the answer carries wall_follows_seq false, so no UI can present it
    as a position in proved order."""
    from palimpsests.audit.pala_writer import PalaWriter

    clock = _controlled_clock(monkeypatch, _AUG_6_22_41, _MINUTE)
    path = tmp_path / "backwards.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.model_load(b"\x11" * 32, b"\x22" * 32)
    clock["now"] -= 60 * _MINUTE
    w.incident_candidate(category=1, severity=2, detail="after the step")
    w.close()

    sid = _open(open_client, path)
    near = open_client.get(f"/session/{sid}/nearest?wall_ns={_AUG_6_22_41}").json()

    assert near["wall_follows_seq"] is False


def test_nearest_requires_an_instant(open_client: TestClient, chain_path) -> None:
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/nearest").status_code == 422


def test_a_wall_range_keeps_records_whose_clock_reads_inside_it(
    open_client: TestClient, evening_chain
) -> None:
    """From inclusive, to exclusive: 22:40 up to (not including) 22:42."""
    sid = _open(open_client, evening_chain)
    page = open_client.get(
        f"/session/{sid}/records?wall_from_ns={_AUG_6_22_41 - _MINUTE}"
        f"&wall_to_ns={_AUG_6_22_41 + _MINUTE}"
    ).json()

    assert [r["seq"] for r in page["records"]] == [2, 3]


def test_a_record_hash_filter_finds_exactly_that_record(
    open_client: TestClient, chain_path
) -> None:
    """How the anchor button finds the record a verified head names."""
    sid = _open(open_client, chain_path)
    head = open_client.get(f"/session/{sid}/verify").json()["chain"]["head"]
    page = open_client.get(f"/session/{sid}/records?record_hash={head}").json()

    assert page["total"] == 1
    assert page["records"][0]["record_hash"] == head


def test_a_head_that_names_nothing_here_is_an_empty_answer(
    open_client: TestClient, chain_path
) -> None:
    """Never the last record, never the nearest one: a head this file does
    not contain is a finding, and the empty list is how it is reported."""
    sid = _open(open_client, chain_path)
    page = open_client.get(f"/session/{sid}/records?record_hash={'ab' * 32}").json()

    assert page["total"] == 0


def test_a_shredded_record_reports_its_shredder(
    open_client: TestClient, tmp_path
) -> None:
    from palimpsests.audit.pala_writer import PalaWriter

    path = tmp_path / "shredded.pala"
    w = PalaWriter(path)
    w.genesis()
    w.boot()
    w.kv_save(b"\x11" * 32)
    clear_seq = w.seq - 1
    w.key_shred(0, target_seqs=[clear_seq])
    shred_seq = w.seq - 1
    w.close()

    sid = _open(open_client, path)
    record = open_client.get(f"/session/{sid}/record/{clear_seq}").json()

    assert record["shredded_by"] == shred_seq


def test_an_unshredded_record_reports_null(
    open_client: TestClient, chain_path
) -> None:
    sid = _open(open_client, chain_path)
    record = open_client.get(f"/session/{sid}/record/0").json()

    assert record["shredded_by"] is None


def test_safety_total_counts_past_the_cap(safety_heavy_chain) -> None:
    """A total that stopped at the window's edge would print "2 of 4" as
    if 2 were the whole answer — the same distinction `/records` already
    draws between what matched and what a caller asked to see.

    Exercised on `ChainHandle` directly, at a small cap, rather than
    through the route: `/safety` deliberately exposes no caller-facing
    limit (see `session_safety`'s own docstring for why), so the only way
    to observe the capping behaviour honestly is where it actually lives.
    """
    from auditor_sidecar.pala_seam import open_chain

    handle = open_chain(safety_heavy_chain)
    try:
        page = handle.safety(limit=2)
    finally:
        handle.close()

    assert len(page["records"]) == 2
    assert page["total"] == 4
    assert page["has_more"] is True


def test_safety_has_more_is_false_once_the_window_covers_everything(
    open_client: TestClient, safety_heavy_chain
) -> None:
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety").json()

    assert len(page["records"]) == 4
    assert page["has_more"] is False


def test_a_chain_with_no_safety_records_reports_an_empty_list(
    open_client: TestClient, spanned_chain
) -> None:
    sid = _open(open_client, spanned_chain)
    page = open_client.get(f"/session/{sid}/safety").json()

    assert page["records"] == []
    assert page["total"] == 0
    assert page["has_more"] is False


def test_an_unrecognised_limit_is_ignored_not_silently_obeyed(
    open_client: TestClient, safety_heavy_chain
) -> None:
    """`/safety` declares no `limit` parameter, and FastAPI's default is to
    ignore query parameters a route never declared rather than refuse
    them. Worth asserting directly: a caller passing `?limit=1` in the
    style `/records` accepts must see all four records anyway, not a
    silently-obeyed page size nobody wired through."""
    sid = _open(open_client, safety_heavy_chain)
    page = open_client.get(f"/session/{sid}/safety?limit=1").json()

    assert len(page["records"]) == 4


def test_safety_and_records_agree_on_the_same_record(
    open_client: TestClient, chain_path
) -> None:
    """One builder — `_record_view` — so a SAFETY record cannot describe
    itself differently depending on which endpoint asked."""
    sid = _open(open_client, chain_path)
    from_safety = open_client.get(f"/session/{sid}/safety").json()["records"][0]
    from_records = next(
        r
        for r in open_client.get(f"/session/{sid}/records").json()["records"]
        if r["seq"] == from_safety["seq"]
    )
    assert from_safety == from_records


# --- the same refusals the rest of the surface makes ------------------------


BROWSE_VIEWS = [
    "boots", "spans", "records", "record/0", "origin?seq=0", "safety", "nearest?wall_ns=0",
]


@pytest.mark.parametrize("view", BROWSE_VIEWS)
def test_browsing_an_unknown_session_is_404(open_client: TestClient, view: str) -> None:
    assert open_client.get(f"/session/never-existed/{view}").status_code == 404


@pytest.mark.parametrize("view", BROWSE_VIEWS)
def test_browsing_refuses_when_the_file_changed(
    open_client: TestClient, chain_path, view: str
) -> None:
    """409, exactly as verification does.

    A record list read from a file that has since changed describes bytes
    nobody is holding any more, and looks identical to one that does not.
    """
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/{view}").status_code == 200

    open_client.app.state.sessions.detach(sid)
    chain_path.write_bytes(chain_path.read_bytes() + b"\x00")

    assert open_client.get(f"/session/{sid}/{view}").status_code == 409


@pytest.mark.parametrize("view", BROWSE_VIEWS)
def test_browsing_requires_the_token(
    gated_client: TestClient, auth, chain_path, view: str
) -> None:
    sid = gated_client.post(
        "/session", json={"path": str(chain_path)}, headers=auth
    ).json()["session_id"]
    assert gated_client.get(f"/session/{sid}/{view}").status_code == 401
    assert gated_client.get(f"/session/{sid}/{view}", headers=auth).status_code == 200


# --- browsing is independent of verifying -----------------------------------


def test_a_failing_chain_is_still_browsable(open_client: TestClient, chain_path) -> None:
    """Inspecting evidence that did not pass is half the job.

    A tool that refused to show the records of a broken chain would be
    useless in the one situation it exists for.
    """
    chain_path.write_bytes(chain_path.read_bytes()[:-40])
    sid = _open(open_client, chain_path)

    verdict = open_client.get(f"/session/{sid}/verify").json()
    assert verdict["diagnosis"]["pattern"] == "truncated_tail"

    assert open_client.get(f"/session/{sid}/boots").status_code == 200
    assert len(open_client.get(f"/session/{sid}/records").json()["records"]) > 0


def test_browsing_says_nothing_about_a_verdict(
    open_client: TestClient, chain_path
) -> None:
    """No browse view carries a verdict field, by the same rule /verify
    follows: three questions, three answers, and none of them here."""
    sid = _open(open_client, chain_path)
    for view in BROWSE_VIEWS:
        body = str(open_client.get(f"/session/{sid}/{view}").json())
        for forbidden in ("chain_ok", "complete_to_anchor", "verdict", "diagnosis"):
            assert forbidden not in body


# --- caching ----------------------------------------------------------------


def test_boots_and_spans_are_computed_once(store, chain_path) -> None:
    """Each walks every record, and neither answer can change while the
    session is open — the file is the same bytes or the session is refused."""
    s = store.open(chain_path)
    assert s.boots() is s.boots()
    assert s.spans() is s.spans()


def test_safety_is_computed_once(store, chain_path) -> None:
    """Same reason as boots and spans: the question does not vary by
    caller, unlike a record window keyed by offset and limit."""
    s = store.open(chain_path)
    assert s.safety() is s.safety()


def test_record_windows_are_not_cached(store, chain_path) -> None:
    """Deliberately. Every window is a different question, and a cache keyed
    by (offset, limit) would grow with the pages a user happened to scroll
    through — holding a decoded copy of a chain far larger than the window."""
    s = store.open(chain_path)
    assert s.records(limit=2) is not s.records(limit=2)
    assert s.records(limit=2) == s.records(limit=2)
