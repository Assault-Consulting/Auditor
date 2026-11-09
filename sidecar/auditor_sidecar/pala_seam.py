# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The one place this repository touches ``palimpsests``.

ADR-0001: every PALA-1 fact this application renders comes from a verifier
call in the package. Nothing else in this repository — Python, Rust or
TypeScript — imports ``palimpsests``, parses container bytes, or re-derives
a value the package already produces. ``scripts/check_no_wire_parsing.sh``
fails the build on any violation, and this module is its only exemption for
package access.

Imports come only from the consumer surface `CONSUMER-SURFACE.md` r2
defines (C-16): the ``__all__`` of ``reader``, ``anchors``,
``anchors_pkcs11`` and ``names``, and ``report.build_report`` (channel 2).
``scripts/check_no_wire_parsing.sh`` refuses any other module, and
``tests/test_consumer_surface.py`` checks every name against the installed
package's ``__all__``.

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
from array import array
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _dist_version
from palimpsests.audit.anchors import (
    AnchorReading,
    AnchorSourceError,
    ChainedAnchorSource,
    FileAnchor,
    ManualAnchor,
)
from palimpsests.audit.anchors_pkcs11 import (
    DEFAULT_OBJECT_LABEL,
    Pkcs11Anchor,
    Pkcs11Unavailable,
)
from palimpsests.audit.names import assurance_tier_name, time_trust_name
from palimpsests.audit.reader import (
    FORMAT_VERSION,
    KIND_INCIDENT_CANDIDATE,
    NO_PREDECESSOR,
    NO_SPAN,
    RT_SAFETY,
    AuditReader,
    boot_statistics,
    decode_continuation,
    step_catalog,
)
from palimpsests.audit.report import build_report
from pathlib import Path

__all__ = [
    "ChainHandle",
    "KeychainAnchor",
    "NotAChain",
    "Pkcs11PinnedAnchor",
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


class Pkcs11PinnedAnchor:
    """A head on a PKCS#11 token (B-12), with its PIN kept in the keychain.

    The reading itself is the package's ``Pkcs11Anchor`` (ADR-0004) — this
    class adds exactly the two things that are this application's business
    and nothing about what a head means:

    **Where the PIN lives.** Never in the profile. Profiles are returned in
    full by ``GET /anchors/profiles``, so a PIN carried in one would be one
    request away from any holder of the session token. The profile names a
    keychain account instead, and the PIN is read at the moment of use.

    **Why a PIN is required at all.** Measured, not assumed, against
    SoftHSM: a head written by the package's own ``Pkcs11AnchorStore`` is
    invisible to a session opened without a PIN, and ``Pkcs11Anchor`` then
    returns ``None`` — *absent* — for an anchor that is sitting right there.
    That is the one degradation the three-outcome rule exists to forbid: a
    completeness question quietly reported as "not checked" when it could
    have been answered. Requiring a PIN makes the unlogged read impossible
    to configure, rather than documenting it as a trap.

    Failure mapping, all to ``AnchorSourceError`` so the chain records the
    link and walks on: no PIN stored under that account; the secret store
    unreachable; the ``[pkcs11]`` extra not installed. The last one mattered
    because ``Pkcs11Unavailable`` is a plain ``RuntimeError`` — unconverted,
    it escaped ``ChainedAnchorSource`` and turned one misconfigured link
    into a 500 for the whole verification. Since 0.12.0 the package itself
    converts it on the read path (upstream F2, reported from here); the
    conversion below is now redundant and kept deliberately — it costs
    nothing, and it keeps this link's failure mapping true on its own
    rather than only as long as upstream's stays.

    Upstream also now refuses a PIN-less read outright (0.12.0, F1). The
    PIN requirement here predates that and is kept for its own reason:
    the PIN lives in the keychain, never in a profile.
    """

    source_kind = "pkcs11"

    def __init__(
        self,
        module_path: str,
        token_label: str,
        pin_account: str,
        object_label: str = DEFAULT_OBJECT_LABEL,
    ) -> None:
        self._module_path = module_path
        self._token_label = token_label
        self._pin_account = pin_account
        self._object_label = object_label
        # Identical to the package's own source_detail for the same token
        # and object, so an attempt that fails here and one that fails
        # inside Pkcs11Anchor name the link the same way.
        self.source_detail = f"{token_label}/{object_label}"

    def _error(self, message: str) -> AnchorSourceError:
        return AnchorSourceError(
            message, source_kind=self.source_kind, source_detail=self.source_detail
        )

    def current_head(self) -> AnchorReading | None:
        try:
            pin = keychain_read(self._pin_account)
        except KeychainUnavailable as exc:
            raise self._error(
                f"the token PIN could not be read from the secret store: {exc}"
            ) from exc
        if pin is None:
            raise self._error(
                f"no token PIN is stored under keychain account {self._pin_account!r}"
            )
        try:
            return Pkcs11Anchor(
                self._module_path,
                self._token_label,
                user_pin=pin,
                object_label=self._object_label,
            ).current_head()
        except Pkcs11Unavailable as exc:
            raise self._error(str(exc)) from exc


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
        elif kind == "pkcs11":
            sources.append(
                Pkcs11PinnedAnchor(
                    spec["module_path"],
                    spec["token_label"],
                    spec["pin_account"],
                    spec.get("object_label") or DEFAULT_OBJECT_LABEL,
                )
            )
        else:
            raise UnknownAnchorKind(kind)
    return ChainedAnchorSource(sources)


def _span_or_none(span_id: bytes | None) -> str | None:
    """A span identifier, or None when there is no span.

    PALA-1 spells "no span" as sixteen zero bytes rather than as an absent
    field — checked against the package's own ``spans()``, which skips
    records whose ``span_id`` is ``NO_SPAN`` (sixteen zero bytes). A shell that hexed it blindly
    would put a span called ``00000000000000000000000000000000`` on the
    screen and, worse, into a report.
    """
    if span_id is None or span_id == NO_SPAN:
        return None
    return span_id.hex()


def _hash_or_none(digest: bytes) -> str | None:
    """A hash field, or None when the writer declared it has none.

    PALA-1 spells "no predecessor" as thirty-two zero bytes for exactly one
    record type — confirmed against ``palimpsests.audit.pala.incremental``:
    "'no predecessor' and 'predecessor removed' must be distinguishable;
    that is the entire reason GENESIS is a type," and GENESIS is required to
    carry ``prev_hash = NO_PREDECESSOR`` (thirty-two zero bytes). The same
    choice ``_span_or_none`` already makes for "no span" — a shell that
    hexed it blindly would put a
    predecessor named all zeros on the screen for the one record that
    truthfully has none.
    """
    if digest == NO_PREDECESSOR:
        return None
    return digest.hex()


class NotAChain(Exception):
    """The file is not a readable PALA-1 container.

    Distinct from "the chain fails verification". A chain that fails is
    opened, browsed and diagnosed — inspecting broken evidence is half the
    job. This is the other case: there is nothing here to inspect.
    """


@dataclass(frozen=True)
class _AckContext:
    """The oversight loop as ``_record_view`` needs it — see ``_ack_context``."""

    ack_of: dict[int, int]
    candidate_of: dict[int, int]
    latency_ns: dict[int, int]


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


@dataclass
class _HeaderIndex:
    """Every record's header fields, read once, kept as flat arrays (C-10b).

    The seam used to answer every structural question by decoding the whole
    chain (`records()`), which cost 21.6 s and 2.0 GB at 1M records before the
    first answer. Everything those answers read is in the headers, so one
    header pass through the package's `header_at()` (0.13, U16) — no body is
    decoded — builds this, and each question reads arrays instead.

    Bytes are read only through the package; nothing here parses wire bytes
    (ADR-0001). An entry whose header does not decode keeps its seq and type
    (from the package's own `record_at()`), with `ok` 0 and no clock fields.
    """

    seq: array
    wall: array
    rtype: array
    tier: array
    trust: array
    boot: array
    span: array
    ok: bytearray
    boot_ids: list
    span_ids: list
    type_names: dict
    seq_sorted: bool

    def __len__(self) -> int:
        return len(self.seq)

    def last_index_of(self, seq: int) -> int | None:
        """The last record carrying `seq` — what `{r.seq: r for r in ...}` picks."""
        if self.seq_sorted:
            i = bisect_right(self.seq, seq) - 1
            return i if i >= 0 and self.seq[i] == seq else None
        for i in range(len(self.seq) - 1, -1, -1):
            if self.seq[i] == seq:
                return i
        return None

    def walls_follow_seq(self) -> bool:
        """Whether wall time is non-decreasing in seq order (ties kept in file order)."""
        order = (
            range(len(self.seq))
            if self.seq_sorted
            else sorted(range(len(self.seq)), key=lambda i: (self.seq[i], i))
        )
        prev = None
        for i in order:
            if not self.ok[i]:
                continue
            w = self.wall[i]
            if prev is not None and w < prev:
                return False
            prev = w
        return True


class ChainHandle:
    """An open container, and the only way to ask anything about one.

    Wraps ``AuditReader`` rather than exposing it, so no package type crosses
    this module's boundary.
    """

    def __init__(self, reader: AuditReader, path: Path) -> None:
        self._reader = reader
        self._path = path
        # Before 0.12.0, AuditReader's decode cache (_decoded_records)
        # had no lock: a fresh reader asked for records/safety/timeline
        # together — exactly what the frontend does on chain-open — let
        # each request see the cache unset and decode the whole chain
        # independently. Measured on a 100k-record fixture: decode()
        # called 300006 times for 100002 records, 6.8s against 1.66s.
        # 0.12.0 fills that cache under a lock of its own (upstream F3,
        # reported from here). This lock stays anyway: it is cheap, it
        # still makes each multi-call read below (records, then acks,
        # then shreds) one consistent view, and it is the one place a
        # future non-thread-safe reader method would be covered by
        # default rather than by remembering to.
        # RLock rather than Lock: verify() calls self.container()
        # directly. That follow-up landed (0.11.0 released container()'s
        # own reader= wiring) — but verify()'s own `with self._lock:`
        # block wraps only its direct call to self._reader.verify(),
        # exiting before container() is ever reached, so this specific
        # path never actually nests one acquisition inside the other.
        # RLock stays regardless: the one guarantee worth keeping is
        # that a future refactor moving container()'s call inside that
        # same `with` block — an easy, easy-to-miss change — degrades
        # to a slightly wider lock, not a deadlock a plain Lock would
        # produce silently.
        self._lock = threading.RLock()
        # Built on first use, then kept: the chain a handle holds does not
        # change under it (sessions.assert_unchanged refuses a changed file).
        self._index: _HeaderIndex | None = None
        self._safety_ctx: tuple[_AckContext, dict[int, int], Counter] | None = None

    def _header_index(self) -> _HeaderIndex:
        if self._index is None:
            with self._lock:
                if self._index is None:
                    self._index = self._build_index()
        return self._index

    def _build_index(self) -> _HeaderIndex:
        reader = self._reader
        seq, wall = array("Q"), array("q")
        rtype, tier, trust = array("H"), array("B"), array("B")
        boot, span = array("I"), array("I")
        ok = bytearray()
        boot_ids: list[bytes] = []
        span_ids: list[bytes] = []
        boot_at: dict[bytes, int] = {}
        span_at: dict[bytes, int] = {}
        first_of_type: dict[int, int] = {}
        for i in range(reader.record_count):
            header = reader.header_at(i)
            if header is None:
                record = reader.record_at(i)
                seq.append(record.seq)
                rtype.append(record.record_type)
                wall.append(0)
                tier.append(0)
                trust.append(0)
                boot.append(0)
                span.append(0)
                ok.append(0)
                continue
            seq.append(header.seq)
            rtype.append(header.record_type)
            wall.append(header.wall_clock_ns)
            tier.append(header.assurance_tier)
            trust.append(header.time_trust)
            b = boot_at.get(header.boot_id)
            if b is None:
                b = boot_at[header.boot_id] = len(boot_ids)
                boot_ids.append(header.boot_id)
            boot.append(b)
            sp = span_at.get(header.span_id)
            if sp is None:
                sp = span_at[header.span_id] = len(span_ids)
                span_ids.append(header.span_id)
            span.append(sp)
            ok.append(1)
            first_of_type.setdefault(header.record_type, i)
        # A type's name is the package's, read from one decoded record of
        # each type present — never from a table kept on this side.
        type_names = {t: reader.record_at(i).type_name for t, i in first_of_type.items()}
        seq_sorted = all(seq[i] <= seq[i + 1] for i in range(len(seq) - 1))
        return _HeaderIndex(
            seq, wall, rtype, tier, trust, boot, span, ok,
            boot_ids, span_ids, type_names, seq_sorted,
        )

    def _type_name_at(self, idx: _HeaderIndex, i: int) -> str | None:
        return idx.type_names.get(idx.rtype[i]) if idx.ok[i] else None

    def _prev_seq(self, index: int) -> int | None:
        if index <= 0:
            return None
        return self._header_index().seq[index - 1]

    def _safety_context(self) -> tuple[_AckContext, dict[int, int], Counter]:
        """The oversight loop, shreds and detail counts, resolved once.

        Each is the package's own bounded answer since 0.13 —
        `acknowledged_candidates()` and `safety_records()` read SAFETY
        records only, `shredded_targets()` decodes KEY_SHRED records only
        (U23) — so none of them decodes the chain.
        """
        if self._safety_ctx is None:
            with self._lock:
                if self._safety_ctx is None:
                    acknowledged = self._reader.acknowledged_candidates()
                    shredded = self._reader.shredded_targets()
                    safety = list(self._reader.safety_records())
                    detail_counts = self._detail_counts(safety)
                    acks = self._ack_context(acknowledged)
                    self._safety_ctx = (acks, shredded, detail_counts)
        return self._safety_ctx

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

        Two paths, not one, and they must stay separate. With no anchor
        override, this reuses ``self._reader`` via ``build_report``'s own
        ``reader=`` (released in 0.11.0) — no second decode, held under
        this class's lock the same as every other touch to ``self._reader``.
        With an anchor override, ``self._reader`` cannot be used at all:
        ``build_report``'s own docstring is explicit that ``anchor_source``
        is *ignored* when ``reader`` is given, since a shared reader
        answers with its own anchor — and ``self._reader`` was opened with
        none. Before 0.12.0, passing both silently checked the file
        against no anchor while the caller asked for a specific one; since
        0.12.0 (upstream F4, reported from here) the package refuses the
        combination with ``ValueError`` — which this method never
        triggers, because the two paths stay apart. The override path
        still pays a second open, by necessity.
        """
        specs = anchor_specs or []
        if specs:
            data = build_report(
                self._path,
                anchor_source=_anchor_source(specs),
                tool="palimpsests-auditor-sidecar",
            ).data["container"]
        else:
            with self._lock:
                data = build_report(
                    self._path,
                    reader=self._reader,
                    tool="palimpsests-auditor-sidecar",
                ).data["container"]
        return {
            "well_formed": data["well_formed"],
            "malformed": data["malformed"],
            "bytes_parsed": data["bytes_parsed"],
            "bytes_total": data["bytes_total"],
            "body_digest_mismatches": list(data["body_digest_mismatches"]),
        }

    def report(self, anchor_specs: list[dict[str, str]] | None = None) -> dict[str, object]:
        """The package's verification report, as the package built it (D-01).

        ``build_report`` (channel 2) produces ``pala-verification-report/1``
        and its verdict, through ``derive_verdict`` — the one verdict rule,
        which a renderer must not re-derive. Nothing here edits, reorders or
        summarises it: the dict is the package's ``data`` and the text is its
        own ``to_json_bytes()``, so what the screen shows and what a copy
        holds are the same bytes the package wrote.

        The two paths are the ones ``container()`` keeps apart, for the same
        reason: with no anchor, the session's own reader is reused; with one,
        ``build_report`` opens its own, because a shared reader answers with
        the anchor it was opened with — none.
        """
        specs = anchor_specs or []
        if specs:
            built = build_report(
                self._path,
                anchor_source=_anchor_source(specs),
                tool="palimpsests-auditor-sidecar",
            )
        else:
            with self._lock:
                built = build_report(
                    self._path,
                    reader=self._reader,
                    tool="palimpsests-auditor-sidecar",
                )
        return {"report": built.data, "json": built.to_json_bytes().decode("utf-8")}

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
            # The second file a verdict may rest on (U17, 0.13): the segments
            # manifest a continuation diagnosis was decided against. Carried as
            # the package read it — path, status, the digest of the bytes it
            # judged — so the session can hold it to the same "still the same
            # bytes" test as the container itself (sessions.assert_unchanged).
            "manifest": None
            if result.manifest is None
            else {
                "path": result.manifest.path,
                "status": result.manifest.status,
                "sha256": None
                if result.manifest.sha256 is None
                else result.manifest.sha256.hex(),
                "detail": result.manifest.detail,
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

        The first record in file order whose seq is at least the one asked
        for answers: that record if its seq matches, None if it overshoots —
        the same walk-and-stop the full decode did, read off the header
        index (C-10b) and decoding only the one record returned.
        """
        idx = self._header_index()
        if idx.seq_sorted:
            i = bisect_left(idx.seq, seq)
            found = i if i < len(idx) and idx.seq[i] == seq else None
        else:
            found = None
            for i in range(len(idx)):
                if idx.seq[i] >= seq:
                    found = i if idx.seq[i] == seq else None
                    break
        if found is None:
            return None
        acks, shredded, detail_counts = self._safety_context()
        with self._lock:
            record = self._reader.record_at(found)
        return self._record_view(record, self._prev_seq(found), acks, shredded, detail_counts)

    def records(
        self,
        offset: int = 0,
        limit: int = 200,
        record_type: int | None = None,
        boot_id: str | None = None,
        span_id: str | None = None,
        type_name: str | None = None,
        kind_name: str | None = None,
        tier: str | None = None,
        source_name: str | None = None,
        outcome_name: str | None = None,
        record_hash: str | None = None,
        wall_from_ns: int | None = None,
        wall_to_ns: int | None = None,
        text: str | None = None,
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

        `type_name`, `kind_name` and `tier` filter by **name** (C-09b), and
        by the name the package itself resolves on each record — never by a
        name-to-number table kept on this side of the seam. A filter chip
        typed as `kind:INCIDENT_CANDIDATE` therefore means exactly what the
        record card shows as its kind, and a kind this build cannot name
        (`kind_name` null) is simply never matched by a name. Matching is
        exact: the names are the package's, and case-folding them here would
        be a small second opinion about what a name is.

        `source_name` (C-12) is the same kind of filter over the evidence
        mark on TOOL_CALL / TOOL_RESULT records — `reported-by-client` or
        `parsed-from-wire`, as the package names them. Every other record
        carries no mark at all, so it never matches either name.

        `outcome_name` (C-14) filters TOOL_RESULT records by the outcome the
        package names — `ok`, `error`, `timeout`, `cancelled`, `unobserved`
        (r6). No other record carries an outcome, so none matches.

        `record_hash` (C-09c) matches a record's own hash exactly — the
        package's `record_hash`, hex. It is how the anchor button finds the
        record a verified anchor names, and a head that names nothing in
        this file is an empty answer, never a fallback to the last record.

        `wall_from_ns` / `wall_to_ns` (C-09c) bound the writer's clock,
        from inclusive, to exclusive. They filter on a **Recorded** claim,
        and say nothing about proved order: where the writer's clock went
        backwards, the records inside a wall range need not be contiguous
        in the chain. The window is still drawn in proved order.

        `text` (C-09d, §22.3 decided: MVP) keeps records whose `detail`
        contains it — a literal substring, case-insensitive (`casefold`), no
        pattern language, so the same query finds the same records on every
        desk. A record with no detail never matches. An encrypted body cannot
        be searched: those records are counted in `unsearched` rather than
        silently left out, so "no matches" never hides "could not look".

        Body TLVs are reported as **type and length, not content**. Bodies
        may be encrypted, and a records list is a structural view; showing
        what is inside a record is C-06d's job (`DEVELOPMENT-PLAN.md`, §5)
        and needs its own decisions about keys and redaction.
        """
        window: list[dict[str, object]] = []
        matched = 0
        matched_at_or_past_offset = 0
        acks, shredded, detail_counts = self._safety_context()

        # One walk, as before, and since C-10b over the header index rather
        # than the decoded chain: only the rows returned are decoded. The
        # filters on a record's BODY — kind, source, outcome, its own hash —
        # cannot be read from a header, and 0.13 has no public way to read a
        # kind without decoding; those questions still decode every record
        # (`_records_by_body`), as all of them did before.
        if (
            kind_name is not None
            or source_name is not None
            or outcome_name is not None
            or record_hash is not None
            or text is not None
        ):
            return self._records_by_body(
                offset, limit, record_type, boot_id, span_id, type_name, kind_name,
                tier, source_name, outcome_name, record_hash, wall_from_ns, wall_to_ns,
                text,
            )
        idx = self._header_index()
        for i in range(len(idx)):
            if not self._header_matches(
                idx, i, record_type, boot_id, span_id, type_name, tier,
                wall_from_ns, wall_to_ns,
            ):
                continue
            matched += 1
            if idx.seq[i] < offset:
                continue
            matched_at_or_past_offset += 1
            if len(window) < limit:
                with self._lock:
                    record = self._reader.record_at(i)
                window.append(
                    self._record_view(record, self._prev_seq(i), acks, shredded, detail_counts)
                )

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

    def _header_matches(
        self,
        idx: _HeaderIndex,
        i: int,
        record_type: int | None,
        boot_id: str | None,
        span_id: str | None,
        type_name: str | None,
        tier: str | None,
        wall_from_ns: int | None,
        wall_to_ns: int | None,
    ) -> bool:
        """`_matches` for the filters a header answers, read off the index."""
        if record_type is not None and idx.rtype[i] != record_type:
            return False
        if type_name is not None and self._type_name_at(idx, i) != type_name:
            return False
        header_filters = (boot_id, span_id, tier, wall_from_ns, wall_to_ns)
        if all(f is None for f in header_filters):
            return True
        if not idx.ok[i]:
            # The full decode raised on such a record for these filters
            # (it has no header to read them from); not matching is the
            # nearest honest answer, and no such chain reaches a session
            # in practice — the package's own verifier reports it.
            return False
        if boot_id is not None and idx.boot_ids[idx.boot[i]].hex() != boot_id:
            return False
        if span_id is not None and _span_or_none(idx.span_ids[idx.span[i]]) != span_id:
            return False
        if tier is not None and assurance_tier_name(idx.tier[i]) != tier:
            return False
        wall = idx.wall[i]
        if wall_from_ns is not None and wall < wall_from_ns:
            return False
        if wall_to_ns is not None and wall >= wall_to_ns:
            return False
        return True

    def _records_by_body(
        self,
        offset: int,
        limit: int,
        record_type: int | None,
        boot_id: str | None,
        span_id: str | None,
        type_name: str | None,
        kind_name: str | None,
        tier: str | None,
        source_name: str | None,
        outcome_name: str | None,
        record_hash: str | None,
        wall_from_ns: int | None,
        wall_to_ns: int | None,
        text: str | None = None,
    ) -> dict[str, object]:
        """The window for a question about bodies: every record decoded.

        Unchanged from before C-10b, and as costly: a kind, a source mark,
        an outcome or a record's own hash is not in the header, and 0.13
        offers no public way to read one without the decode.
        """
        window: list[dict[str, object]] = []
        matched = 0
        matched_at_or_past_offset = 0
        unsearched = 0
        needle = None if text is None else text.casefold()
        acks, shredded, detail_counts = self._safety_context()
        with self._lock:
            records = list(self._reader.records())
        for record in records:
            if not self._matches(
                record, record_type, boot_id, span_id, type_name, kind_name, tier,
                source_name, outcome_name, record_hash, wall_from_ns, wall_to_ns,
            ):
                continue
            if needle is not None:
                if record.header.key_id != 0:
                    # Encrypted: its detail cannot be read, so it is neither a
                    # match nor a non-match. Counted, never silently dropped.
                    unsearched += 1
                    continue
                if record.detail is None or needle not in record.detail.casefold():
                    continue
            matched += 1
            if record.seq < offset:
                continue
            matched_at_or_past_offset += 1
            if len(window) < limit:
                prev = records[record.index - 1].seq if record.index > 0 else None
                window.append(self._record_view(record, prev, acks, shredded, detail_counts))
        return {
            "records": window,
            "offset": offset,
            "limit": limit,
            "total": matched,
            "has_more": matched_at_or_past_offset > len(window),
            "unsearched": None if text is None else unsearched,
        }

    @staticmethod
    def _matches(
        record,
        record_type: int | None,
        boot_id: str | None,
        span_id: str | None,
        type_name: str | None = None,
        kind_name: str | None = None,
        tier: str | None = None,
        source_name: str | None = None,
        outcome_name: str | None = None,
        record_hash: str | None = None,
        wall_from_ns: int | None = None,
        wall_to_ns: int | None = None,
    ) -> bool:
        """Whether a record passes the filters, all of which are ANDed."""
        if record_type is not None and record.record_type != record_type:
            return False
        if boot_id is not None and record.header.boot_id.hex() != boot_id:
            return False
        if span_id is not None and _span_or_none(record.header.span_id) != span_id:
            return False
        if type_name is not None and record.type_name != type_name:
            return False
        if kind_name is not None and record.kind_name != kind_name:
            return False
        if tier is not None and assurance_tier_name(record.header.assurance_tier) != tier:
            return False
        if source_name is not None and record.source_name != source_name:
            return False
        if outcome_name is not None and record.outcome_name != outcome_name:
            return False
        if record_hash is not None and record.record_hash.hex() != record_hash:
            return False
        wall = record.header.wall_clock_ns
        if wall_from_ns is not None and wall < wall_from_ns:
            return False
        if wall_to_ns is not None and wall >= wall_to_ns:
            return False
        return True

    def _record_view(
        self,
        record,
        prev_seq: int | None,
        acks: _AckContext,
        shredded: dict[int, int],
        detail_counts: Counter,
    ) -> dict[str, object]:
        """One record's header fields, as plain data.

        Shared by the window and the single-record view so the two cannot
        describe the same record differently — which they would, eventually,
        if each built its own dict.

        ``prev_seq`` is the seq of the record before this one in the file,
        resolved by the caller from the header index (C-10b) — see below
        for why it is that and never ``seq - 1``. ``acks``, ``shredded`` and ``detail_counts``
        are built once per caller from the package's own resolutions
        (U13/#236, U15, U12) and passed in rather than recomputed per
        record — see ``_ack_context`` for the one subtraction this side
        does on top of them.
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
            # is NO_SPAN. Rendering that as an identifier would put a
            # span called 00000000… on the screen and in reports.
            "span_id": _span_or_none(header.span_id),
            "parent_span_id": _span_or_none(header.parent_span_id),
            # The record's OWN CLAIM about its predecessor — unverified
            # here. Whether it actually matches the predecessor's hash is
            # what /verify establishes; this view reports the field
            # structurally, the same distinction /verify already draws
            # between "the chain links" and "this file's headers decode".
            "prev_hash": _hash_or_none(header.prev_hash),
            # This record's own hash (U10, released 0.11.0) — always
            # present, computed by the package over the header bytes
            # regardless of whether the header itself decoded.
            "record_hash": record.record_hash.hex(),
            # The seq to jump to for "the predecessor prev_hash names" —
            # NOT seq - 1. Confirmed by reading IncrementalVerifier.step()
            # directly: the hash-link check compares against the record
            # immediately before this one IN THE FILE (index - 1), and a
            # seq gap is a wholly separate check ("a gap in seq is a
            # break, whether or not the hashes link") — the two are
            # independent, and rotation/segments (0.11.0) mean a seq gap
            # with an intact hash chain is a real, not hypothetical, case.
            # Null at index 0: nothing in this file to jump to, whether
            # that is GENESIS's own zero prev_hash or a segment's first
            # record naming a predecessor outside this container.
            "prev_seq": prev_seq,
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
            # Only meaningful for an INCIDENT_CANDIDATE; None for every
            # other kind — "not acknowledged" and "not the kind of record
            # that gets acknowledged" are different facts, and collapsing
            # them to False would say something about a GENESIS record
            # that GENESIS never claimed.
            "acknowledged": (record.seq in acks.ack_of)
            if record.kind == KIND_INCIDENT_CANDIDATE
            else None,
            # Which ack — the package's own hash-verified resolution
            # (acknowledged_candidates(), a dict since 0.12.0, #236). An
            # ack whose reference does not verify is not here at all;
            # the advisory channel names it instead.
            "acknowledged_by": acks.ack_of.get(record.seq)
            if record.kind == KIND_INCIDENT_CANDIDATE
            else None,
            # The same resolution read backwards, on the ack itself: the
            # candidate it verifiably acknowledges, or None — including
            # for an ack whose reference is broken, which must not look
            # like it acknowledges anything.
            "acknowledges": acks.candidate_of.get(record.seq),
            # See _ack_context: the writer's clock, same boot only.
            "ack_latency_ns": acks.latency_ns.get(record.seq)
            if record.kind == KIND_INCIDENT_CANDIDATE
            else None,
            # The ack's own fields (U15, released 0.11.0), carried as the
            # package decoded them. Pseudonymous by design: 16 bytes the
            # writer chose, shown as hex, never resolved to a person here.
            "operator_id": None if record.operator_id is None else record.operator_id.hex(),
            "disposition": None
            if record.disposition is None
            else {"value": record.disposition, "name": record.disposition_name},
            # How the serving layer learned of a tool call or result
            # (EVT_SOURCE, profile r5; released 0.12.0) — the package's
            # value and name, passed through. Present on TOOL_CALL and
            # TOOL_RESULT only, where an absent tag already decodes as
            # parsed-from-wire: the package's own comment calls that "a
            # claim, not the absence of one", so it is carried as one.
            # None on every other record, where the mark has no meaning.
            # An unknown value keeps its number and a null name rather
            # than being guessed at.
            "source": None
            if record.source is None
            else {"value": record.source, "name": record.source_name},
            # EVT_OUTCOME on a TOOL_RESULT (r3; r6 adds 4, unobserved) — the
            # package's value and name, passed through the way source is.
            # None on every other record, and on a TOOL_RESULT missing the
            # tag. An unknown value keeps its number and a null name.
            # What `ok` does NOT mean (profile note 5) is the shell's to say,
            # and it says it on the card; this field carries only the value.
            "outcome": None
            if record.outcome is None
            else {"value": record.outcome, "name": record.outcome_name},
            # The seq of the KEY_SHRED that shredded this record, or None
            # if it was not (or is not itself shreddable — a KEY_SHRED's
            # own target_seqs can name any record, so no kind is excluded
            # structurally; None here just means "not currently shredded
            # by any resolving KEY_SHRED in this file").
            "shredded_by": shredded.get(record.seq),
            # EVT_DETAIL, decoded generically for any record type that
            # carries one (EVENT and SAFETY bodies — the same scope
            # `kind` already has). None when the record carries no
            # detail at all, not "" — the package's own distinction
            # (U12, released 0.11.0).
            "detail": record.detail,
            # What a SEGMENT_CONTINUATION declares (inference profile r6): the
            # package's own decode, null on every other record and on a
            # kind-11 record that is not well formed — the advisory channel
            # says so (continuation_malformed); this field never guesses.
            "continuation": self._continuation(record),
            # How many SAFETY records in this container carry this
            # exact detail text, this one included — F8's own framing
            # ("detail text and a recurrence count for identical
            # details"), so scoped to SAFETY the way `acknowledged` is
            # scoped to INCIDENT_CANDIDATE: None for a non-SAFETY
            # record (not applicable) and for a SAFETY record with no
            # detail (nothing to count), never 0 — a detail that
            # exists recurs at least once, itself.
            "recurrence_count": (
                detail_counts[record.detail]
                if record.record_type == RT_SAFETY and record.detail is not None
                else None
            ),
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

        idx = self._header_index()
        # The records a position exists for on this axis: every record on
        # the seq axis, every record with a decoded header on the wall axis
        # (the full decode raised on any other; the index skips it).
        members = [i for i in range(len(idx)) if axis == "seq" or idx.ok[i]]
        if not members:
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

        positions = idx.seq if axis == "seq" else idx.wall
        lo = min(positions[i] for i in members)
        hi = max(positions[i] for i in members)

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
        for i in members:
            index = min(used - 1, (positions[i] - lo) // width)
            bucket = counted[index]
            bucket["count"] = int(bucket["count"]) + 1
            name = self._type_name_at(idx, i)
            if name == "SAFETY":
                bucket["safety"] = int(bucket["safety"]) + 1
            elif name == "ANCHOR":
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
        if stepped_seqs:
            for i in members:
                if idx.seq[i] in stepped_seqs:
                    index = min(used - 1, (positions[i] - lo) // width)
                    counted[index]["stepped"] = True
        for bucket in counted:
            bucket.setdefault("stepped", False)

        with self._lock:
            boots = self._reader.boots()
        boundaries = []
        for boot in boots:
            # The last record carrying each seq — the one `{r.seq: r}` kept.
            first = idx.last_index_of(boot.first_seq)
            last = idx.last_index_of(boot.last_seq)
            if first is None or last is None:
                continue
            boundaries.append(
                {
                    "boot_id": boot.boot_id.hex(),
                    "first_seq": boot.first_seq,
                    "last_seq": boot.last_seq,
                    "first_wall_ns": idx.wall[first],
                    "last_wall_ns": idx.wall[last],
                }
            )

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
            "wall_follows_seq": idx.walls_follow_seq(),
            "time_trust_values": self._named(
                {idx.trust[i] for i in range(len(idx)) if idx.ok[i]}, time_trust_name
            ),
            "steps": steps,
        }

    def nearest(self, wall_ns: int) -> dict[str, object] | None:
        """The record whose writer's clock is nearest to an instant (C-09c).

        **This answers a question about the writer's clock, and says so.**
        "Nearest to 22:41" is decided entirely by `wall_clock_ns`, a
        Recorded claim. Nothing here can say the record *happened* nearest
        to 22:41 — only that the writer's clock said so. The response
        carries what qualifies that:

        * `time_trust` of the record found — the writer's own status for
          that clock at that moment;
        * `wall_follows_seq` — whether the writer's clock is monotonic
          along proved order across the whole file. When it is not, two
          records far apart in the chain can sit near each other in wall
          time, and "the nearest" is a statement about the clock, not about
          where in the history to look;
        * `boot_clock_stepped` — whether the package's own step catalogue
          reports a step in that record's boot; a stepped clock measures
          two different clocks inside one boot;
        * `equally_near` — how many *other* records sit at exactly the
          same distance. Ties resolve to the lowest seq, deterministically,
          and the count is carried so the choice is visible rather than
          silent.

        `delta_ns` is signed: negative means the record's clock reads
        before the instant asked about.

        None for a container with no records — which `open_chain` already
        refuses, so it is unreachable through a session; kept as an answer
        rather than an exception for the same reason `timeline()` does.
        """
        idx = self._header_index()
        members = [i for i in range(len(idx)) if idx.ok[i]]
        if not members:
            return None

        wall, seq = idx.wall, idx.seq
        best = min(members, key=lambda i: (abs(wall[i] - wall_ns), seq[i]))
        best_distance = abs(wall[best] - wall_ns)
        equally_near = sum(1 for i in members if abs(wall[i] - wall_ns) == best_distance) - 1

        with self._lock:
            stepped_boots = {step.boot_id for step in step_catalog(self._reader)}

        return {
            "seq": seq[best],
            "wall_clock_ns": wall[best],
            "asked_ns": wall_ns,
            "delta_ns": wall[best] - wall_ns,
            "basis": "recorded",
            "time_trust": self._named({idx.trust[best]}, time_trust_name)[0],
            "wall_follows_seq": idx.walls_follow_seq(),
            "boot_clock_stepped": idx.boot_ids[idx.boot[best]] in stepped_boots,
            "equally_near": equally_near,
        }

    def origin(self, seq: int) -> dict[str, object]:
        """What was running when a record was written — three states,
        not the two `origin_at()` alone can tell apart.

        `origin_at()` returns `None` for two different facts: nothing
        before the first MODEL_LOAD has an origin, because none had
        been declared; and a MODEL_UNLOAD explicitly ends one, which
        also leaves the running state at `None`. F9 asks for different
        wording for each ("not stated in this file" versus "no model
        active"), and until now nothing on this side of the seam could
        tell them apart without re-walking records for the last unload
        ourselves — the second-implementation mistake ADR-0001 exists
        to rule out.

        `unloaded_at()` (U11, released 0.11.0) is the package's own
        answer: whether the last EVENT that set origin state at or
        before `seq` was a MODEL_UNLOAD, additive to `origin_at()`
        rather than a change to it. `state` is `"active"` when
        `origin_at()` answered, `"unloaded"` when it did not and
        `unloaded_at()` says the last word was an unload, `"not_stated"`
        otherwise — nothing ever declared.

        `since_seq` is the record that declared the active origin, so a
        reader can jump to the declaration rather than take this on
        trust — the same reason every other claim here names its source.

        One call into the package: `origin_state_at()` (0.13) answers both
        halves from one walk, and since 0.13 that walk is bounded — the
        package keeps an index of the records that set origin state, so a
        question costs a binary search and at most one decode (U23).
        """
        with self._lock:
            state = self._reader.origin_state_at(seq)
        view, unloaded = state.origin, state.unloaded
        if view is not None:
            return {
                "state": "active",
                "origin": {
                    "role": view.role,
                    "model_digest": view.model_digest.hex(),
                    "config_digest": view.config_digest.hex(),
                    "since_seq": view.since_seq,
                    "detail": view.detail,
                },
            }
        return {"state": "unloaded" if unloaded else "not_stated", "origin": None}

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

        Acknowledged state (an `INCIDENT_CANDIDATE`'s `acknowledged`),
        shred resolution (any record's `shredded_by`) and detail text
        with its recurrence count (`detail`, `recurrence_count`) are
        all on `_record_view` now (U13, U15, U12, all released
        0.11.0) — the same discipline `records()` and `record()` keep,
        since this view is a filtered read of the same thing, not a
        second one.

        **The oversight loop in full (C-07c).** A candidate says whether
        it is acknowledged, by which ack, and — within one boot — how long
        after, by the writer's clock; the ack says which candidate it
        verifiably acknowledges, its pseudonymous operator and its
        disposition. All of it is the package's resolution
        (`acknowledged_candidates()`, 0.12.0) and the package's decode
        (`operator_id`, `disposition`, 0.11.0), read through here.

        The response has the exact shape of `records()`'s window, reused
        rather than given a shape of its own: `total` counts SAFETY
        records that exist past the count returned, the same distinction
        `records()` already draws between "matched" and "in the file".
        """
        window: list[dict[str, object]] = []
        total = 0
        acks, shredded, detail_counts = self._safety_context()
        # The package's own SAFETY-only read (0.12): no other record decoded.
        with self._lock:
            records = list(self._reader.safety_records())
        for record in records:
            total += 1
            if len(window) < limit:
                window.append(
                    self._record_view(
                        record, self._prev_seq(record.index), acks, shredded, detail_counts
                    )
                )
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
        idx = self._header_index()
        with self._lock:
            boots = self._reader.boots()
            spans = self._reader.spans()
        decoded = [i for i in range(len(idx)) if idx.ok[i]]
        return {
            "records": len(idx),
            "first_seq": min(idx.seq) if len(idx) else None,
            "last_seq": max(idx.seq) if len(idx) else None,
            "boots": len(boots),
            "spans": len(spans),
            # Every tier and time-trust value the chain carries, not just the
            # last one. A chain whose records were written under different
            # platform guarantees is a chain whose verdict wording cannot be
            # one sentence, and picking one value would decide that silently.
            "assurance_tiers": self._named({idx.tier[i] for i in decoded}, assurance_tier_name),
            "time_trust_values": self._named({idx.trust[i] for i in decoded}, time_trust_name),
        }

    def _ack_context(self, acknowledged: dict[int, int]) -> _AckContext:
        """The oversight loop, resolved once per caller (C-07c).

        ``acknowledged`` is the package's own ``candidate_seq → ack_seq``
        mapping, hash-verified (0.12.0, Palimpsests#236). Nothing here
        re-resolves a reference; this only reads that mapping both ways
        and does the one subtraction the package deliberately leaves to
        its consumer (U15's own row: "an Auditor-side subtraction").

        **Latency is the writer's clock, and only within one boot.**
        ``wall(ack) − wall(candidate)`` is two Recorded claims subtracted,
        so it is at most as good as the clock that wrote them. Across a
        boot boundary it is worse than that: the machine restarted in
        between, the clock may have been set, and a number would silently
        span a period nobody observed — the same reason the Chronoscope
        removes its ruler inside a wall gap. So a cross-boot pair gets no
        latency at all, and ``acknowledged_by`` non-null with
        ``ack_latency_ns`` null says exactly that.
        """
        idx = self._header_index() if acknowledged else None
        latency: dict[int, int] = {}
        for candidate_seq, ack_seq in acknowledged.items():
            # The last record carrying each seq — what `{r.seq: r}` picked.
            candidate = idx.last_index_of(candidate_seq)
            ack = idx.last_index_of(ack_seq)
            if candidate is None or ack is None:
                continue
            if idx.boot[candidate] != idx.boot[ack]:
                continue
            latency[candidate_seq] = idx.wall[ack] - idx.wall[candidate]
        return _AckContext(
            ack_of=dict(acknowledged),
            candidate_of={ack: cand for cand, ack in acknowledged.items()},
            latency_ns=latency,
        )

    @staticmethod
    def _continuation(record) -> dict[str, object] | None:
        view = decode_continuation(record)
        if view is None:
            return None
        return {
            "segment_index": view.segment_index,
            "predecessor_head": view.predecessor_head.hex(),
            "retention_s": view.retention_s,
            "prior_root": view.prior_root.hex(),
        }

    @staticmethod
    def _detail_counts(records: list) -> Counter:
        """How many times each detail text recurs among SAFETY records.

        Built once per caller from the already-decoded list, the same
        pattern ``acknowledged``/``shredded`` already follow — a `Counter`
        over `record.detail` for every SAFETY record that carries one,
        skipping every other record type (a detail on an EVENT record,
        for instance, is a different fact and not part of what F8 asks
        this count to answer).
        """
        return Counter(
            r.detail
            for r in records
            if r.record_type == RT_SAFETY and r.detail is not None
        )

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

    # The package's own count from its walk (0.13, U16): no record decoded.
    # Was `any(reader.records())`, which decoded the whole chain to learn
    # that it was not empty — 21.6 s and 2.0 GB at 1M records (C-10b).
    if reader.record_count == 0:
        reader.close()
        raise NotAChain("the file holds no PALA-1 records")

    return ChainHandle(reader, path)
