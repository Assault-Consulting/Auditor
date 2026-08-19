# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The one place this repository touches ``palimpsests``.

ADR-0001: every PALA-1 fact this application renders comes from a verifier
call in the package. Nothing else in this repository — Python, Rust or
TypeScript — imports ``palimpsests``, parses container bytes, or re-derives
a value the package already produces. ``scripts/check_no_wire_parsing.sh``
fails the build on any violation, and this module is its only exemption for
package access.

Nothing from ``palimpsests`` leaves this module. ``open_chain`` returns a
:class:`ChainHandle` defined here, and every accessor on it returns plain
data — dicts, strings, ints. That is what keeps the seam a seam: without it
a package dataclass would appear in a route signature, then in a response
model, and the single point of contact would quietly become a hundred.

Keeping the surface here also makes the planned extraction of the audit
subsystem into the ``palimpsests-audit`` distribution a one-file change:
the imports move, the rest of the codebase does not notice.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _dist_version
from palimpsests.audit.pala.codec import FORMAT_VERSION
from palimpsests.audit.reader import AuditReader
from pathlib import Path

__all__ = [
    "ChainHandle",
    "NotAChain",
    "open_chain",
    "package_version",
    "verifier_identity",
    "wire_format_version",
]

#: The specification this application reads. Not a marketing string: it is
#: the family name plus the wire version the *linked* verifier implements,
#: so a report always says which format was actually checked.
_SPEC_FAMILY = "PALA-1"


class NotAChain(Exception):
    """The file is not a readable PALA-1 container.

    Distinct from "the chain fails verification". A chain that fails is
    opened, browsed and diagnosed — inspecting broken evidence is half the
    job. This is the other case: there is nothing here to inspect.
    """


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


class ChainHandle:
    """An open container, and the only way to ask anything about one.

    Wraps ``AuditReader`` rather than exposing it, so no package type crosses
    this module's boundary.
    """

    def __init__(self, reader: AuditReader) -> None:
        self._reader = reader

    def close(self) -> None:
        self._reader.close()

    def subject(self) -> dict[str, object]:
        """What the container is, before any verdict about it.

        Every value here comes from the reader. Counts are taken from the
        decoded records rather than from the file, because the file's byte
        length is not evidence of how many records it holds — a truncated
        tail has bytes and no record.
        """
        records = list(self._reader.records())
        seqs = [r.seq for r in records]
        return {
            "records": len(records),
            "first_seq": min(seqs) if seqs else None,
            "last_seq": max(seqs) if seqs else None,
            "boots": len(self._reader.boots()),
            "spans": len(self._reader.spans()),
        }


def open_chain(path: Path) -> ChainHandle:
    """Open a container for reading.

    Raises :class:`NotAChain` when the file cannot be read as one at all —
    which includes the empty file, because an empty container is not a chain
    with zero records; it is a file that says nothing, and reporting "0
    records, verified" about it would be a verdict on nothing.
    """
    try:
        reader = AuditReader.open(path)
    except (OSError, ValueError) as exc:
        raise NotAChain(str(exc)) from exc

    if not any(True for _ in reader.records()):
        reader.close()
        raise NotAChain("the file holds no PALA-1 records")

    return ChainHandle(reader)
