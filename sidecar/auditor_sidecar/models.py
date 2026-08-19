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
