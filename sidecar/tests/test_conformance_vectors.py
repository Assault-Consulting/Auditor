# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Conformance against the published PALA-1 vectors.

This is the half of B-10 that would prove something about *correctness*
rather than about transit. `test_agreement_with_cli.py` compares the sidecar
to the package's own CLI, which shares its code — so the two can only agree
or disagree, never both be checked. The published vectors are an independent
authority: they are what a third-party verifier written from the prose alone
is measured against.

U9 has landed: the palimpsests distribution now ships the published vectors
(`palimpsests.audit.pala.vectors`), so the envelope half of this check runs
from an installed package for the first time. The `>=0.10` dependency floor
guarantees the vectors are present, so the old `@requires_vectors` skip is
gone; the expected values are pinned below as constants — the frozen §8
Expected-results block — rather than read back from the vectors' own `verify`
block, so this checks Auditor's read path against the specification, not the
fixture against itself.

The profile-semantics half is a different gap, and it is no longer the
dependency. It resolves the decoded r2/r3 body expectations — kind names,
incident candidates, oversight acks, tool calls — which is what a user of this
shell actually sees. The sidecar does not decode record bodies yet:
`open_chain(...).verify()` answers the three envelope questions, and there is
no read path that renders body semantics. That test therefore stays pending —
now on an Auditor-side rendering path, tracked as a feature, not on U9.
"""

from __future__ import annotations

import pytest
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.pala import vectors
from pathlib import Path


def _container_from(vec: dict) -> bytes:
    """Assemble the §2.4 container from a vector set: each record is its header
    bytes followed by its body bytes where present, concatenated in order."""
    return b"".join(
        bytes.fromhex(r["header_hex"]) + bytes.fromhex(r.get("body_hex", ""))
        for r in vec["records"]
    )


# Published expectations as constants — the frozen §8 Expected-results block
# (PALA-1.md §8), pinned here rather than read from the vectors' own `verify`
# block. The point of an independent authority is lost if the test reads its
# expectation from the same file it is checking.
CORE_CHAIN_OK = True
CORE_RECORD_COUNT = 12
CORE_CHAIN_HEAD = "3a1a3673f50498eb1d1c6f94b983d6c606cd85ed53627b4e4ffe55153c7af813"


def test_the_core_vectors_verify_as_published(tmp_path: Path) -> None:
    """Envelope conformance: the frozen `verify` block must be reproduced.

    The core set covers one record of each type — genesis through key_shred —
    and states the expected chain_ok, count, breaks, gaps and violations.
    Reproducing it *through Auditor's own read path* (`open_chain(...).verify()`,
    the one seam that touches the package) is what "this build reads PALA-1
    correctly" means.
    """
    path = tmp_path / "core.pala"
    path.write_bytes(_container_from(vectors.load("core")))

    handle = open_chain(path)
    try:
        chain = handle.verify()["chain"]
    finally:
        handle.close()

    assert chain["chain_ok"] is CORE_CHAIN_OK
    assert chain["count"] == CORE_RECORD_COUNT
    assert chain["breaks"] == []
    assert chain["gaps"] == []
    assert chain["violations"] == []
    assert chain["head"] == CORE_CHAIN_HEAD


@pytest.mark.skip(
    reason=(
        "pending an Auditor profile-semantics read path. The published vectors "
        "are shipped now (U9; the dependency floor is >=0.10), so this no longer "
        "waits on the package. It waits on the sidecar: open_chain(...).verify() "
        "answers the envelope questions only, and nothing yet decodes r2/r3 "
        "record bodies into kind names, incident candidates or oversight acks. "
        "That rendering path is the gap, tracked as an Auditor feature."
    )
)
def test_the_inference_profile_semantics_are_resolved_as_published() -> None:
    """Profile conformance: the decoded r2/r3 body semantics a profile-aware
    reader must resolve to — kind names, incident candidates, oversight acks,
    tool calls. Blocked on a body-semantics read path the sidecar does not yet
    expose; see the module docstring.
    """
