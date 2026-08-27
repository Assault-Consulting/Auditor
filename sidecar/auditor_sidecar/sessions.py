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
from .digest import file_sha256
from .pala_seam import ChainHandle, NotAChain, open_chain
from dataclasses import dataclass, field
from pathlib import Path


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
    #: Verification results, keyed by anchor profile.
    #:
    #: Verification is deterministic over the same bytes and the same anchor,
    #: so a second call must return the first answer rather than recompute
    #: one. That is not only a performance point: two runs that disagreed
    #: would mean the shell had shown a verdict it could no longer reproduce,
    #: and this application's entire claim is that its answers are
    #: reproducible.
    verifications: dict[str, dict] = field(default_factory=dict)
    #: The structural views, computed at most once each.
    #:
    #: The rule that decides what is cached here is whether the set of
    #: questions **converges**, not whether an answer is expensive.
    #:
    #: * Boots and spans: one answer each for the life of the session.
    #: * Timelines: two axes and a bounded set of resolutions a UI asks for,
    #:   so the keyspace is small and stops growing.
    #: * Record windows, a single record, an origin: one answer *per question
    #:   asked*. An offset or a seq makes every call new, so a cache would
    #:   grow with the browsing and never converge — which is the failure a
    #:   paginated endpoint exists to avoid, reintroduced one layer up.
    #:
    #: None of these can change while the session is open: the file is the
    #: same bytes or the session is refused.
    _boots: list[dict] | None = None
    _spans: list[dict] | None = None
    _timelines: dict[tuple[str, int, str | None], dict] = field(default_factory=dict)

    def verify(
        self, profile: str = "none", sources: list[dict[str, str]] | None = None
    ) -> dict:
        """The verifier's answer for this session, computed at most once.

        Cached per profile rather than per session, because the same container
        checked against two different anchors is two different answers — and
        both are legitimate. A user who tries the keychain, finds nothing, and
        then pastes a head by hand has asked two questions, not corrected one.
        """
        if profile not in self.verifications:
            self.verifications[profile] = self.chain.verify(sources)
        return self.verifications[profile]

    def boots(self) -> list[dict]:
        """The boots in this container, computed at most once."""
        if self._boots is None:
            self._boots = self.chain.boots()
        return self._boots

    def spans(self) -> list[dict]:
        """The spans in this container, computed at most once."""
        if self._spans is None:
            self._spans = self.chain.spans()
        return self._spans

    def record(self, seq: int) -> dict | None:
        """One record, or None when the container holds no such sequence."""
        return self.chain.record(seq)

    def timeline(
        self, axis: str = "seq", buckets: int = 120, align: str | None = None
    ) -> dict:
        """Density along an axis, computed once per (axis, buckets, align).

        `align` is part of the key, and leaving it out would have been a
        silent wrong answer rather than a slow one: a uniform timeline and a
        day-aligned one over the same axis and count are different buckets
        with different boundaries, and the second caller would have received
        the first's answer with the wrong `align` field attached to it.
        """
        key = (axis, buckets, align)
        if key not in self._timelines:
            self._timelines[key] = self.chain.timeline(
                axis=axis, buckets=buckets, align=align
            )
        return self._timelines[key]

    def origin(self, seq: int) -> dict | None:
        """The origin in force at a record, or None when none was declared."""
        return self.chain.origin(seq)

    def records(
        self,
        offset: int = 0,
        limit: int = 200,
        record_type: int | None = None,
        boot_id: str | None = None,
        span_id: str | None = None,
    ) -> dict:
        """A window onto the records. Deliberately uncached — see above."""
        return self.chain.records(
            offset=offset,
            limit=limit,
            record_type=record_type,
            boot_id=boot_id,
            span_id=span_id,
        )

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

        Which platforms this actually protects is worth knowing. The reader
        memory-maps the container, and Windows refuses to write to or delete
        a file backing an active mapping, so there the operating system
        prevents the change rather than this method detecting it. On Linux
        and macOS the change is permitted, and this is the only thing
        standing between it and a report describing bytes that are no longer
        there.
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

    def detach(self, session_id: str) -> None:
        """Release the container's memory map, keeping the session record.

        Used where the file must be manipulated while the session's identity
        claim is still under test. Kept off the HTTP surface deliberately: a
        session that has let go of its container can still say what it was
        opened on, which is useful in a test and misleading in an API.
        """
        self.get(session_id).chain.close()

    def close_all(self) -> None:
        """Release every open container. Used on shutdown and by tests."""
        for session in list(self._sessions.values()):
            session.chain.close()
        self._sessions.clear()

    def __len__(self) -> int:
        return len(self._sessions)
