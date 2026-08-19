# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""SHA-256 of a file as opened.

This is the one place in the application that hashes anything, and it is
deliberately its own module so that the ADR-0001 scan's exemption is a single
named file rather than a pattern loosened everywhere.

**It does not re-derive a PALA-1 fact.** Record hashes, chain heads and body
digests all come from the verifier and are never recomputed here. What this
computes is a digest of the *file*, which the format has no opinion about: it
identifies the artifact a report is about, so that a reader of that report can
confirm they are holding the same bytes the check was run against. A report
naming a filename and nothing else identifies nothing — filenames are not
evidence.

Read in chunks because these files run to hundreds of megabytes and the
digest is taken once, on open, before anything is rendered.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

#: 1 MiB. Large enough that the loop is not the cost, small enough that a
#: 100 MB container does not arrive in memory in one piece.
_CHUNK = 1024 * 1024


def file_sha256(path: Path) -> str:
    """Hex digest of the file's bytes, exactly as they are on disk."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()
