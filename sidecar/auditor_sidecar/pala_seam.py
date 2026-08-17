# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The one place this repository touches ``palimpsests``.

ADR-0001: every PALA-1 fact this application renders comes from a verifier
call in the package. Nothing else in this repository — Python, Rust or
TypeScript — imports ``palimpsests``, parses container bytes, or re-derives
a value the package already produces. ``scripts/check_no_wire_parsing.sh``
fails the build on any violation, and this module is its only exemption.

Keeping the surface here also makes the planned extraction of the audit
subsystem into the ``palimpsests-audit`` distribution a one-file change:
the imports move, the rest of the codebase does not notice.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _dist_version
from palimpsests.audit.pala.codec import FORMAT_VERSION

__all__ = ["package_version", "wire_format_version", "verifier_identity"]

#: The specification this application reads. Not a marketing string: it is
#: the family name plus the wire version the *linked* verifier implements,
#: so a report always says which format was actually checked.
_SPEC_FAMILY = "PALA-1"


def package_version() -> str:
    """The version of the verifier package this application is linked against.

    Read from the **distribution metadata**, not from ``palimpsests.__version__``.

    The two can disagree: as of the 0.8.0 release the distribution reports
    ``0.8.0`` while the module attribute still reads ``0.7.0`` (the module
    constant was not bumped with the release). Distribution metadata is what
    ``pip`` resolved and therefore what actually determines the code on disk,
    so it is the honest answer to "which verifier produced this?" — and a
    verification report that names the wrong verifier version is a provenance
    defect in a tool that exists to establish provenance.

    Tracked upstream as Track U0 (``DEVELOPMENT-PLAN.md``); when the upstream
    constant is corrected and guarded by a test, the two agree and this
    docstring becomes a historical note rather than a workaround.
    """
    try:
        return _dist_version("palimpsests")
    except PackageNotFoundError:  # pragma: no cover - only when not installed
        return "unknown"


def wire_format_version() -> str:
    """The PALA-1 wire version the linked verifier implements."""
    return f"{_SPEC_FAMILY} format_version {FORMAT_VERSION}"


def verifier_identity() -> dict[str, str]:
    """The identity triple every artifact this application produces carries."""
    return {
        "package": f"palimpsests {package_version()}",
        "spec": wire_format_version(),
    }
