# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Browsing a container: boots, spans and records.

Browsing answers no question about soundness, and that separation is the
point. A chain that fails verification is still browsed — inspecting
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
    record needs its own decisions about keys and redaction."""
    sid = _open(open_client, chain_path)
    records = open_client.get(f"/session/{sid}/records").json()["records"]

    safety = next(r for r in records if r["seq"] == 3)
    assert safety["body_tlv_types"] == [1, 4, 5, 6]
    # Length, not content — and asserted as "there is a body" rather than
    # against a constant, which would only be pinning the fixture's detail
    # string.
    assert safety["body_len"] > 0
    # No field anywhere carries the bytes.
    assert "body" not in safety
    assert "detail" not in safety


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


# --- the same refusals the rest of the surface makes ------------------------


@pytest.mark.parametrize("view", ["boots", "spans", "records"])
def test_browsing_an_unknown_session_is_404(open_client: TestClient, view: str) -> None:
    assert open_client.get(f"/session/never-existed/{view}").status_code == 404


@pytest.mark.parametrize("view", ["boots", "spans", "records"])
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


@pytest.mark.parametrize("view", ["boots", "spans", "records"])
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
    for view in ("boots", "spans", "records"):
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


def test_record_windows_are_not_cached(store, chain_path) -> None:
    """Deliberately. Every window is a different question, and a cache keyed
    by (offset, limit) would grow with the pages a user happened to scroll
    through — holding a decoded copy of a chain far larger than the window."""
    s = store.open(chain_path)
    assert s.records(limit=2) is not s.records(limit=2)
    assert s.records(limit=2) == s.records(limit=2)
