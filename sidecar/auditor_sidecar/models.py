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

from pydantic import BaseModel, Field


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
            "True, False, or null. Null means NO ANCHOR WAS SUPPLIED and the "
            "question was never asked — it is not a pass and must never be "
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
    diagnosis: DiagnosisModel | None = Field(
        description="Present only when something failed."
    )
    advisory: AdvisoryModel
