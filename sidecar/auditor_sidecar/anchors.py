# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Named anchor profiles: where this installation looks for a trusted head.

An anchor is the input that makes question two answerable at all, and it has
to come from **outside** the log — otherwise the log is vouching for itself.
Where it comes from is this application's business; what a head means is the
package's (L2).

Profiles are per-process and in memory. Persisting them per file digest is
listed for later; doing it now would mean writing a store before there is a
UI to write into it, and a persisted profile that nobody can see or edit is
worse than none.

The empty profile is a real profile. Verifying with no anchor is the honest
default, not a degraded mode: it produces "not checked", which is a truthful
answer to a question nobody asked.
"""

from __future__ import annotations

#: The profile used when a caller names none. Verifying against it asks
#: question one and leaves question two unasked — which is exactly what
#: happens today, and the name says so rather than pretending an anchor
#: exists.
NO_ANCHOR = "none"


class ProfileNotFound(Exception):
    """No profile by that name."""


class AnchorProfiles:
    """The profiles this sidecar knows about."""

    def __init__(self) -> None:
        self._profiles: dict[str, list[dict[str, str]]] = {NO_ANCHOR: []}

    def put(self, name: str, sources: list[dict[str, str]]) -> None:
        """Define or replace a profile.

        Replacing is allowed and deliberate: a user correcting a mistyped path
        should not have to delete first. What is *not* allowed is redefining
        the empty profile, because "verify without an anchor" must keep
        meaning that.
        """
        if name == NO_ANCHOR:
            raise ValueError(
                f"{NO_ANCHOR!r} is the no-anchor profile and cannot be redefined"
            )
        self._profiles[name] = sources

    def get(self, name: str) -> list[dict[str, str]]:
        try:
            return self._profiles[name]
        except KeyError:
            raise ProfileNotFound(name) from None

    def delete(self, name: str) -> None:
        if name == NO_ANCHOR:
            raise ValueError(f"{NO_ANCHOR!r} cannot be deleted")
        if self._profiles.pop(name, None) is None:
            raise ProfileNotFound(name)

    def names(self) -> list[str]:
        return sorted(self._profiles)

    def all(self) -> dict[str, list[dict[str, str]]]:
        return dict(self._profiles)
