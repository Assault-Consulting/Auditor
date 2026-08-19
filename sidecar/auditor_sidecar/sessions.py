# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Open containers, held for the life of a session.

Sessions exist because a 100 MB container should be scanned once, not once
per view. They are in-memory and per-process: the sidecar is spawned by one
desktop window and dies with it, so persisting them would outlive the thing
they describe.

Two rules the store enforces, both of which are evidence handling rather
than housekeeping:

* **The file digest is taken once, on open**, and every artifact the session
  produces carries it. A digest taken later would describe whatever the file
  had become by then.
* **A file that changes on disk invalidates its session.** The alternative —
  re-reading silently — would let a report describe one set of bytes while
  the screen showed another, with nothing anywhere saying so.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from pathlib import Path

from .digest import file_sha256
from .pala_seam import ChainHandle, NotAChain, open_chain


class SessionNotFound(Exception):
    """No such session, or it has been closed."""


class SubjectChanged(Exception):
    """The file on disk is no longer the file this session was opened on."""


@dataclass
class Session:
    session_id: str
    path: Path
    sha256: str
    size: int
    chain: ChainHandle

    def subject(self) -> dict[str, object]:
        """Identity plus structure, as one payload."""
        return {
            "filename": self.path.name,
            "path": str(self.path),
            "bytes": self.size,
            "sha256": self.sha256,
            **self.chain.subject(),
        }

    def assert_unchanged(self) -> None:
        """Confirm the file is still the one this session was opened on.

        Checked by digest rather than by mtime: mtime is a claim the
        filesystem makes and a copy can preserve it, and this application
        does not accept claims where it can check.
        """
        if not self.path.exists() or file_sha256(self.path) != self.sha256:
            raise SubjectChanged(
                f"{self.path} has changed since this session was opened"
            )


class SessionStore:
    """The process-wide set of open sessions."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def open(self, path: Path) -> Session:
        """Open a container and register a session for it.

        The digest is computed **before** the chain is opened, so it covers
        the bytes the reader is about to read rather than whatever the file
        becomes while it is being read.
        """
        path = path.expanduser()
        if not path.is_file():
            raise NotAChain(f"{path} is not a file")

        sha = file_sha256(path)
        size = path.stat().st_size
        chain = open_chain(path)

        session = Session(
            session_id=secrets.token_urlsafe(16),
            path=path.resolve(),
            sha256=sha,
            size=size,
            chain=chain,
        )
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> Session:
        try:
            return self._sessions[session_id]
        except KeyError:
            raise SessionNotFound(session_id) from None

    def close(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            raise SessionNotFound(session_id)
        session.chain.close()

    def close_all(self) -> None:
        """Release every open container. Used on shutdown and by tests."""
        for session in list(self._sessions.values()):
            session.chain.close()
        self._sessions.clear()

    def __len__(self) -> int:
        return len(self._sessions)
