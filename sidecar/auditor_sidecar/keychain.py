# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Reading a head out of the operating system's secret store.

Deliberately knows nothing about PALA-1. This module answers one question —
*what string is stored under this name?* — and the seam turns the answer into
an anchor. Keeping the two apart means the OS-specific part can be tested
against a fake store with no chain in sight, and the anchor semantics can be
tested with no keychain in sight.

`keyring` lives behind an optional extra rather than in the base install.
On Linux it pulls a Secret Service client, and a verification tool that
cannot be installed on a headless box because it wants a desktop keyring is
a tool that will not be installed on the machines that most need it.

**Why a keychain at all.** An anchor is only worth something if it is harder
to alter than the log it checks. A head in a file beside the container is
better than nothing and no better than the filesystem; a head in the OS
store survives an attacker who can rewrite files but not unlock the user's
keychain. That is a modest step, and it is the honest description of it.
"""

from __future__ import annotations

#: The service name every entry is stored under. Fixed rather than
#: configurable: an operator who has to remember which service name they
#: used has an anchor store they cannot audit.
SERVICE = "palimpsests-auditor"


class KeychainUnavailable(Exception):
    """There is no usable secret store on this machine.

    Distinct from "the entry is not there". A headless Linux box with no
    Secret Service, a locked macOS keychain and a Windows session without
    credentials all land here — and none of them mean the operator has no
    anchor, only that this process cannot see one. Reporting them as
    "absent" would let a missing store read as a deliberate configuration.
    """


def read(account: str) -> str | None:
    """The secret stored under ``account``, or ``None`` if there is none.

    Raises :class:`KeychainUnavailable` when the store itself cannot be
    reached, which is a different thing from an empty slot.
    """
    keyring, errors = _import_keyring()
    try:
        return keyring.get_password(SERVICE, account)
    except errors.KeyringError as exc:
        raise KeychainUnavailable(str(exc)) from exc


def write(account: str, secret: str) -> None:
    """Store ``secret`` under ``account``.

    Present so an operator can seed an anchor from the application rather
    than from a shell one-liner they have to get right. Writing here is not
    a violation of the read-only rule: this is Auditor's own store, not an
    audited container.
    """
    keyring, errors = _import_keyring()
    try:
        keyring.set_password(SERVICE, account, secret)
    except errors.KeyringError as exc:
        raise KeychainUnavailable(str(exc)) from exc


def available() -> bool:
    """Whether a usable store exists, for a UI that wants to say so up front.

    Answering this before the user configures a keychain profile is the
    difference between "your anchor was not found" and "this machine has
    nowhere to keep one".
    """
    try:
        keyring, _ = _import_keyring()
    except KeychainUnavailable:
        return False
    backend = keyring.get_keyring()
    # keyring's own null backend advertises itself by priority 0 and raises
    # on every call. Checking the class name would break on a rename; the
    # priority is part of its documented contract.
    return getattr(backend, "priority", 0) > 0


def _import_keyring():
    """Import ``keyring`` lazily, and say plainly when it is not installed.

    Lazy because the base install does not carry it (the `keyring` extra
    does), and an import at module scope would make the whole sidecar
    unimportable on a machine that chose not to have it.
    """
    try:
        import keyring
        from keyring import errors
    except ImportError as exc:
        raise KeychainUnavailable(
            "the keyring extra is not installed: pip install 'auditor-sidecar[keyring]'"
        ) from exc
    return keyring, errors
