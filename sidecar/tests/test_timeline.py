# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Density along an axis, and the things that break the ruler.

The subject of this file is L3: proved order and recorded wall time are two
different kinds of claim, and an endpoint that served them interchangeably
would let a UI draw the second while labelling it the first.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def _open(client: TestClient, path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


# --- two axes, two kinds of claim -------------------------------------------


def test_the_default_axis_is_proved_order(open_client: TestClient, chain_path) -> None:
    """Wall time is opt-in because it is a claim (L3). The axis a caller
    gets without asking must be the one the chain establishes."""
    sid = _open(open_client, chain_path)
    timeline = open_client.get(f"/session/{sid}/timeline").json()

    assert timeline["axis"] == "seq"
    assert timeline["basis"] == "proved"


def test_the_wall_axis_says_it_is_recorded(open_client: TestClient, chain_path) -> None:
    """`basis` is its own field rather than something derived from `axis`,
    so a consumer cannot label a wall chart 'proved' by reading the wrong
    one."""
    sid = _open(open_client, chain_path)
    timeline = open_client.get(f"/session/{sid}/timeline?axis=wall").json()

    assert timeline["axis"] == "wall"
    assert timeline["basis"] == "recorded"


def test_the_wall_axis_carries_its_watermark(
    open_client: TestClient, chain_path
) -> None:
    """A wall-time view has to say whose clock it is and how much the writer
    claimed for it, which is what time_trust is."""
    sid = _open(open_client, chain_path)
    timeline = open_client.get(f"/session/{sid}/timeline?axis=wall").json()

    assert timeline["time_trust_values"] == [{"value": 1, "name": "UNSYNCED"}]


def test_an_unknown_axis_is_refused_rather_than_substituted(
    open_client: TestClient, chain_path
) -> None:
    """422, not a quiet fall back to seq.

    Answering on a different axis than the one asked for — and labelling it
    as the caller's choice — is exactly how a recorded claim gets read as a
    proved one.
    """
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/timeline?axis=monotonic")

    assert r.status_code == 422
    assert "monotonic" in r.json()["detail"]


# --- the two axes genuinely differ ------------------------------------------


def test_the_two_axes_are_different_kinds_of_quantity(
    open_client: TestClient, two_boot_chain
) -> None:
    """The reason both axes exist, asserted as arithmetic rather than as a
    hope about timing.

    Ask an eight-record chain for fifty buckets and the axes answer
    differently by construction. **seq is a discrete ordinal**: it cannot be
    subdivided below one record, so fifty buckets collapse to eight, each
    holding exactly one. **wall is a continuous measure**: records occupy
    points in an interval, so fifty buckets stay fifty and most of them hold
    nothing.

    An earlier version of this test asserted that the wall counts "vary"
    while the seq counts do not — which was true of the fixture on the day
    it was written and not guaranteed by anything. That is the same mistake
    as asserting a positive uptime on a coarse clock: a property of the run
    dressed as a property of the code.
    """
    sid = _open(open_client, two_boot_chain)
    by_seq = open_client.get(f"/session/{sid}/timeline?buckets=50").json()["buckets"]
    by_wall = open_client.get(
        f"/session/{sid}/timeline?axis=wall&buckets=50"
    ).json()["buckets"]

    assert len(by_seq) == 8
    assert all(b["count"] == 1 for b in by_seq)

    assert len(by_wall) == 50
    # Eight records in fifty buckets: forty-two are empty by pigeonhole, no
    # matter how the writer's clock behaved.
    assert sum(1 for b in by_wall if b["count"] == 0) == 42


def test_empty_buckets_are_reported_not_omitted(
    open_client: TestClient, two_boot_chain
) -> None:
    """An empty stretch is a fact about the chain. Skipping it would draw a
    dense chain out of a sparse one — and the count would no longer match the
    resolution the caller asked for."""
    sid = _open(open_client, two_boot_chain)
    buckets = open_client.get(
        f"/session/{sid}/timeline?axis=wall&buckets=20"
    ).json()["buckets"]

    assert len(buckets) == 20
    assert any(b["count"] == 0 for b in buckets)


def test_buckets_tile_the_range_without_gaps_or_overlap(
    open_client: TestClient, two_boot_chain
) -> None:
    """Each bucket starts where the last one ended. A series with holes in
    the axis itself cannot be read as density."""
    sid = _open(open_client, two_boot_chain)
    timeline = open_client.get(f"/session/{sid}/timeline?buckets=4").json()
    buckets = timeline["buckets"]

    assert buckets[0]["start"] == timeline["start"]
    for earlier, later in zip(buckets, buckets[1:], strict=False):
        assert later["start"] == earlier["end"] + 1
    assert buckets[-1]["end"] >= timeline["end"]


def test_every_record_lands_in_exactly_one_bucket(
    open_client: TestClient, two_boot_chain
) -> None:
    sid = _open(open_client, two_boot_chain)
    total = open_client.get(f"/session/{sid}/records").json()["total"]

    for axis in ("seq", "wall"):
        timeline = open_client.get(f"/session/{sid}/timeline?axis={axis}").json()
        assert sum(b["count"] for b in timeline["buckets"]) == total


# --- boot boundaries are breaks, not seams ----------------------------------


def test_boot_boundaries_are_reported_apart_from_the_series(
    open_client: TestClient, two_boot_chain
) -> None:
    """§C-03 renders them as axis breaks. Folding them into the buckets
    would make a restart look like a quiet minute."""
    sid = _open(open_client, two_boot_chain)
    timeline = open_client.get(f"/session/{sid}/timeline").json()

    assert len(timeline["boot_boundaries"]) == 2
    first, second = timeline["boot_boundaries"]
    assert first["last_seq"] + 1 == second["first_seq"]
    assert first["boot_id"] != second["boot_id"]


def test_the_wall_gap_carries_both_ends(
    open_client: TestClient, two_boot_chain
) -> None:
    """Both ends, so a consumer can hatch the interval and remove the ruler
    inside it. "The clock is unverifiable while down" is a statement about
    the gap, not about the records on either side of it."""
    sid = _open(open_client, two_boot_chain)
    gaps = open_client.get(f"/session/{sid}/timeline").json()["wall_gaps"]

    assert len(gaps) == 1
    gap = gaps[0]
    assert gap["to_wall_ns"] - gap["from_wall_ns"] == gap["duration_ns"]
    assert gap["after_boot_id"] != gap["before_boot_id"]


def test_a_single_boot_chain_has_no_gaps(open_client: TestClient, chain_path) -> None:
    """No boundary, nothing between boots to report — an empty list rather
    than a gap of zero, which would draw a break that is not there."""
    sid = _open(open_client, chain_path)
    timeline = open_client.get(f"/session/{sid}/timeline").json()

    assert len(timeline["boot_boundaries"]) == 1
    assert timeline["wall_gaps"] == []


# --- the clock's own honesty ------------------------------------------------


def test_whether_the_writers_clock_agrees_with_proved_order(
    open_client: TestClient, chain_path
) -> None:
    """False would mean the wall axis reorders records relative to the chain
    — a UI showing that axis has to say so, and cannot unless it is told."""
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/timeline").json()["wall_follows_seq"] is True


def test_steps_come_from_the_package(open_client: TestClient, chain_path) -> None:
    """Empty on a well-behaved fixture, and that is the point: the field is
    present so a consumer handles the populated case, rather than learning
    about clock steps the first time one appears."""
    sid = _open(open_client, chain_path)
    timeline = open_client.get(f"/session/{sid}/timeline").json()

    assert timeline["steps"] == []
    assert all(b["stepped"] is False for b in timeline["buckets"])


# --- the same refusals, and the resolution bound ----------------------------


@pytest.mark.parametrize("query", ["buckets=0", "buckets=9000", "buckets=-1"])
def test_the_resolution_is_bounded(
    open_client: TestClient, chain_path, query: str
) -> None:
    sid = _open(open_client, chain_path)
    assert open_client.get(f"/session/{sid}/timeline?{query}").status_code == 422


def test_more_buckets_than_records_is_not_an_error(
    open_client: TestClient, chain_path
) -> None:
    """A five-record chain asked for two hundred buckets gets as many as the
    range can carry, rather than a division by zero or two hundred slivers."""
    sid = _open(open_client, chain_path)
    timeline = open_client.get(f"/session/{sid}/timeline?buckets=200").json()

    assert 0 < len(timeline["buckets"]) <= 200
    assert sum(b["count"] for b in timeline["buckets"]) == 5


def test_a_timeline_says_nothing_about_a_verdict(
    open_client: TestClient, chain_path
) -> None:
    """Browsing, like the other views. Density is not evidence of soundness
    in either direction."""
    sid = _open(open_client, chain_path)
    body = str(open_client.get(f"/session/{sid}/timeline").json())

    for forbidden in ("chain_ok", "complete_to_anchor", "verdict", "diagnosis"):
        assert forbidden not in body


def test_a_timeline_is_computed_once_per_question(store, chain_path) -> None:
    """Two axes and a bounded set of resolutions: this converges, unlike a
    record window where the offset makes every question new."""
    s = store.open(chain_path)
    assert s.timeline() is s.timeline()
    assert s.timeline(axis="wall") is not s.timeline()
