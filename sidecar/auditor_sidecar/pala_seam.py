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

import threading
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
from palimpsests.audit.bootstats import boot_statistics
from palimpsests.audit.names import assurance_tier_name, time_trust_name
from palimpsests.audit.pala.codec import FORMAT_VERSION, RT_SAFETY, ZERO16, ZERO32
from palimpsests.audit.reader import AuditReader
from palimpsests.audit.report import build_report
from palimpsests.audit.timehealth import step_catalog
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


def _span_or_none(span_id: bytes | None) -> str | None:
    """A span identifier, or None when there is no span.

    PALA-1 spells "no span" as sixteen zero bytes rather than as an absent
    field — checked against the package's own ``spans()``, which skips
    records whose ``span_id`` is ``ZERO16``. A shell that hexed it blindly
    would put a span called ``00000000000000000000000000000000`` on the
    screen and, worse, into a report.
    """
    if span_id is None or span_id == ZERO16:
        return None
    return span_id.hex()


def _hash_or_none(digest: bytes) -> str | None:
    """A hash field, or None when the writer declared it has none.

    PALA-1 spells "no predecessor" as thirty-two zero bytes for exactly one
    record type — confirmed against ``palimpsests.audit.pala.incremental``:
    "'no predecessor' and 'predecessor removed' must be distinguishable;
    that is the entire reason GENESIS is a type," and GENESIS is required to
    carry ``prev_hash = ZERO32``. The same choice ``_span_or_none`` already
    makes for "no span" — a shell that hexed it blindly would put a
    predecessor named all zeros on the screen for the one record that
    truthfully has none.
    """
    if digest == ZERO32:
        return None
    return digest.hex()


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
        # AuditReader documents no thread-safety guarantee, and its own
        # decode cache (_decoded_records) has none: a fresh reader asked
        # for records/safety/timeline together — exactly what the
        # frontend does on chain-open — lets each request see the cache
        # unset and independently decode the whole chain. Measured on a
        # 100k-record fixture: decode() called 300006 times for 100002
        # records, and wall time worse than plain sequential (6.8s vs a
        # single decode's 1.66s), not "serialized for free" by the GIL.
        # RLock rather than Lock: verify() calls self.container()
        # directly (confirmed by reading, not assumed) — today that call
        # does not itself touch self._reader (container's build_report
        # call opens its own independent reader), so a plain Lock would
        # not yet deadlock, but the moment container() is wired to pass
        # reader=self._reader (the pending build_report follow-up noted
        # in DEVELOPMENT-PLAN.md's U14 entry) that call would need this
        # same lock from the same thread. RLock removes that footgun
        # now rather than leaving it for whoever lands that follow-up
        # to rediscover.
        self._lock = threading.RLock()

    def close(self) -> None:
        with self._lock:
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

        Does not touch ``self._reader`` or take this class's own lock:
        ``build_report`` here is called without ``reader=``, so it opens
        and decodes an entirely independent ``AuditReader`` of its own —
        wasteful (U14, tracked upstream), but not a race, since nothing
        about it is shared with any other call on this handle.
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

        The freshly-opened per-anchor reader below is never shared with
        anything else on this handle, so it needs no lock of its own —
        only ``self._reader`` does.
        """
        if anchor_specs:
            reader = AuditReader.open(self._path, anchor=_anchor_source(anchor_specs))
            try:
                rendered = self._render(reader.verify())
            finally:
                reader.close()
        else:
            with self._lock:
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

    def boots(self) -> list[dict[str, object]]:
        """Every boot in the chain, with the statistics the package computes.

        A boot is the unit that matters for reading time: `monotonic_ns`
        resets across one, so no duration may be computed across a boundary.
        The uptime here is the package's own figure, not a subtraction done
        in this file.

        `time_trust_values` is a set on the package's view and a sorted list
        here. More than one value means the clock changed status mid-boot,
        which qualifies every wall-time claim inside it — so the set is
        carried rather than reduced.
        """
        with self._lock:
            stats_list = list(boot_statistics(self._reader))
        return [
            {
                "boot_id": stats.view.boot_id.hex(),
                "first_seq": stats.view.first_seq,
                "last_seq": stats.view.last_seq,
                "record_count": stats.view.record_count,
                "time_trust_values": self._named(
                    set(stats.view.time_trust_values), time_trust_name
                ),
                # Present when this boot began by recovering a truncated
                # tail. Null is the ordinary case, not a missing value.
                "recovery_seq": stats.view.recovery_seq,
                "uptime_ns": stats.uptime_ns,
                "anchors": {
                    "count": stats.anchors.count,
                    "widest_gap_ns": stats.anchors.widest_anchor_gap_ns,
                },
                "spans": {
                    "closed": stats.spans.closed,
                    "open": stats.spans.open,
                    "open_rate": stats.spans.open_rate,
                    "median_duration_ns": stats.spans.median_duration_ns,
                },
            }
            for stats in stats_list
        ]

    def spans(self) -> list[dict[str, object]]:
        """Every span, with its parent and the records it covers.

        `end_seq` is null for a span that was opened and never closed. That
        is first-class evidence rather than a defect — an interrupted
        operation looks exactly like this, and the record of it is intact —
        so it is reported as null and never as the last record seen.
        """
        with self._lock:
            span_list = list(self._reader.spans())
        return [
            {
                "span_id": span.span_id.hex(),
                "parent_span_id": _span_or_none(span.parent_span_id),
                "start_seq": span.start_seq,
                "end_seq": span.end_seq,
                "record_count": len(span.record_seqs),
                "record_seqs": list(span.record_seqs),
            }
            for span in span_list
        ]

    def record(self, seq: int) -> dict[str, object] | None:
        """One record by sequence number, or None when there is no such record.

        None rather than an exception: asking for a record that is not in
        this file is an ordinary question with an ordinary answer, and a
        segment holding records 400–900 legitimately has no record 12.

        Materialized under the lock rather than iterated directly: the
        early ``break`` below saves nothing regardless, since
        ``_decoded_records()`` builds its whole list before the first
        item is ever yielded — the decode cost is already paid by the
        time this loop starts, held under the lock or not.
        """
        with self._lock:
            records = list(self._reader.records())
        for record in records:
            if record.seq == seq:
                return self._record_view(record)
            if record.seq > seq:
                break
        return None

    def records(
        self,
        offset: int = 0,
        limit: int = 200,
        record_type: int | None = None,
        boot_id: str | None = None,
        span_id: str | None = None,
    ) -> dict[str, object]:
        """A window onto the records, with the header fields for each.

        Paginated because a chain has no bound. A container from a busy
        deployment can hold millions of records, and an endpoint that
        serialised all of them would fail in the one situation the tool is
        most needed — which is why §C-10 asks for a size envelope rather
        than assuming files stay small.

        The filters narrow *which* records the window is drawn from, and
        `total` counts the matches rather than the file. A `total` that
        counted everything would make "3 of 40000" appear above three rows
        that are the only three there are.

        Filtering by an unknown value is not an error. A boot identifier
        that appears nowhere yields an empty window, which is the truthful
        answer to "show me that boot's records" when the file does not have
        it.

        `span_id=None` means *do not filter by span*, so there is currently
        no way to ask for "records in no span at all". That is a real gap
        rather than an oversight to fix in passing: the filter chips of
        §C-09 will need it, and inventing a sentinel here — an empty string,
        or the literal "none" — would decide their vocabulary from the
        wrong end.

        Body TLVs are reported as **type and length, not content**. Bodies
        may be encrypted, and a records list is a structural view; showing
        what is inside a record is C-06d's job (`DEVELOPMENT-PLAN.md`, §5)
        and needs its own decisions about keys and redaction.
        """
        window: list[dict[str, object]] = []
        matched = 0
        matched_at_or_past_offset = 0

        # One walk. An earlier version computed `has_more` with a second
        # pass over the file, which is the cost a paginated endpoint exists
        # to avoid — on the million-record container §C-10 targets, every
        # page would have read the whole chain twice.
        #
        # Still one walk after materializing under the lock below:
        # `self._reader.records()` is still called exactly once. Only
        # *when* the underlying generator is drained relative to the lock
        # moved, not how many times the file is walked.
        with self._lock:
            records = list(self._reader.records())
        for record in records:
            if not self._matches(record, record_type, boot_id, span_id):
                continue
            matched += 1
            if record.seq < offset:
                continue
            matched_at_or_past_offset += 1
            if len(window) < limit:
                window.append(self._record_view(record))

        return {
            "records": window,
            "offset": offset,
            "limit": limit,
            # The matches, not the file. A total counting everything would
            # print "3 of 40000" above three rows that are the only three
            # there are.
            "total": matched,
            # Whether any match past this window exists, counted over the
            # matches rather than inferred from the window's length — which
            # is ambiguous when it ends exactly on the last one.
            "has_more": matched_at_or_past_offset > len(window),
        }

    @staticmethod
    def _matches(
        record,
        record_type: int | None,
        boot_id: str | None,
        span_id: str | None,
    ) -> bool:
        """Whether a record passes the filters, all of which are ANDed."""
        if record_type is not None and record.record_type != record_type:
            return False
        if boot_id is not None and record.header.boot_id.hex() != boot_id:
            return False
        if span_id is not None and _span_or_none(record.header.span_id) != span_id:
            return False
        return True

    def _record_view(self, record) -> dict[str, object]:
        """One record's header fields, as plain data.

        Shared by the window and the single-record view so the two cannot
        describe the same record differently — which they would, eventually,
        if each built its own dict.
        """
        header = record.header
        return {
            "seq": record.seq,
            "index": record.index,
            "record_type": record.record_type,
            "type_name": record.type_name,
            "kind": record.kind,
            "kind_name": record.kind_name,
            "boot_id": header.boot_id.hex(),
            # The absence of a span is sixteen zero bytes, not None —
            # the package's own `spans()` skips records whose span_id
            # is ZERO16. Rendering that as an identifier would put a
            # span called 00000000… on the screen and in reports.
            "span_id": _span_or_none(header.span_id),
            "parent_span_id": _span_or_none(header.parent_span_id),
            # The record's OWN CLAIM about its predecessor — unverified
            # here. Whether it actually matches the predecessor's hash is
            # what /verify establishes; this view reports the field
            # structurally, the same distinction /verify already draws
            # between "the chain links" and "this file's headers decode".
            "prev_hash": _hash_or_none(header.prev_hash),
            "wall_clock_ns": header.wall_clock_ns,
            "monotonic_ns": header.monotonic_ns,
            "assurance_tier": self._named(
                {header.assurance_tier}, assurance_tier_name
            )[0],
            "time_trust": self._named({header.time_trust}, time_trust_name)[0],
            "body_len": header.body_len,
            # None when the reader produced no TLV list at all. On
            # a plain chain that is the record types with no body —
            # GENESIS, BOOT and ANCHOR all report body_len 0 — but
            # an encrypted or unparseable body reaches here the same
            # way. Either way it is "this view has no TLV types to
            # show", which is a different fact from "the body has
            # none", and [] would conflate them.
            "body_tlv_types": None
            if record.body_tlvs is None
            else sorted({tlv_type for tlv_type, _ in record.body_tlvs}),
            # An integer, and zero means "not encrypted under a named key"
            # rather than "key number zero".
            "key_id": None if header.key_id == 0 else header.key_id,
        }

    #: One UTC day, in nanoseconds. The rail groups by calendar day, and a
    #: calendar day is the one unit here that is not a free choice: a
    #: uniform bucket of "about a day" straddles midnight, so a record near
    #: one is attributed to whichever side the arithmetic happens to fall —
    #: which for a SAFETY record means showing it on the wrong date.
    _DAY_NS = 86_400_000_000_000

    def timeline(
        self, axis: str = "seq", buckets: int = 120, align: str | None = None
    ) -> dict[str, object]:
        """Record density along one of two axes, and what breaks the ruler.

        **Two axes, and they are not interchangeable (L3).** `seq` is proved
        order — the hash chain establishes it and nothing can reorder it.
        `wall` is the writer's clock: a recorded claim, qualified by
        `time_trust`, and the payload carries that qualifier so no consumer
        can present a wall-time chart without saying whose clock it was.

        Buckets are **uniform and never omitted when empty**. An empty
        stretch is a fact about the chain — it is the quiet week, the gap
        between boots — and a series that skipped empty buckets would draw a
        dense chain out of a sparse one.

        Boot boundaries are reported separately rather than smoothed into the
        series, because §C-03 renders them as axis breaks. `monotonic_ns`
        resets across a boot, so no duration spans one; this endpoint never
        computes one that does.

        A wall gap between boots is reported with both ends, so a UI can
        hatch it and remove the ruler inside it — "the clock is unverifiable
        while down" is a statement about the gap, not about the records
        either side of it.

        Steps in the writer's clock come from the package's own
        `step_catalog`, and any bucket containing one is marked. A density
        bar drawn on wall time across a clock step is measuring two different
        clocks and saying nothing about either.

        **`align="day"` is a different question, not a nicer default.**
        Uniform buckets divide the range evenly; day-aligned buckets start at
        UTC midnight and are exactly one day wide. A date rail needs the
        second: a uniform bucket of roughly a day straddles midnight, so a
        record just after it is counted in a bucket that began the previous
        day, and the row is labelled with the wrong date. For a SAFETY record
        that is the quiet kind of wrong this application exists to refuse.

        The day is **UTC**, and that is a decision rather than a default. The
        same container must produce the same rail on every desk: in the
        reader's local zone, two auditors comparing screenshots would
        disagree about which day a record fell on, and a tool whose claim is
        reproducibility cannot afford that. A local-time view is a labelled
        option for later, never the silent one.

        Alignment applies to the wall axis only. Sequence numbers have no
        midnight.
        """
        if axis not in ("seq", "wall"):
            raise ValueError(f"unknown axis: {axis!r}")
        if align not in (None, "day"):
            raise ValueError(f"unknown alignment: {align!r}")
        if align is not None and axis != "wall":
            raise ValueError(
                f"alignment {align!r} needs axis='wall'; "
                f"sequence numbers have no calendar"
            )

        with self._lock:
            records = list(self._reader.records())
        if not records:
            # Cannot happen through open_chain, which refuses an empty
            # container — but a timeline of nothing is still an answer rather
            # than a division by zero.
            return {
                "axis": axis,
                "basis": "proved" if axis == "seq" else "recorded",
                # Carried here too. The model requires it, so omitting it in
                # this branch would turn an unreachable case into a 500 the
                # first time it became reachable.
                "align": align,
                "buckets": [],
                "start": None,
                "end": None,
                "boot_boundaries": [],
                "wall_gaps": [],
                "wall_follows_seq": True,
                "time_trust_values": [],
                "steps": [],
            }

        position = (
            (lambda r: r.seq) if axis == "seq" else (lambda r: r.header.wall_clock_ns)
        )
        lo = min(position(r) for r in records)
        hi = max(position(r) for r in records)

        if align == "day":
            # Snap the origin back to the midnight at or before the first
            # record, so every bucket is a whole calendar day and its start
            # is a date rather than an offset into one.
            lo = (lo // self._DAY_NS) * self._DAY_NS
            width = self._DAY_NS
            used = (hi - lo) // width + 1
            # `buckets` does not apply: the number of days is a fact about
            # the chain, not a resolution the caller picks. Refusing here
            # rather than silently truncating — a rail missing its last week
            # would look like a chain that ended early.
            if used > buckets:
                raise ValueError(
                    f"the chain spans {used} days, more than the {buckets} "
                    f"buckets requested; raise buckets to see all of it"
                )
        else:
            # A single-point range still gets one bucket rather than a
            # zero-width division: one record, or a whole chain written
            # inside one clock tick, is a real chain.
            width = max(1, (hi - lo + 1 + buckets - 1) // buckets)
            used = min(buckets, (hi - lo) // width + 1)

        counted: list[dict[str, object]] = [
            {
                "start": lo + i * width,
                "end": lo + (i + 1) * width - 1,
                "count": 0,
                "safety": 0,
                "anchor": 0,
            }
            for i in range(used)
        ]
        for record in records:
            index = min(used - 1, (position(record) - lo) // width)
            bucket = counted[index]
            bucket["count"] = int(bucket["count"]) + 1
            if record.type_name == "SAFETY":
                bucket["safety"] = int(bucket["safety"]) + 1
            elif record.type_name == "ANCHOR":
                bucket["anchor"] = int(bucket["anchor"]) + 1

        with self._lock:
            step_data = list(step_catalog(self._reader))
        steps = [
            {
                "seq": step.seq,
                "kind": step.kind,
                "delta_ns": step.delta_ns,
                "boot_id": step.boot_id.hex(),
            }
            for step in step_data
        ]
        stepped_seqs = {step["seq"] for step in steps}
        for record in records:
            if record.seq in stepped_seqs:
                index = min(used - 1, (position(record) - lo) // width)
                counted[index]["stepped"] = True
        for bucket in counted:
            bucket.setdefault("stepped", False)

        with self._lock:
            boots = self._reader.boots()
        by_seq = {r.seq: r for r in records}
        boundaries = [
            {
                "boot_id": boot.boot_id.hex(),
                "first_seq": boot.first_seq,
                "last_seq": boot.last_seq,
                "first_wall_ns": by_seq[boot.first_seq].header.wall_clock_ns,
                "last_wall_ns": by_seq[boot.last_seq].header.wall_clock_ns,
            }
            for boot in boots
            if boot.first_seq in by_seq and boot.last_seq in by_seq
        ]

        # The gap between one boot's last wall reading and the next boot's
        # first. Reported even when it is zero or negative: a negative gap
        # means the clock moved backwards across the boundary, which is a
        # fact the ruler cannot represent and a UI must not hide.
        gaps = [
            {
                "after_boot_id": earlier["boot_id"],
                "before_boot_id": later["boot_id"],
                "from_wall_ns": earlier["last_wall_ns"],
                "to_wall_ns": later["first_wall_ns"],
                "duration_ns": int(later["first_wall_ns"]) - int(earlier["last_wall_ns"]),
            }
            # strict=False on purpose: this pairs the list with its own tail,
            # so the lengths differ by one by construction.
            for earlier, later in zip(boundaries, boundaries[1:], strict=False)
        ]

        walls = [r.header.wall_clock_ns for r in sorted(records, key=lambda r: r.seq)]
        return {
            "axis": axis,
            # Carried rather than inferred from `axis`, so a consumer cannot
            # label a wall chart "proved" by reading the wrong field.
            "basis": "proved" if axis == "seq" else "recorded",
            # Null for uniform buckets, "day" when they are calendar days in
            # UTC. A consumer rendering dates has to know which it got: a
            # date printed from a uniform bucket's start is a date the record
            # may not have happened on.
            "align": align,
            "buckets": counted,
            "start": lo,
            "end": hi,
            "boot_boundaries": boundaries,
            "wall_gaps": gaps,
            # False means the writer's clock disagrees with proved order
            # somewhere. The wall axis then reorders records relative to the
            # chain, and a UI showing it must say so.
            "wall_follows_seq": all(
                a <= b for a, b in zip(walls, walls[1:], strict=False)
            ),
            "time_trust_values": self._named(
                {r.header.time_trust for r in records}, time_trust_name
            ),
            "steps": steps,
        }

    def origin(self, seq: int) -> dict[str, object] | None:
        """What was running when a record was written, or None if unstated.

        `None` is a real answer and the common one at the start of a chain:
        nothing before the first MODEL_LOAD has an origin, because none had
        been declared. A UI must show that as "not stated in this file"
        rather than as an empty card, which would read as "nothing was
        running".

        F9 also asks for a second null wording — "no model active" after an
        explicit MODEL_UNLOAD — and this method cannot currently produce it.
        Read directly: `AuditReader.origin_at()` sets its running state to
        `None` on `KIND_MODEL_UNLOAD` exactly the way it starts at `None`
        before any `MODEL_LOAD`, so both collapse to the same return value.
        Telling them apart on this side of the seam would mean re-walking
        records to find the last MODEL_UNLOAD ourselves — the second-
        implementation mistake ADR-0001 exists to rule out. Tracked as U11.

        `since_seq` is the record that declared it, so a reader can jump to
        the declaration rather than take this on trust — the same reason
        every other claim here names its source.
        """
        with self._lock:
            view = self._reader.origin_at(seq)
        if view is None:
            return None
        return {
            "role": view.role,
            "model_digest": view.model_digest.hex(),
            "config_digest": view.config_digest.hex(),
            "since_seq": view.since_seq,
            "detail": view.detail,
        }

    def safety(self, limit: int = 500) -> dict[str, object]:
        """Every SAFETY record, in the order F8 asks for.

        `limit` is a defensive internal cap, not a caller-facing page
        size — `/safety` exposes no query parameter for it, because this
        answer is cached once per session the same way boots and spans
        are, and a caller-adjustable limit on a cached-without-a-key
        answer is exactly the class of bug the `Session` docstring is
        careful to avoid elsewhere. F8 asks for the whole list; this
        bounds it only against a pathologically large chain.

        "Sorted by seq" is the reader's own iteration order over the
        chain — nothing computed. "Grouped by kind_name" is left to the
        caller: `kind_name` is already resolved per record by
        `_record_view`, and turning a flat, ordered list into groups is
        display logic, not a decoded fact the package owns.

        `detail` text and any r2 acknowledgement state are **not**
        here. Both need a body TLV value actually decoded — `EVT_DETAIL`
        for the first; `EVT_REF_SEQ` / `EVT_REF_HASH` plus a candidate's
        own hash (still U10) to bind a reference correctly rather than
        guess at it, for the second. `_record_view` reports only what it
        already resolves, the same discipline `records()` and `record()`
        keep — this view is a filtered read of the same thing, not a
        second one. Tracked as U12 (detail) and U13 (r2 resolution) in
        `DEVELOPMENT-PLAN.md`, §2.

        The response has the exact shape of `records()`'s window, reused
        rather than given a shape of its own: `total` counts SAFETY
        records that exist past the count returned, the same distinction
        `records()` already draws between "matched" and "in the file".
        """
        window: list[dict[str, object]] = []
        total = 0
        with self._lock:
            records = list(self._reader.records())
        for record in records:
            if record.record_type != RT_SAFETY:
                continue
            total += 1
            if len(window) < limit:
                window.append(self._record_view(record))
        return {
            "records": window,
            "offset": 0,
            "limit": limit,
            "total": total,
            "has_more": total > len(window),
        }

    def subject(self) -> dict[str, object]:
        """What the container is, before any verdict about it.

        Every value here comes from the reader. Counts are taken from the
        decoded records rather than from the file, because the file's byte
        length is not evidence of how many records it holds — a truncated
        tail has bytes and no record.
        """
        with self._lock:
            records = list(self._reader.records())
            boots = self._reader.boots()
            spans = self._reader.spans()
        seqs = [r.seq for r in records]
        return {
            "records": len(records),
            "first_seq": min(seqs) if seqs else None,
            "last_seq": max(seqs) if seqs else None,
            "boots": len(boots),
            "spans": len(spans),
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
