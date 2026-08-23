# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Each mutation, and the pattern it must produce.

This is the phase's exit criterion, and it is the only place the diagnosis
guidance becomes falsifiable. `docs/API.md` and the diagnosis card both talk
about what a `truncated_tail` means and where to look when one appears —
none of which is worth anything if the shell has never seen a real one.

Every fixture here is made by damaging a container the package's own writer
produced. Hand-written broken bytes would test our idea of breakage rather
than the verifier's, and the mutations below are the ones the specification
describes: cut the tail, remove the prefix, drop a record, flip a byte,
anchor to a stranger, anchor to an earlier head.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.pala_seam import open_chain
from pathlib import Path

# The seven patterns FUNCTIONALITY.md §8 names. The frontend carries guidance
# for exactly these; this file proves the sidecar can produce them, so the two
# halves cannot drift apart without one of them failing.
SPEC_PATTERNS = frozenset(
    {
        "truncated_tail",
        "prefix_absent",
        "seq_gap",
        "chain_break",
        "record_violation",
        "unanchored_tail",
        "replaced_or_rolled_back",
    }
)


def _verify(path: Path, head: str | None = None) -> dict:
    handle = open_chain(path)
    try:
        specs = [{"kind": "manual", "head": head}] if head is not None else None
        return handle.verify(specs)
    finally:
        handle.close()


def _pattern(result: dict) -> str | None:
    diagnosis = result["diagnosis"]
    return None if diagnosis is None else diagnosis["pattern"]


def _split_points(data: bytes) -> tuple[int, int]:
    """Offsets of the second and third records, found by the container magic.

    The tests are exempt from the no-wire-parsing scan for exactly this: a
    fixture has to be able to damage a specific record, and there is no
    package API for "give me byte offsets so I can corrupt them".
    """
    second = data.index(b"PALA", 4)
    third = data.index(b"PALA", second + 4)
    return second, third


# --- the intact case, so a passing mutation test means something -----------


def test_an_untouched_chain_has_no_diagnosis(chain_path, head_hex) -> None:
    """The control. Without it, a suite where every fixture reported a
    diagnosis would look identical to one where the verifier reported a
    diagnosis for everything."""
    result = _verify(chain_path, head_hex)
    assert _pattern(result) is None
    assert result["chain"]["chain_ok"] is True
    assert result["completeness"]["complete_to_anchor"] is True


# --- the mutations ----------------------------------------------------------


def test_a_cut_tail_is_truncated_tail(chain_path, head_hex) -> None:
    """And chain_ok stays TRUE, which is the whole reason the triptych keys
    question one on chain_ok *and* the absence of a diagnosis.

    This was an argument in a comment until this fixture existed."""
    chain_path.write_bytes(chain_path.read_bytes()[:-40])
    result = _verify(chain_path, head_hex)
    assert _pattern(result) == "truncated_tail"
    assert result["chain"]["chain_ok"] is True


def test_a_missing_prefix_is_prefix_absent(chain_path, head_hex) -> None:
    data = chain_path.read_bytes()
    second, _ = _split_points(data)
    chain_path.write_bytes(data[second:])
    assert _pattern(_verify(chain_path, head_hex)) == "prefix_absent"


def test_a_dropped_record_is_a_seq_gap(chain_path, head_hex) -> None:
    data = chain_path.read_bytes()
    second, third = _split_points(data)
    chain_path.write_bytes(data[:second] + data[third:])
    result = _verify(chain_path, head_hex)
    assert _pattern(result) == "seq_gap"
    assert result["chain"]["chain_ok"] is False


def test_a_flipped_byte_is_a_chain_break(chain_path, head_hex) -> None:
    data = chain_path.read_bytes()
    second, _ = _split_points(data)
    at = second + 80
    chain_path.write_bytes(data[:at] + bytes([data[at] ^ 0xFF]) + data[at + 1 :])
    result = _verify(chain_path, head_hex)
    assert _pattern(result) == "chain_break"
    assert result["chain"]["chain_ok"] is False


def test_a_stranger_anchor_is_replaced_or_rolled_back(chain_path) -> None:
    result = _verify(chain_path, "aa" * 32)
    assert _pattern(result) == "replaced_or_rolled_back"
    assert result["completeness"]["complete_to_anchor"] is False


def test_an_earlier_head_is_an_unanchored_tail(lagging_chain) -> None:
    path, early_head, lag = lagging_chain
    result = _verify(path, early_head)
    assert _pattern(result) == "unanchored_tail"
    assert result["completeness"]["complete_to_anchor"] is False
    assert result["completeness"]["anchor_lag"] == lag


# --- the distinction the product exists to make -----------------------------


def test_a_lagging_anchor_and_a_stranger_anchor_are_told_apart(
    chain_path, lagging_chain
) -> None:
    """§8 calls this the highest-value distinction in the product, and this
    is what makes the claim checkable.

    Both produce chain_ok TRUE and complete_to_anchor FALSE. On those two
    fields alone they are the same answer. A crash between writing and
    anchoring and a replaced log are entirely different incidents, and only
    the pattern says which investigation to open.
    """
    lagging_path, early_head, _ = lagging_chain
    lagging = _verify(lagging_path, early_head)
    stranger = _verify(chain_path, "aa" * 32)

    assert lagging["chain"]["chain_ok"] == stranger["chain"]["chain_ok"] is True
    assert (
        lagging["completeness"]["complete_to_anchor"]
        == stranger["completeness"]["complete_to_anchor"]
        is False
    )
    assert _pattern(lagging) != _pattern(stranger)


# --- what this suite cannot build, said out loud ----------------------------


@pytest.mark.skip(
    reason=(
        "record_violation needs a record that breaks a normative MUST, and "
        "PalaWriter cannot emit one by construction. Producing it would mean "
        "hand-writing header bytes — testing our idea of a violation rather "
        "than the verifier's. It stays uncovered here, visibly, until the "
        "package ships a fixture for it."
    )
)
def test_a_record_violation_is_reported() -> None:
    raise NotImplementedError


def test_the_suite_covers_every_pattern_it_can_produce(
    chain_path, head_hex, lagging_chain
) -> None:
    """Six of the seven, and the seventh is skipped above with its reason.

    The count is asserted so that a pattern quietly disappearing from the
    verifier — or from this suite — fails rather than passing with fewer
    cases.
    """
    produced = set()

    lagging_path, early_head, _ = lagging_chain
    produced.add(_pattern(_verify(lagging_path, early_head)))
    produced.add(_pattern(_verify(chain_path, "aa" * 32)))

    data = chain_path.read_bytes()
    second, third = _split_points(data)

    chain_path.write_bytes(data[:-40])
    produced.add(_pattern(_verify(chain_path, head_hex)))

    chain_path.write_bytes(data[second:])
    produced.add(_pattern(_verify(chain_path, head_hex)))

    chain_path.write_bytes(data[:second] + data[third:])
    produced.add(_pattern(_verify(chain_path, head_hex)))

    at = second + 80
    chain_path.write_bytes(data[:at] + bytes([data[at] ^ 0xFF]) + data[at + 1 :])
    produced.add(_pattern(_verify(chain_path, head_hex)))

    assert produced <= SPEC_PATTERNS, produced - SPEC_PATTERNS
    assert len(produced) == 6
    assert SPEC_PATTERNS - produced == {"record_violation"}
