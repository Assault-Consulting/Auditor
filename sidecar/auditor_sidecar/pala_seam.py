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

    def verify(self) -> dict[str, object]:
        """Ask the verifier the three questions, and pass the answer through.

        Every value below is copied out of the package's result. Nothing is
        computed, combined or interpreted here: a shell that decides what a
        verdict means is a shell that can decide wrongly, and L1 exists so
        that it cannot.

        Two shapes deserve their names.

        ``complete_to_anchor`` is a **tri-state**, and stays one. ``None``
        means no anchor was supplied, so the question was never asked; the UI
        renders that as "not checked", never as a pass (L7). Collapsing it to
        a boolean here would destroy the distinction before anything could
        render it.

        ``advisory`` is carried in its own key, never merged into the chain
        result. Advisory items describe things worth a human's attention and
        change no verdict (L5); a caller that receives them in the same
        structure as ``chain_ok`` will eventually treat them as one.

        No anchor is supplied yet, so question two is always "not checked"
        here. Note where the anchor goes when B-04 adds it: ``AuditReader``
        takes it at **open** time, not at verify time, so a session opened
        without one cannot later be asked about one. Anchor profiles will
        therefore key the reader, not this call — which is worth knowing
        before someone adds an argument here and finds it has nowhere to go.
        """
        result = self._reader.verify()
        chain = result.chain
        diagnosis = result.diagnosis

        return {
            "chain": {
                "chain_ok": chain.chain_ok,
                "count": chain.count,
                # Hex because this crosses JSON and ends up in a report a
                # human compares against an anchor they were given.
                "head": chain.head.hex(),
                "breaks": list(chain.breaks),
                "gaps": list(chain.gaps),
                # (seq, reason) pairs from the package, kept as pairs: the
                # seq without its reason is a number nobody can act on.
                "violations": [[seq, reason] for seq, reason in chain.violations],
                # Unknown record types and format versions. Chain-checked,
                # reported, never rejected — so they are surfaced rather than
                # dropped, and the UI says the verifier could not interpret
                # them rather than that they are wrong.
                "uninterpretable": list(chain.uninterpretable),
            },
            "completeness": {
                "complete_to_anchor": result.complete_to_anchor,
                "anchor_lag": result.anchor_lag,
                "anchor_reason": chain.anchor_reason,
            },
            "diagnosis": None
            if diagnosis is None
            else {
                "pattern": diagnosis.pattern,
                "at_seq": diagnosis.at_seq,
                "expected": diagnosis.expected,
                # The package's own sentence, verbatim. A shell may render a
                # localised sentence beside it; it may never replace it, or
                # the report stops saying what the verifier said.
                "narrative": diagnosis.narrative,
            },
            "advisory": {
                "count": len(result.advisory.items),
                "items": [
                    {
                        "code": item.code,
                        "at_seq": item.at_seq,
                        "boot_id": None if item.boot_id is None else item.boot_id.hex(),
                        "detail": item.detail,
                    }
                    for item in result.advisory.items
                ],
            },
        }

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
