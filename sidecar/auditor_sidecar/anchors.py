# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Named anchor profiles: where this installation looks for a trusted head.

An anchor is the input that makes question two answerable at all, and it has
to come from **outside** the log — otherwise the log is vouching for itself.
Where it comes from is this application's business; what a head means is the
package's (L2).

Profiles are kept in a file in this OS's data directory (`PATH_ENV`
overrides it, and tests set it), so a profile made in the window is there
the next time Auditor starts. The file holds where to look for a head:
- a manual head;
- a file path;
- a keychain account;
- a PKCS#11 module, token and PIN *account*.
It never holds a secret. A PIN is in the keychain, and the profile only
names the account.

A file that cannot be read is never written over: someone's profiles are in
it. The store then holds only the empty profile, refuses every change, and
says why (`problem`) until the file is fixed or moved.

The empty profile is a real profile. Verifying with no anchor is the honest
default, not a degraded mode: it produces "not checked", which is a truthful
answer to a question nobody asked.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

#: The store's format, written into the file and required when it is read.
FORMAT = "auditor-anchor-profiles/1"

#: Environment override for the file's path, like the witness log's.
PATH_ENV = "AUDITOR_ANCHOR_PROFILES"

#: A name is shown in a list and sent in a query string: one short line.
MAX_NAME = 64


def default_path() -> Path:
    """Where profiles live: the environment's choice, else this OS's data dir."""
    named = os.environ.get(PATH_ENV)
    if named:
        return Path(named)
    from platformdirs import user_data_dir

    return Path(user_data_dir("palimpsests-auditor", appauthor=False)) / "anchor-profiles.json"

#: The profile used when a caller names none. Verifying against it asks
#: question one and leaves question two unasked — which is exactly what
#: happens today, and the name says so rather than pretending an anchor
#: exists.
NO_ANCHOR = "none"


class ProfileNotFound(Exception):
    """No profile by that name."""


class AnchorProfiles:
    """The profiles this sidecar knows about, kept in `path` when one is given.

    Without a path the store is in memory only, which is what a test that
    builds a profile by hand wants.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._profiles: dict[str, list[dict[str, str]]] = {NO_ANCHOR: []}
        self.path = path
        #: Why the file could not be read, or None. While set, nothing is saved.
        self.problem: str | None = None
        if path is not None:
            self._load(path)

    def _load(self, path: Path) -> None:
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or data.get("format") != FORMAT:
                raise ValueError(f"not a {FORMAT} file")
            profiles = data.get("profiles")
            if not isinstance(profiles, dict) or not all(
                isinstance(v, list) and all(isinstance(s, dict) for s in v)
                for v in profiles.values()
            ):
                raise ValueError("its profiles are not a map of lists of sources")
        except (OSError, ValueError) as exc:
            self.problem = f"{path} could not be read ({exc}); it is left as it is"
            return
        for name, sources in profiles.items():
            if name != NO_ANCHOR:
                self._profiles[name] = sources

    def _save(self) -> None:
        """Write the whole store, then move it into place: a crash mid-write
        leaves the previous file, never half of one."""
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        body = {
            "format": FORMAT,
            "profiles": {n: s for n, s in sorted(self._profiles.items()) if n != NO_ANCHOR},
        }
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)

    def _writable(self) -> None:
        if self.problem is not None:
            raise ValueError(f"profiles cannot be changed: {self.problem}")

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
        control = any(ord(c) < 32 or ord(c) == 127 for c in name)
        if not name.strip() or len(name) > MAX_NAME or control:
            raise ValueError(f"a profile name is one line of 1 to {MAX_NAME} characters")
        self._writable()
        previous = self._profiles.get(name)
        self._profiles[name] = sources
        try:
            self._save()
        except OSError as exc:
            # Not kept in memory either: a profile that is gone after a
            # restart, with nothing said, is worse than one refused now.
            if previous is None:
                del self._profiles[name]
            else:
                self._profiles[name] = previous
            raise ValueError(f"the profile could not be saved to {self.path}: {exc}") from None

    def get(self, name: str) -> list[dict[str, str]]:
        try:
            return self._profiles[name]
        except KeyError:
            raise ProfileNotFound(name) from None

    def delete(self, name: str) -> None:
        if name == NO_ANCHOR:
            raise ValueError(f"{NO_ANCHOR!r} cannot be deleted")
        if name not in self._profiles:
            raise ProfileNotFound(name)
        self._writable()
        sources = self._profiles.pop(name)
        try:
            self._save()
        except OSError as exc:
            self._profiles[name] = sources
            raise ValueError(f"the profile could not be removed from {self.path}: {exc}") from None

    def names(self) -> list[str]:
        return sorted(self._profiles)

    def all(self) -> dict[str, list[dict[str, str]]]:
        return dict(self._profiles)
