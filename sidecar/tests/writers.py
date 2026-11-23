# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Chains built record for record.

From profile r8 (0.15) `PalaWriter` writes two records of its own: a
`WRITER_OPEN` straight after the first GENESIS or BOOT and a `WRITER_CLOSE`
last in `close()`. A fixture that tests what is shown *at a sequence number*
builds through `fixed_writer`, which turns that off (`lifecycle=False`), so
its chain is the one it spells out. A fixture that tests
behaviour on a chain as users will bring it stays on `PalaWriter` itself —
`two_boot_chain` does, and `test_lifecycle.py` holds it to the package.
"""

from __future__ import annotations

from palimpsests.audit.pala_writer import PalaWriter
from typing import Any

_OFF: dict[str, Any] = {"lifecycle": False}


def fixed_writer(path: Any, **kwargs: Any) -> PalaWriter:
    """A writer that writes only the records the caller asks for."""
    return PalaWriter(path, **_OFF, **kwargs)


def fixed_reopen(path: Any, **kwargs: Any) -> PalaWriter:
    """`PalaWriter.open_existing`, likewise."""
    return PalaWriter.open_existing(path, **_OFF, **kwargs)
