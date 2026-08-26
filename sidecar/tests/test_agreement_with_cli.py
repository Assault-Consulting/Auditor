# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The sidecar's answer, compared against the package's own CLI.

**What this proves, and what it does not.**

`palimpsests pala verify` calls the same library the sidecar calls. So
agreement here proves that *this repository does not distort the answer in
transit* — that the seam, the models and the JSON encoding carry the
verifier's result across unchanged. That is invariant L1 made testable, and
it is worth having: distortion is the failure this codebase is most likely to
produce, because every field is copied by hand at the seam.

It does **not** prove the verifier is correct. Both sides would be wrong
together. Conformance against an independent authority is
`test_conformance_vectors.py`, which runs the published vectors from the
installed package.

Nor did agreement here originally mean the two ran the same checks. The CLI
performs a second walk comparing bodies to their digests; `AuditReader.verify()`
does not. Every case below except the body one damages a header or the chain,
so the difference never showed — which is how a real overclaim reached the
screen and stayed there for nine pull requests. The sidecar now runs that
second walk too, through the package's report builder, and the case is here.

The comparison is deliberately made at the level of *meaning* rather than
field names. The two surfaces are shaped differently on purpose: the CLI
answers a shell script with an exit code, and the sidecar answers a UI with a
structure. Asserting they use the same keys would test nothing and would
break the first time either side improved its wording.
"""

from __future__ import annotations

import json
import pytest
import subprocess
import sys
from fastapi.testclient import TestClient

# The exit-code contract, from `palimpsests pala verify --help`. Written out
# because FUNCTIONALITY.md §20.1 got it wrong — it listed 0/2/3 and omitted
# TAMPERED, which is the one code the product exists to surface.
EXIT_VERIFIED = 0
EXIT_TAMPERED = 1
EXIT_PARTIAL = 2
EXIT_UNREADABLE = 3


def _cli(path, anchor: str | None = None) -> tuple[int, dict]:
    """Run the package's CLI over a file and return (exit code, JSON)."""
    cmd = [sys.executable, "-m", "palimpsests.cli", "pala", "verify", str(path), "--json"]
    if anchor is not None:
        cmd += ["--anchor", anchor]
    done = subprocess.run(cmd, capture_output=True, text=True)
    return done.returncode, json.loads(done.stdout)


def _sidecar(client: TestClient, path, profile: str = "none") -> dict:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    r = client.get(f"/session/{sid}/verify?profile={profile}")
    assert r.status_code == 200
    return r.json()


def _profile(client: TestClient, name: str, sources: list[dict]) -> None:
    r = client.put(f"/anchors/profiles/{name}", json={"name": name, "sources": sources})
    assert r.status_code == 200


# --- the three answers, each against its CLI counterpart --------------------


def test_a_sound_chain_agrees(open_client: TestClient, chain_path, head_hex) -> None:
    code, cli = _cli(chain_path, head_hex)
    _profile(open_client, "anchored", [{"kind": "manual", "head": head_hex}])
    ours = _sidecar(open_client, chain_path, "anchored")

    assert code == EXIT_VERIFIED
    assert ours["chain"]["chain_ok"] is cli["consistency"]["ok"] is True
    assert ours["chain"]["count"] == cli["records"]
    assert ours["chain"]["head"] == cli["head"]
    assert ours["completeness"]["complete_to_anchor"] is True
    assert cli["completeness"]["ok"] is True


def test_no_anchor_is_partial_on_both_sides(
    open_client: TestClient, chain_path
) -> None:
    """The CLI's PARTIAL and our null are the same statement.

    Exit 2 exists precisely because "chain intact, nothing checked its head"
    is not a pass. Our tri-state says it with `null`. If either side ever
    reported this as success, this test is where it shows.
    """
    code, cli = _cli(chain_path)
    ours = _sidecar(open_client, chain_path)

    assert code == EXIT_PARTIAL
    assert cli["completeness"]["checked"] is False
    assert ours["completeness"]["complete_to_anchor"] is None


def test_an_anchor_from_another_chain_agrees(
    open_client: TestClient, chain_path
) -> None:
    """The strongest claim either side makes, and they must make it together."""
    stranger = "aa" * 32
    code, cli = _cli(chain_path, stranger)
    _profile(open_client, "stranger", [{"kind": "manual", "head": stranger}])
    ours = _sidecar(open_client, chain_path, "stranger")

    assert code == EXIT_TAMPERED
    assert cli["completeness"]["ok"] is False
    assert ours["completeness"]["complete_to_anchor"] is False
    assert ours["diagnosis"]["pattern"] == "replaced_or_rolled_back"


def test_a_truncated_chain_agrees(
    open_client: TestClient, truncated_chain, head_hex_before_truncation
) -> None:
    """Both refuse to call it sound — but they say so in different fields.

    This assertion was wrong when first written, and the correction is the
    interesting part.

    The CLI reports ``consistency.ok = False``, because it folds "the
    container is malformed" into consistency. The reader keeps them apart:
    ``chain_ok`` stays **True** — every record it could read does link to its
    predecessor — and the truncation is reported as a ``truncated_tail``
    diagnosis instead.

    The reader's model is the more precise one, and it matches question one
    as this product asks it: *is what I hold internally consistent?* For a
    cut file, what I hold is consistent; what is wrong is that it ends
    mid-record. But the consequence is a constraint on the UI, and it is
    recorded here because it will not be obvious to whoever builds the
    triptych: **``chain_ok`` alone must never be rendered as the answer to
    question one.** A screen that showed a green tick for this file would be
    truthful about the field and misleading about the file.
    """
    code, cli = _cli(truncated_chain, head_hex_before_truncation)
    _profile(
        open_client,
        "pre-truncation",
        [{"kind": "manual", "head": head_hex_before_truncation}],
    )
    ours = _sidecar(open_client, truncated_chain, "pre-truncation")

    # Same verdict in substance: neither side calls this sound.
    assert code == EXIT_TAMPERED
    assert ours["diagnosis"]["pattern"] == "truncated_tail"
    assert ours["completeness"]["complete_to_anchor"] is False

    # Same facts about what was readable.
    assert ours["chain"]["count"] == cli["records"]

    # And the divergence itself, pinned so a future change to either side
    # shows up here rather than in a screenshot.
    assert cli["consistency"]["ok"] is False
    assert cli["consistency"]["malformed_container"]
    assert ours["chain"]["chain_ok"] is True


# --- the counts and the head, which are the easiest things to lose ----------


@pytest.mark.parametrize("with_anchor", [True, False])
def test_the_record_count_and_head_survive_the_seam(
    open_client: TestClient, chain_path, head_hex, with_anchor: bool
) -> None:
    """Two values copied by hand at the seam, checked against their source.

    A count that drifts by one or a head that loses a byte would be invisible
    in the UI and fatal in a report, because a reader compares that head
    against an anchor they were handed separately.
    """
    _, cli = _cli(chain_path, head_hex if with_anchor else None)
    profile = "none"
    if with_anchor:
        _profile(open_client, "a", [{"kind": "manual", "head": head_hex}])
        profile = "a"
    ours = _sidecar(open_client, chain_path, profile)

    assert ours["chain"]["count"] == cli["records"]
    assert ours["chain"]["head"] == cli["head"]


# --- the gap the audit found, now closed ------------------------------------


def test_a_swapped_body_is_seen_by_both(
    open_client: TestClient, body_swapped_chain
) -> None:
    """Finding K5, closed — and this test is the record of the whole episode.

    It was written asserting a *divergence*: `AuditReader.verify()` walks
    headers, so a body swapped under an intact header chain left chain_ok
    true with no diagnosis while `pala verify` reported the mismatch and
    exited 1. The panel above it said "5 records, each linked" in green.

    That is still true of the reader path on 0.10 — checked, not assumed —
    which is why the sidecar now runs the package's report builder for the
    container facts. The header answer and the body answer are two different
    questions and both are reported.

    The lesson outlasts the fix. Every fixture in this suite and in the
    mutation suite damaged a header or the chain; none touched a body, so
    nothing here could have caught it. A suite is only as broad as the shapes
    someone thought to build.
    """
    code, cli = _cli(body_swapped_chain)
    assert code == EXIT_TAMPERED
    assert cli["consistency"]["ok"] is False

    ours = _sidecar(open_client, body_swapped_chain)

    # Same finding, same records named.
    assert ours["container"]["body_digest_mismatches"] == cli["consistency"][
        "body_digest_mismatches"
    ]

    # And the header chain really is intact on both sides — the reason this
    # was invisible for as long as it was.
    assert ours["chain"]["chain_ok"] is True


# --- a divergence that is deliberate, and therefore recorded ----------------


def test_a_file_that_was_never_a_chain_is_classified_differently(
    open_client: TestClient, tmp_path
) -> None:
    """The two disagree here, and this test exists so nobody discovers it by
    accident.

    Given a file that is not a container at all, the CLI answers TAMPERED —
    the strongest accusation it can make about a file that never had a
    history. Auditor refuses to open it instead, and says so.

    Auditor's behaviour is the one the invariants require. L6 separates
    absent, unreadable and failed; L4 forbids attributing intent. Calling an
    ordinary text file "tampered" does both wrongs at once. The CLI's own
    table has EXIT_UNREADABLE for exactly this case and does not use it,
    which is worth raising upstream rather than papering over here.

    If the CLI ever changes to UNREADABLE, this test fails and the assertion
    below is the place to record the agreement.
    """
    junk = tmp_path / "notes.txt"
    junk.write_bytes(b"this was never a container" * 20)

    code, cli = _cli(junk)
    assert code == EXIT_TAMPERED
    assert cli["consistency"]["malformed_container"]

    r = open_client.post("/session", json={"path": str(junk)})
    assert r.status_code == 422
    assert "no PALA-1 records" in r.json()["detail"]


# --- fixtures ---------------------------------------------------------------


@pytest.fixture
def head_hex_before_truncation(chain_path) -> str:
    """The head of the intact chain, taken before it is cut.

    Read from the CLI rather than from our own code: the anchor in this test
    stands in for one an operator was handed, and it should not come from the
    thing under test.
    """
    _, cli = _cli(chain_path)
    return cli["head"]


@pytest.fixture
def truncated_chain(chain_path, head_hex_before_truncation):
    data = chain_path.read_bytes()
    chain_path.write_bytes(data[:-40])
    return chain_path
