# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Conformance against the published PALA-1 vectors.

This is the half of B-10 that would prove something about *correctness*
rather than about transit. `test_agreement_with_cli.py` compares the sidecar
to the package's own CLI, which shares its code — so the two can only agree
or disagree, never both be checked. The published vectors are an independent
authority: they are what a third-party verifier written from the prose alone
is measured against.

It cannot run yet, and the skip is the point.

The vectors live in the Palimpsests repository at
`docs/specs/pala-1/test-vectors.json` and `.../profiles/inference-vectors.json`
and are **not shipped in the distribution** — `importlib.metadata.files()`
does not list them. So they are reachable only by someone who cloned the
repository, which is close to the opposite of what publishing a vector set is
for.

Tracked upstream as U9: package both files and expose them through one
accessor, so any consumer — this shell, a third-party tool, a CI run — can
self-check. Vendoring a copy here was considered and rejected: a second copy
is a second source of truth, and it would drift exactly like the offset table
U4 exists to prevent.

The skip is deliberate rather than a TODO. A pending conformance check should
be visible in every run, not filed somewhere nobody reads.
"""

from __future__ import annotations

import pytest


def _vectors_available() -> bool:
    """Whether the package ships the published vectors (U9)."""
    try:
        from palimpsests.audit.pala import vectors  # noqa: F401
    except ImportError:
        return False
    return True


requires_vectors = pytest.mark.skipif(
    not _vectors_available(),
    reason=(
        "U9 not released: the published PALA-1 vectors are not shipped in the "
        "palimpsests distribution, so conformance cannot be checked from an "
        "installed package. Remove this skip with the dependency bump."
    ),
)


@requires_vectors
def test_the_core_vectors_verify_as_published() -> None:
    """Envelope conformance: the frozen `verify` block must be reproduced.

    The core set covers one record of each type — genesis through key_shred —
    and states the expected chain_ok, count, breaks, gaps, violations and
    complete_to_anchor. Reproducing it is what "this build reads PALA-1
    correctly" means.
    """
    raise NotImplementedError("write against palimpsests.audit.pala.vectors when U9 lands")


@requires_vectors
def test_the_inference_profile_semantics_are_resolved_as_published() -> None:
    """Profile conformance: the part that matters most to this shell.

    The companion vectors carry a `semantics` block — the decoded r2/r3 body
    expectations a profile-aware reader must resolve to. That is precisely
    what Auditor renders: kind names, incident candidates, oversight
    acknowledgements. The core set would check the envelope and none of what
    a user actually sees.
    """
    raise NotImplementedError("write against palimpsests.audit.pala.vectors when U9 lands")
