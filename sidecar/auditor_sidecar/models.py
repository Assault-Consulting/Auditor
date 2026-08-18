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
