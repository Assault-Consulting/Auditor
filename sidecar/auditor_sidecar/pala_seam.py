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

from .keychain import KeychainUnavailable
from .keychain import read as keychain_read
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _dist_version
from palimpsests.audit.anchors import (
    AnchorReading,
    AnchorSourceError,
    ChainedAnchorSource,
    FileAnchor,
    ManualAnchor,
)
from palimpsests.audit.names import assurance_tier_name, time_trust_name
from palimpsests.audit.pala.codec import FORMAT_VERSION
from palimpsests.audit.reader import AuditReader
from palimpsests.audit.report import build_report
from pathlib import Path

__all__ = [
    "ChainHandle",
    "KeychainAnchor",
    "NotAChain",
    "UnknownAnchorKind",
    "open_chain",
    "package_version",
    "verifier_identity",
    "wire_format_version",
]

#: The specification this application reads. Not a marketing string: it is
#: the family name plus the wire version the *linked* verifier implements,
#: so a report always says which format was actually checked.
_SPEC_FAMILY = "PALA-1"


class UnknownAnchorKind(Exception):
    """An anchor source kind this build does not implement."""


class KeychainAnchor:
    """A head kept in the operating system's secret store.

    Implements the package's ``AnchorSource`` protocol, and lives in this
    module for the reason ADR-0001 gives: constructing ``AnchorReading`` and
    ``AnchorSourceError`` means touching ``palimpsests``, and this is the
    only file allowed to. The keychain access itself knows nothing about
    PALA-1 and sits in ``keychain.py``.

    The three outcomes map exactly as ``FileAnchor`` maps them, and the
    mapping is the whole design:

    * **absent** — no entry under that account. Normal. Returns ``None``.
    * **error** — the store cannot be reached at all: no Secret Service on a
      headless Linux box, a locked macOS keychain, the extra not installed.
      The operator may well have an anchor; this process cannot see it, and
      calling that "absent" would let a broken store read as a deliberate
      choice.
    * **error** — an entry exists and is not a head. A present-but-corrupt
      anchor is never silently downgraded to "no anchor", for the same
      reason a corrupt anchor *file* is not.
    """

    source_kind = "keychain"

    def __init__(self, account: str) -> None:
        self._account = account
        self.source_detail = f"keychain account {account!r}"

    def current_head(self) -> AnchorReading | None:
        try:
            stored = keychain_read(self._account)
        except KeychainUnavailable as exc:
            raise AnchorSourceError(
                f"the secret store could not be read: {exc}",
                source_kind=self.source_kind,
                source_detail=self.source_detail,
            ) from exc

        if stored is None:
            return None

        cleaned = stored.strip().lower()
        try:
            head = bytes.fromhex(cleaned)
        except ValueError as exc:
            raise AnchorSourceError(
                "the stored value is not a hex head",
                source_kind=self.source_kind,
                source_detail=self.source_detail,
            ) from exc
        if len(head) != 32:
            raise AnchorSourceError(
                f"the stored head is {len(head)} bytes, expected 32",
                source_kind=self.source_kind,
                source_detail=self.source_detail,
            )

        # observed_at_ns is left unset: the store records no timestamp, and
        # inventing "now" would present the moment we happened to look as
        # the moment the head was observed.
        return AnchorReading(
            head=head,
            source_kind=self.source_kind,
            source_detail=self.source_detail,
            observed_at_ns=None,
        )


def _anchor_source(specs: list[dict[str, str]]):
    """Build a chained anchor source from plain specifications.

    The shell describes *where* heads live; the package decides what a head
    means. Specs cross this boundary as dicts so no package type appears in a
    request model — the same rule that keeps ``ChainHandle`` wrapping the
    reader rather than exposing it.

    Chaining is the package's own ``ChainedAnchorSource`` rather than a loop
    written here. It is availability-first by design — a source that raises is
    recorded and the walk continues — and ``last_attempts`` is what the
    provenance display is built from. A second implementation would drift from
    the thing the UI actually renders.
    """
    sources = []
    for spec in specs:
        kind = spec["kind"]
        if kind == "manual":
            sources.append(ManualAnchor(spec["head"], detail=spec.get("detail", "")))
        elif kind == "file":
            sources.append(FileAnchor(spec["path"]))
        elif kind == "keychain":
            sources.append(KeychainAnchor(spec["account"]))
        else:
            raise UnknownAnchorKind(kind)
    return ChainedAnchorSource(sources)


class NotAChain(Exception):
    """The file is not a readable PALA-1 container.

    Distinct from "the chain fails verification". A chain that fails is
    opened, browsed and diagnosed — inspecting broken evidence is half the
    job. This is the other case: there is nothing here to inspect.
    """


def package_version() -> str:
    """The version of the verifier package this application is linked against.

    Read from the **distribution metadata**, not from ``palimpsests.__version__``.

    The two disagreed in the 0.8.0 release: the distribution reported
    ``0.8.0`` while the module attribute still read ``0.7.0``. Upstream fixed
    it in 0.9.0 and now guards it with a test, so the two agree today — but
    metadata remains the honest source, because it is what ``pip`` resolved
    and therefore what determines the code actually on disk. A verification
    report that names the wrong verifier version is a provenance defect in a
    tool that exists to establish provenance.
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

    def __init__(self, reader: AuditReader, path: Path) -> None:
        self._reader = reader
        self._path = path

    def close(self) -> None:
        self._reader.close()

    def container(self, anchor_specs: list[dict[str, str]] | None = None) -> dict[str, object]:
        """The container-level facts, including the body-digest walk.

        ``AuditReader.verify()`` walks headers only — confirmed on 0.10, not
        assumed: a record body swapped under an intact header chain still
        reports ``chain_ok`` true with no diagnosis. That is by design, and
        it is why verification needs no keys.

        The body comparison lives in ``build_report``, which runs its own
        pass and reports ``body_digest_mismatches``. Calling it here rather
        than walking bodies ourselves is ADR-0001 applied literally: the
        package owns what a body digest means, and a second implementation
        would be a second thing to be wrong.

        The cost is a second full pass over the file. It is paid once per
        (session, profile) because the result is cached alongside the
        verification, and it buys the difference between "the headers link"
        and "the file is what it says it is".
        """
        specs = anchor_specs or []
        data = build_report(
            self._path,
            anchor_source=_anchor_source(specs) if specs else None,
            tool="palimpsests-auditor-sidecar",
        ).data["container"]
        return {
            "well_formed": data["well_formed"],
            "malformed": data["malformed"],
            "bytes_parsed": data["bytes_parsed"],
            "bytes_total": data["bytes_total"],
            "body_digest_mismatches": list(data["body_digest_mismatches"]),
        }

    def verify(self, anchor_specs: list[dict[str, str]] | None = None) -> dict[str, object]:
        """Ask the verifier the three questions, and pass the answer through.

        Every value below is copied out of the package's result. Nothing is
        computed, combined or interpreted here: a shell that decides what a
        verdict means is a shell that can decide wrongly, and L1 exists so
        that it cannot.

        Two shapes deserve their names.

        ``complete_to_anchor`` is a **tri-state**, and stays one. ``None``
        means no anchor answered — none was configured, or every source was
        absent — so the question was never asked; the UI renders that as "not
        checked", never as a pass (L7). Collapsing it to a boolean here would
        destroy the distinction before anything could render it.

        ``advisory`` is carried in its own key, never merged into the chain
        result. Advisory items describe things worth a human's attention and
        change no verdict (L5); a caller that receives them in the same
        structure as ``chain_ok`` will eventually treat them as one.

        The anchor is applied by **re-opening** the container with it.
        ``AuditReader`` takes the anchor at open time, not at verify time, so
        the session's own reader — opened without one, for browsing — cannot
        be asked about it. Re-opening costs a second scan and is paid once per
        profile because the answer is cached; the alternative, keeping a
        reader per profile alive, would hold a memory map open for every
        anchor a user ever tried.
        """
        if anchor_specs:
            reader = AuditReader.open(self._path, anchor=_anchor_source(anchor_specs))
            try:
                rendered = self._render(reader.verify())
            finally:
                reader.close()
        else:
            rendered = self._render(self._reader.verify())

        # The body walk, from the package's own report builder. Carried in
        # its own key rather than folded into `chain`, because it answers a
        # different question: `chain` is about how records link, `container`
        # is about whether each record is the bytes its header claims.
        rendered["container"] = self.container(anchor_specs)
        return rendered

    def _render(self, result) -> dict[str, object]:
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
            # Provenance travels with the completeness answer, always. L2: a
            # claim about whether a chain is complete is worth exactly as much
            # as the anchor it was checked against, so the source that
            # answered — and every source that was tried and did not — are
            # part of the answer rather than a detail available elsewhere.
            "anchor": None
            if result.anchor is None
            else {
                "source_kind": result.anchor.source_kind,
                "source_detail": result.anchor.source_detail,
                "observed_at_ns": result.anchor.observed_at_ns,
                "head": result.anchor.head.hex(),
            },
            "anchor_attempts": [
                {
                    "source_kind": attempt.source_kind,
                    "source_detail": attempt.source_detail,
                    # answered / absent / error — three states, never two.
                    # Absent is normal, error is a source that exists and
                    # could not be read, and collapsing them would hide a
                    # corrupt anchor file behind "no anchor configured".
                    "outcome": attempt.outcome,
                    "error": attempt.error,
                }
                for attempt in result.anchor_attempts
            ],
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
            # Every tier and time-trust value the chain carries, not just the
            # last one. A chain whose records were written under different
            # platform guarantees is a chain whose verdict wording cannot be
            # one sentence, and picking one value would decide that silently.
            "assurance_tiers": self._named(
                {r.header.assurance_tier for r in records}, assurance_tier_name
            ),
            "time_trust_values": self._named(
                {r.header.time_trust for r in records}, time_trust_name
            ),
        }

    @staticmethod
    def _named(values: set[int], namer) -> list[dict[str, object]]:
        """Pair each raw value with the package's name for it.

        Both are carried. The name is what a person reads; the number is what
        survives a name table changing, and what a reader can compare against
        the specification. A UI given only names could not report a value
        this build has no name for — and `namer` returns None for exactly
        that case rather than inventing a label.
        """
        return [
            {"value": v, "name": namer(v)}
            for v in sorted(values)
        ]


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

    return ChainHandle(reader, path)
