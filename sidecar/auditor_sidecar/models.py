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
    """Question one: is what I hold internally consistent?

    Always answerable. It needs no key and no anchor — only the bytes in
    front of it — which is why it is the one question a chain can never
    decline to answer.
    """

    chain_ok: bool = Field(description="Whether every record links to its predecessor.")
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

    source_kind: str = Field(description="'manual', 'file', ...")
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
