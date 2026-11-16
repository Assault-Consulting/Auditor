# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The local witness log (E-05, F14, ADR-0003).

Auditor appends one entry for every check it performs — which file, which
head, which anchor and from where, what the package answered, and when by
this machine's clock — to a log of its own, in this machine's data
directory. Each entry carries the SHA-256 of the one before it, so an entry
changed, removed or inserted after the fact no longer links.

What it proves, and what it does not, is the point of the module:

- **It proves** that *this desk* saw *this head* at *this point in its own
  sequence* — and makes a silent retroactive substitution in that sequence
  visible to the person who kept it.
- **It does not prove** anything about the world. The clock is this
  machine's. A log cut at its end still links, as a PALA-1 chain without an
  anchor does; only a copy kept elsewhere, or an external witness, shows that.
  And whoever controls this machine can write a whole new log.

**This is not PALA-1** (ADR-0003). Nothing here reads or writes a container,
and no PALA-1 fact is re-derived: the head, the answers and the anchor are
copied from the package's verdict as the seam returned it. The format is
`auditor-witness/1`, JSON Lines, specified in `docs/WITNESS-LOG.md` with a
checker that needs nothing from this repository. Like `digest.py`, this is
its own module so the ADR-0001 scan's exemption for it is one named file.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

FORMAT = "auditor-witness/1"

#: Environment override for the log's path. Tests set it, so a test run never
#: writes into a developer's real data directory.
PATH_ENV = "AUDITOR_WITNESS_LOG"


def default_path() -> Path:
    """Where the log lives: the environment's choice, else this OS's data dir."""
    named = os.environ.get(PATH_ENV)
    if named:
        return Path(named)
    from platformdirs import user_data_dir

    return Path(user_data_dir("palimpsests-auditor", appauthor=False)) / "witness.jsonl"


def canonical(entry: dict) -> bytes:
    """The bytes an entry's hash is taken over: the entry without ``hash``,
    keys sorted, no whitespace, UTF-8. `docs/WITNESS-LOG.md` states the same
    rule, so a checker written from the document alone agrees with this one."""
    body = {k: v for k, v in entry.items() if k != "hash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def entry_hash(entry: dict) -> str:
    return hashlib.sha256(canonical(entry)).hexdigest()


@dataclass(frozen=True)
class Check:
    """The log's own linkage, walked from its first line."""

    entries: int
    #: The last entry's hash, when every line before it linked; else None.
    head: str | None
    #: The first line, one-based, that does not link — None when all do.
    broken_at: int | None
    #: What is wrong at that line, in words that name no cause.
    reason: str | None


class WitnessLog:
    """Append-only, one process at a time.

    The sidecar is the only writer, and one sidecar runs per launch; the lock
    keeps two requests in that process from appending against the same tail.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _lines(self) -> Iterator[tuple[int, str]]:
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                for i, line in enumerate(fh, start=1):
                    yield i, line.rstrip("\n")
        except FileNotFoundError:
            return

    def check(self) -> Check:
        """Walk the log and say whether each line links to the one before it.

        Says where the first break is and what it is, never why: a line that
        does not match its own digest was changed, or written by something
        else, or damaged — the log cannot tell which (L4).
        """
        prev: str | None = None
        count = 0
        for lineno, text in self._lines():
            try:
                entry = json.loads(text)
            except ValueError:
                return Check(count, None, lineno, "this line is not a JSON object")
            if not isinstance(entry, dict):
                return Check(count, None, lineno, "this line is not a JSON object")
            if entry.get("format") != FORMAT:
                return Check(count, None, lineno, f"this line is not {FORMAT}")
            if entry.get("n") != count:
                return Check(
                    count, None, lineno, f"the entry is numbered {entry.get('n')!r}, not {count}"
                )
            if entry.get("prev") != prev:
                return Check(
                    count, None, lineno, "the entry does not name the one before it"
                )
            if entry.get("hash") != entry_hash(entry):
                return Check(count, None, lineno, "the entry does not match its own digest")
            prev = entry["hash"]
            count += 1
        return Check(count, prev, None, None)

    def append(self, fields: dict) -> dict:
        """Write one entry after the last, and return it as written.

        Refuses to append to a log that does not link: an entry chained to a
        broken log would read as continuing a history it cannot vouch for.
        Raises `WitnessRefused` then, and `OSError` when the disk does.
        """
        with self._lock:
            # Walked on every append rather than remembered: the file is on
            # the user's disk, and a tail remembered from the last append would
            # chain a new entry to a log that may since have been edited. A log
            # holds one entry per check, so the walk stays small.
            c = self.check()
            if c.broken_at is not None:
                raise WitnessRefused(
                    f"the witness log does not link at line {c.broken_at}: {c.reason}; "
                    "nothing was added to it"
                )
            entry = {"format": FORMAT, "n": c.entries, "prev": c.head, **fields}
            entry["hash"] = entry_hash(entry)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(entry, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
                fh.flush()
                os.fsync(fh.fileno())
            return entry

    def tail(self, limit: int) -> list[dict]:
        """The last ``limit`` entries as stored, newest last. Not a check."""
        out: list[dict] = []
        for _, text in self._lines():
            try:
                out.append(json.loads(text))
            except ValueError:
                continue
            if len(out) > limit:
                out.pop(0)
        return out


class WitnessRefused(Exception):
    """The log was not appended to, and the message says why."""
