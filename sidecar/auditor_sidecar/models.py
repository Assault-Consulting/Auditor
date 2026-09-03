# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Response models.

Every endpoint declares one. That is not ceremony: the OpenAPI schema is
generated from these classes, and the frontend's TypeScript types are
generated from that schema, so an endpoint returning a bare ``dict`` produces
an untyped hole on the other side of the bridge — exactly where a missing
field would be least visible.

Field descriptions live here too, because they become the documentation the
generated client carries.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    """Liveness, and the identity of the verifier behind this service.

    The verifier identity is part of the liveness answer rather than a
    separate endpoint because a verification result is only meaningful
    alongside the verifier that produced it. A shell that knows the service is
    up but not what it is linked against knows less than it needs.
    """

    status: str = Field(description="'ok' when the service is serving.")
    version: str = Field(description="Version of this sidecar.")
    package: str = Field(
        description="The verifier package and version, e.g. 'palimpsests 0.8.0'."
    )
    spec: str = Field(
        description="The wire format the linked verifier implements, "
        "e.g. 'PALA-1 format_version 1'."
    )
    authenticated: bool = Field(
        description=(
            "Whether the session token gate is enforced. False means the "
            "sidecar was started without a token and any local process can "
            "reach it — a development affordance, never a supported "
            "configuration."
        )
    )


class NamedValue(BaseModel):
    """A header enum value, with the package's name for it.

    Both halves travel. The name is what a person reads; the number is what
    survives a name table changing and what can be checked against the
    specification. `name` is null when this verifier build has no name for
    the value — which is a real answer, and better than a label invented to
    fill the gap.
    """

    value: int = Field(description="The raw header value.")
    name: str | None = Field(
        description="The package's name, or null if this build does not know it."
    )


class ChainSubject(BaseModel):
    """What the container *is*, stated before any verdict about it.

    Separate from the verification result on purpose: a reader of a report
    must be able to confirm they are holding the same artifact the check ran
    against, independently of whether that check passed.
    """

    filename: str = Field(description="The file's name, for display only.")
    path: str = Field(description="Absolute path as opened.")
    bytes: int = Field(description="File size on disk, in bytes.")
    sha256: str = Field(
        description=(
            "SHA-256 of the file as opened. Identifies the artifact; a report "
            "naming only a filename identifies nothing."
        )
    )
    records: int = Field(description="Number of records the reader found.")
    first_seq: int | None = Field(description="Lowest sequence number present.")
    last_seq: int | None = Field(description="Highest sequence number present.")
    boots: int = Field(description="Distinct boot identifiers present.")
    spans: int = Field(description="Distinct spans present.")
    assurance_tiers: list[NamedValue] = Field(
        description=(
            "Every assurance tier the chain's records carry, not just the "
            "latest. More than one means the platform guarantee changed "
            "mid-chain, and the verdict wording cannot then be a single "
            "sentence — so the set is reported rather than reduced."
        )
    )
    time_trust_values: list[NamedValue] = Field(
        description=(
            "Every wall-clock trust level the chain's records carry. More "
            "than one means the writer's clock changed status mid-chain, "
            "which qualifies every wall-time claim in the file."
        )
    )


class SessionResponse(BaseModel):
    """A session over one open container."""

    session_id: str = Field(description="Opaque handle for subsequent calls.")
    subject: ChainSubject = Field(description="What this session is about.")
    verifier: dict[str, str] = Field(
        description=(
            "The verifier package and wire format behind this session. Carried "
            "on the session rather than fetched separately, because a result is "
            "only meaningful alongside the verifier that produced it."
        )
    )


class SessionRequest(BaseModel):
    """Open a container."""

    path: str = Field(description="Absolute path to a .pala container.")


class ChainResult(BaseModel):
    """Question one, first half: do these records link to each other?

    Always answerable. It needs no key and no anchor — only the bytes in
    front of it — which is why it is the one question a chain can never
    decline to answer.

    **It is a header walk.** Whether each record still *is* the bytes its
    header claims is a separate question, answered by
    :class:`ContainerCheck`. A consumer that renders `chain_ok` alone will
    show a sound file when a body has been swapped.
    """

    chain_ok: bool = Field(
        description=(
            "Whether every record header links to its predecessor. Headers "
            "only — see ContainerCheck.body_digest_mismatches for whether "
            "the bodies still match their digests."
        )
    )
    count: int = Field(description="Records the verifier walked.")
    head: str = Field(description="Hex digest of the last record in the chain.")
    breaks: list[int] = Field(
        description="Sequence numbers where prev_hash does not name the predecessor."
    )
    gaps: list[int] = Field(
        description=(
            "Skipped sequence numbers. A gap is a break whether or not the "
            "hashes on either side happen to link."
        )
    )
    violations: list[list] = Field(
        description=(
            "(seq, reason) pairs for normative MUSTs the record broke. Kept "
            "as pairs: a seq without its reason is a number nobody can act on."
        )
    )
    uninterpretable: list[int] = Field(
        description=(
            "Records with an unknown format version or record type. "
            "Chain-checked and reported, never rejected — the verifier not "
            "understanding a record is not the same as the record being wrong."
        )
    )


class ContainerCheck(BaseModel):
    """Whether each record is the bytes its own header claims.

    A different question from the one `ChainResult` answers. The chain is
    about how records link to each other; this is about whether a record's
    body still hashes to the `body_digest` its header carries.

    `AuditReader.verify()` does not perform this comparison — that is by
    design, and it is why verification needs no keys. The walk comes from the
    package's report builder, so the shell never decides what a body digest
    means.
    """

    well_formed: bool = Field(
        description="Whether the container parsed end to end as PALA-1."
    )
    malformed: str | None = Field(
        description="The parser's sentence, when it could not finish."
    )
    bytes_parsed: int = Field(description="Bytes the parser consumed.")
    bytes_total: int = Field(description="Bytes in the file.")
    body_digest_mismatches: list[int] = Field(
        description=(
            "Sequence numbers whose body does not hash to the digest their "
            "header carries. NON-EMPTY MEANS THE HEADER CHAIN CAN STILL BE "
            "INTACT — a swapped body leaves every link verifying, so a "
            "consumer that renders chain_ok alone would show a sound file. "
            "The answer to 'is what I hold internally consistent?' requires "
            "this list to be empty as well."
        )
    )


class Completeness(BaseModel):
    """Question two: is what I hold all of it?

    The only question that can go unasked, and the answer must say so.
    """

    complete_to_anchor: bool | None = Field(
        description=(
            "True, False, or null. Null means NO ANCHOR ANSWERED — either none "
            "was configured, or every source in the profile was absent — so "
            "the question was never asked. It is not a pass and must never be "
            "rendered as one."
        )
    )
    anchor_lag: int | None = Field(
        description="Records present beyond the anchored head, when there are any."
    )
    anchor_reason: str | None = Field(
        description="The verifier's sentence explaining an incomplete answer."
    )


class DiagnosisModel(BaseModel):
    """What the failure looks like, rather than that there was one.

    The pattern is the machine-readable part and a consumer may key visuals
    off it. The narrative is the package's own sentence, carried verbatim:
    a shell may show a localised sentence beside it, never instead of it, or
    the report stops saying what the verifier said.
    """

    pattern: str = Field(
        description=(
            "One of: truncated_tail, prefix_absent, seq_gap, chain_break, "
            "record_violation, unanchored_tail, replaced_or_rolled_back."
        )
    )
    at_seq: int | None = Field(description="Where, when the pattern has a location.")
    expected: str | None = Field(description="What the verifier expected to find.")
    narrative: str = Field(description="The verifier's own description, verbatim.")


class AdvisoryItemModel(BaseModel):
    """One thing worth a human's attention that changes no verdict."""

    code: str = Field(description="Stable key, e.g. mono_regression_in_boot.")
    at_seq: int | None = Field(description="Where, when the item has a location.")
    boot_id: str | None = Field(description="Hex boot identifier, when scoped to one.")
    detail: str | None = Field(description="The package's description of this item.")


class AdvisoryModel(BaseModel):
    """The advisory channel, carried apart from the verdict on purpose."""

    count: int = Field(description="How many items.")
    items: list[AdvisoryItemModel] = Field(description="The items themselves.")
    note: str = Field(
        default="advisory items do not affect the verdict",
        description=(
            "Carried in the payload rather than left to the UI. A consumer "
            "that receives advisory items beside chain_ok will eventually "
            "treat them as part of it."
        ),
    )


class AnchorSourceSpec(BaseModel):
    """One place a trusted head might live.

    The shell owns the concrete sources; the package owns what a head means
    (L2). A spec is therefore plain data — no package type appears in a
    request model.
    """

    kind: str = Field(description="'manual', 'file' or 'keychain'.")
    head: str | None = Field(
        default=None,
        description="For kind='manual': the 64-character hex head, as handed over.",
    )
    path: str | None = Field(
        default=None,
        description="For kind='file': path to a FileAnchor head file.",
    )
    account: str | None = Field(
        default=None,
        description=(
            "For kind='keychain': the account name the head is stored under. "
            "The service name is fixed by the application, so this is the "
            "only part an operator chooses."
        ),
    )
    detail: str = Field(
        default="",
        description="Free text shown beside this source in the provenance view.",
    )

    @field_validator("head")
    @classmethod
    def _head_is_a_head(cls, v: str | None) -> str | None:
        """Validated at entry, not at use.

        A head pasted with a typo must be refused where it is pasted. Carried
        further, it becomes an anchor that names no record in the chain — which
        the verifier reports as `replaced_or_rolled_back`, the single most
        alarming diagnosis this tool can produce. Sending someone to
        investigate a replaced log because they mistyped a character is a
        failure of this application, not of theirs.
        """
        if v is None:
            return v
        cleaned = v.strip().lower()
        if len(cleaned) != 64 or any(c not in "0123456789abcdef" for c in cleaned):
            raise ValueError("a head is 64 hexadecimal characters")
        return cleaned


class AnchorProfile(BaseModel):
    """An ordered list of places to look for a trusted head.

    Order is meaningful and is the user's: the first source that answers wins,
    and the ones before it are reported as tried. That is why resolution is
    availability-first — a source that errors does not stop the walk — and why
    the provenance view has to show what was skipped rather than only what
    answered.
    """

    name: str = Field(description="Profile name, used as the verify parameter.")
    sources: list[AnchorSourceSpec] = Field(
        description="Tried in order; the first that answers is used."
    )


class AnchorAttemptModel(BaseModel):
    """One source that was consulted, and what came back."""

    source_kind: str = Field(description="'manual', 'file' or 'keychain'.")
    source_detail: str = Field(description="Which one — a path, or free text.")
    outcome: str = Field(
        description=(
            "'answered', 'absent' or 'error'. Three states, never two: absent "
            "is normal, error is a source that exists and could not be read, "
            "and merging them would hide a corrupt anchor file behind 'no "
            "anchor configured'."
        )
    )
    error: str | None = Field(description="Why, when the outcome is 'error'.")


class AnchorReadingModel(BaseModel):
    """The head that answered, and where it came from."""

    source_kind: str = Field(description="Which kind of source answered.")
    source_detail: str = Field(description="Which particular one.")
    observed_at_ns: int | None = Field(description="When the source was read.")
    head: str = Field(description="The hex head this check was made against.")


class VerificationResponse(BaseModel):
    """The verifier's answer, passed through rather than summarised.

    There is deliberately no single "valid" field. The three questions have
    three separate answers, one of which can be "not asked", and any field
    that collapsed them would be the shell deciding what a verdict means.
    """

    session_id: str = Field(description="The session this answer is about.")
    subject_sha256: str = Field(
        description=(
            "Digest of the file this answer describes. Repeated here so a "
            "verification result cannot be separated from its subject."
        )
    )
    verifier: dict[str, str] = Field(description="Package and wire format behind it.")
    chain: ChainResult
    container: ContainerCheck = Field(
        description=(
            "The body-digest walk. Required rather than optional: a response "
            "that could omit it would let a consumer answer question one "
            "from the header chain alone."
        )
    )
    completeness: Completeness
    anchor: AnchorReadingModel | None = Field(
        description=(
            "The source that answered, or null when none did. A completeness "
            "answer is worth exactly as much as the anchor behind it, so the "
            "two are never separated."
        )
    )
    anchor_attempts: list[AnchorAttemptModel] = Field(
        description=(
            "Every source consulted, in order, including those that were "
            "absent or failed. The answering source alone would let a UI "
            "present it as 'the' anchor while silently skipping a source the "
            "operator believed was authoritative."
        )
    )
    diagnosis: DiagnosisModel | None = Field(
        description="Present only when something failed."
    )
    advisory: AdvisoryModel


class AnchorCadenceModel(BaseModel):
    """How often this boot anchored its head.

    The widest gap is the useful figure: it is how long the chain went
    without an external witness, and therefore how wide an "existed by"
    bracket would be for records inside it.
    """

    count: int = Field(description="Anchor records written during this boot.")
    widest_gap_ns: int | None = Field(
        description="Longest interval between anchors, in nanoseconds."
    )


class SpanStatsModel(BaseModel):
    """Spans opened during this boot, and how many were left open."""

    closed: int = Field(description="Spans that have an end record.")
    open: int = Field(
        description=(
            "Spans opened and never closed. Evidence of an interrupted "
            "operation, not a defect in the log."
        )
    )
    open_rate: float | None = Field(
        description="Open spans as a fraction, or null when there were no spans."
    )
    median_duration_ns: int | None = Field(
        description="Median closed-span duration, or null when none closed."
    )


class BootView(BaseModel):
    """One boot, with the statistics the package computes for it.

    A boot is the unit that matters for reading time: `monotonic_ns` resets
    across a boundary, so no duration spans one.
    """

    boot_id: str = Field(description="Hex boot identifier.")
    first_seq: int = Field(description="First record in this boot.")
    last_seq: int = Field(description="Last record in this boot.")
    record_count: int = Field(description="Records written during it.")
    time_trust_values: list[NamedValue] = Field(
        description=(
            "Every wall-clock trust level seen inside this boot. More than "
            "one means the clock changed status mid-boot, which qualifies "
            "every wall-time claim in it — so the set is carried rather than "
            "reduced to the latest."
        )
    )
    recovery_seq: int | None = Field(
        description=(
            "Where this boot recovered a truncated tail, when it did. Null "
            "is the ordinary case rather than a missing value."
        )
    )
    uptime_ns: int | None = Field(
        description="Monotonic span of this boot, computed by the package."
    )
    anchors: AnchorCadenceModel
    spans: SpanStatsModel


class SpanView(BaseModel):
    """One span, and the records it covers."""

    span_id: str = Field(description="Hex span identifier.")
    parent_span_id: str | None = Field(
        description="The enclosing span, or null at the top level."
    )
    start_seq: int | None = Field(
        description="The SPAN_START record, or null when it is not in this file."
    )
    end_seq: int | None = Field(
        description=(
            "The SPAN_END record, or NULL FOR A SPAN NEVER CLOSED. Null is "
            "first-class evidence — an interrupted operation looks exactly "
            "like this — and must never be filled in with the last record "
            "seen."
        )
    )
    record_count: int = Field(description="Records carrying this span id.")
    record_seqs: list[int] = Field(description="Their sequence numbers.")


class RecordView(BaseModel):
    """One record, as structure rather than as content.

    Header fields and the shape of the body. What is *inside* a record is a
    separate view with its own decisions about keys and redaction.
    """

    seq: int = Field(description="Sequence number.")
    index: int = Field(
        description=(
            "Position of this record within THIS FILE, zero-based. Distinct "
            "from seq, which a rotated or segmented chain does not start at "
            "zero and does not number contiguously across a gap — index "
            "always does, because it counts what this file actually holds."
        )
    )
    record_type: int = Field(description="Raw record type.")
    type_name: str | None = Field(
        description="The package's name for the type, or null if unknown to this build."
    )
    kind: int | None = Field(description="Raw kind, for types that carry one.")
    kind_name: str | None = Field(
        description=(
            "The package's name for the kind. Null where the record type "
            "has no kind at all — GENESIS, BOOT and ANCHOR do not — which "
            "is not the same as a kind this build cannot name."
        )
    )
    boot_id: str = Field(description="Hex boot identifier.")
    span_id: str | None = Field(
        description=(
            "Hex span identifier, or null when the record is in no span. "
            "PALA-1 spells that as sixteen zero bytes; this field reports "
            "null rather than a span named 00000000…"
        )
    )
    parent_span_id: str | None = Field(description="The enclosing span, when there is one.")
    prev_hash: str | None = Field(
        description=(
            "Hex hash of the predecessor's header, or null for a record "
            "declaring it has none. PALA-1 spells 'no predecessor' as "
            "thirty-two zero bytes — the GENESIS convention (§4.2: 'no "
            "predecessor' and 'predecessor removed' must be "
            "distinguishable, which is the entire reason GENESIS is a "
            "type) — so this field reports null rather than a hash of "
            "all zeros, the same choice span_id already makes for 'no "
            "span'. This is the record's OWN CLAIM about its predecessor, "
            "unverified here: whether it actually matches the "
            "predecessor's hash is a chain-link fact, not a structural "
            "one, and belongs to /verify, not to this view."
        )
    )
    record_hash: str = Field(
        description=(
            "This record's own hex hash (U10, palimpsests 0.11.0) — the "
            "SHA-256 the package computes over the header bytes. Always "
            "present, even for a record whose header did not otherwise "
            "decode: the hash is over the raw bytes, which the chain "
            "check hashes regardless of whether this view could read "
            "their fields."
        )
    )
    prev_seq: int | None = Field(
        description=(
            "The seq of the record prev_hash names, or null when there "
            "is none in this file. NOT seq - 1: the hash chain links by "
            "position in this container (the record immediately before "
            "this one), never by seq value, and a seq gap is a wholly "
            "independent fact — a rotated or segmented chain can have "
            "both at once. Null at the first record in this file, "
            "whether that is GENESIS's own declared zero predecessor or "
            "a segment's first record naming a predecessor outside this "
            "container: either way, nothing here to jump to."
        )
    )
    wall_clock_ns: int = Field(
        description="The writer's wall clock. A Recorded claim, qualified by time_trust."
    )
    monotonic_ns: int = Field(
        description="Monotonic clock. Comparable only within one boot."
    )
    assurance_tier: NamedValue
    time_trust: NamedValue
    body_len: int = Field(description="Body length in bytes.")
    body_tlv_types: list[int] | None = Field(
        description=(
            "TLV types present in the body, or null when this view has none "
            "to show — a record type with no body, an encrypted body, or one "
            "this build cannot parse. Distinct from [], which would mean a "
            "decoded body containing nothing."
        )
    )
    key_id: int | None = Field(
        description="Encryption key identifier, or null when the body is not encrypted."
    )


class RecordPage(BaseModel):
    """A window onto the records.

    Paginated because a chain has no bound: a container from a busy
    deployment can hold millions of records, and an endpoint that serialised
    all of them would fail in the situation where the tool is most needed.
    """

    records: list[RecordView]
    offset: int = Field(description="First sequence number this window could include.")
    limit: int = Field(description="Most records this window would return.")
    total: int = Field(
        description=(
            "Records that MATCHED THE FILTERS, not records in the file. With "
            "no filters the two are the same, which is why this field could "
            "quietly say the wrong thing once filters existed: a total "
            "counting everything would print '3 of 40000' above three rows "
            "that are the only three there are."
        )
    )
    has_more: bool = Field(
        description=(
            "Whether records remain past this window. Stated rather than "
            "left to be inferred from len(records) == limit, which is "
            "ambiguous when a window ends exactly on the last record."
        )
    )


class OriginModel(BaseModel):
    """What was running when a record was written.

    Every field is a **Recorded** claim: the writer declared it, and nothing
    in the chain proves the process was actually running that model. The
    digests let a reader compare against an artifact they hold; they do not
    establish what produced the records.
    """

    role: str = Field(description="The declared role, e.g. 'engine.native'.")
    model_digest: str = Field(
        description="Hex digest of the model as the writer declared it."
    )
    config_digest: str = Field(
        description="Hex digest of the configuration as the writer declared it."
    )
    since_seq: int = Field(
        description=(
            "The record that declared this origin. A reader can jump to it "
            "and see the declaration rather than take this on trust — the "
            "same reason every other claim here names its source."
        )
    )
    detail: str | None = Field(
        description="Free text the writer attached, when it attached any."
    )


class TimelineBucket(BaseModel):
    """One interval of the axis, and what fell inside it.

    Present even when empty. An empty stretch is a fact about the chain —
    the quiet week, the gap between boots — and a series that omitted empty
    buckets would draw a dense chain out of a sparse one.
    """

    start: int = Field(description="First position in this bucket, inclusive.")
    end: int = Field(description="Last position in this bucket, inclusive.")
    count: int = Field(description="Records in it.")
    safety: int = Field(description="How many of them are SAFETY records.")
    anchor: int = Field(description="How many of them are ANCHOR records.")
    stepped: bool = Field(
        description=(
            "Whether the writer's clock stepped inside this bucket. On the "
            "wall axis a stepped bucket is measuring two different clocks, "
            "so its width means nothing — a UI must mark it rather than draw "
            "it like the others."
        )
    )


class BootBoundary(BaseModel):
    """Where one boot begins and ends, on both axes.

    Rendered as an axis break rather than a seam (§C-03). `monotonic_ns`
    resets across a boot, so no duration spans one — and nothing in this
    payload computes one that does.
    """

    boot_id: str = Field(description="Hex boot identifier.")
    first_seq: int = Field(description="First record of this boot.")
    last_seq: int = Field(description="Last record of this boot.")
    first_wall_ns: int = Field(description="Wall clock at its first record.")
    last_wall_ns: int = Field(description="Wall clock at its last record.")


class WallGap(BaseModel):
    """The wall-clock distance between one boot's end and the next one's start.

    Reported with both ends so a consumer can hatch the interval and **remove
    the ruler inside it**: the clock is unverifiable while the system is
    down, which is a statement about the gap rather than about the records
    on either side.
    """

    after_boot_id: str = Field(description="The boot that ended.")
    before_boot_id: str = Field(description="The boot that started.")
    from_wall_ns: int = Field(description="Wall clock at the earlier boot's last record.")
    to_wall_ns: int = Field(description="Wall clock at the later boot's first record.")
    duration_ns: int = Field(
        description=(
            "to_wall_ns minus from_wall_ns. CAN BE NEGATIVE — that means the "
            "writer's clock moved backwards across the boundary, which the "
            "ruler cannot represent and a UI must not hide."
        )
    )


class TimeStepModel(BaseModel):
    """A step in the writer's clock, as the package detected it."""

    seq: int = Field(description="Where the step was detected.")
    kind: str = Field(description="The package's name for the kind of step.")
    delta_ns: int = Field(description="How far the clock moved.")
    boot_id: str = Field(description="Which boot it happened in.")


class Timeline(BaseModel):
    """Record density along one axis, and what breaks the ruler.

    **Two axes, and they are not interchangeable (L3).** `seq` is proved
    order: the hash chain establishes it and nothing can reorder it. `wall`
    is the writer's clock — a recorded claim, qualified by `time_trust`.
    """

    axis: str = Field(description="'seq' or 'wall'.")
    align: str | None = Field(
        description=(
            "Null for uniform buckets, 'day' when each bucket is one UTC "
            "calendar day. A CONSUMER RENDERING DATES MUST CHECK THIS: a "
            "date printed from a uniform bucket's start is a date the "
            "records inside it may not have happened on, because such a "
            "bucket straddles midnight."
        )
    )
    basis: str = Field(
        description=(
            "'proved' for the seq axis, 'recorded' for the wall axis. "
            "Carried as its own field rather than left to be derived from "
            "`axis`, so a consumer cannot label a wall chart 'proved' by "
            "reading the wrong one."
        )
    )
    buckets: list[TimelineBucket] = Field(
        description=(
            "Equal-width intervals covering the range, empty ones included. "
            "How many there are depends on `align`: without it the range is "
            "divided into at most the number requested; with 'day' each is "
            "one calendar day and the count is however many days the chain "
            "spans."
        )
    )
    start: int | None = Field(
        description=(
            "Where the first bucket begins. Equal to the lowest position on "
            "this axis for uniform buckets, and THE UTC MIDNIGHT AT OR "
            "BEFORE IT when align='day' — the first day is a whole day even "
            "when the chain starts in the middle of one."
        )
    )
    end: int | None = Field(description="Highest position on this axis.")
    boot_boundaries: list[BootBoundary] = Field(
        description="Reported apart from the series, because they are axis breaks."
    )
    wall_gaps: list[WallGap] = Field(
        description="The intervals between boots, where the ruler does not apply."
    )
    wall_follows_seq: bool = Field(
        description=(
            "Whether wall_clock_ns is non-decreasing along proved order. "
            "FALSE MEANS THE WALL AXIS REORDERS RECORDS relative to the "
            "chain, and a UI showing that axis must say so."
        )
    )
    time_trust_values: list[NamedValue] = Field(
        description=(
            "Every clock-trust level the records carry. The watermark for a "
            "wall-time view: it says whose clock this is, and how much the "
            "writer claimed for it."
        )
    )
    steps: list[TimeStepModel] = Field(
        description="Clock steps the package detected, with where and how far."
    )


class KeychainStatus(BaseModel):
    """Whether this machine has a usable secret store at all."""

    available: bool = Field(
        description=(
            "False means there is nowhere on this machine to keep an anchor — "
            "a headless box with no Secret Service, a session without "
            "credentials, or the keyring extra not installed. Distinct from "
            "'your anchor was not found', and a UI that conflates the two "
            "sends the operator to look for a value that could never have "
            "been read."
        )
    )
    detail: str = Field(
        description="What to do about it, when there is something to do."
    )


class KeychainSeedRequest(BaseModel):
    """Store a head in the secret store under an account name."""

    account: str = Field(description="Account name to store it under.")
    head: str = Field(description="The 64-character hex head.")

    @field_validator("head")
    @classmethod
    def _head_is_a_head(cls, v: str) -> str:
        """Same validation as an anchor spec, for the same reason.

        A head seeded with a typo is worse than one pasted with a typo: it
        persists, and every later check reads it back and reports a chain
        that names no record — the most alarming diagnosis this tool
        produces, caused by us.
        """
        cleaned = v.strip().lower()
        if len(cleaned) != 64 or any(c not in "0123456789abcdef" for c in cleaned):
            raise ValueError("a head is 64 hexadecimal characters")
        return cleaned
