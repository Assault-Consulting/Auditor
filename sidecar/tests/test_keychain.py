# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""The keychain anchor source.

The design is entirely in how three situations are told apart, so that is
what these tests are about. An empty slot is normal. A store that cannot be
reached is not. A slot holding something that is not a head is not either —
and must never be quietly downgraded to "no anchor configured", because the
operator who put a value there believes they have an anchor.

Every test in this repository runs against an in-memory store, installed by
an autouse fixture in conftest. That is not convenience: a test that reached
the developer's real keychain would pass locally, might prompt for a
password, and could leave an entry behind that outlives the run.
"""

from __future__ import annotations

import pytest
from auditor_sidecar import keychain
from auditor_sidecar.pala_seam import KeychainAnchor, open_chain
from palimpsests.audit.anchors import AnchorSourceError

ACCOUNT = "prod-anchor"


# --- the store layer, which knows nothing about PALA-1 ----------------------


def test_a_stored_secret_comes_back(_no_real_keychain) -> None:
    keychain.write(ACCOUNT, "hello")
    assert keychain.read(ACCOUNT) == "hello"


def test_an_empty_slot_is_none_not_an_error(_no_real_keychain) -> None:
    assert keychain.read("never-written") is None


def test_the_service_name_is_fixed(_no_real_keychain) -> None:
    """An operator who has to remember which service name they used has an
    anchor store they cannot audit."""
    keychain.write(ACCOUNT, "value")
    assert (keychain.SERVICE, ACCOUNT) in _no_real_keychain.entries


def test_an_unreachable_store_raises_rather_than_returning_none(monkeypatch) -> None:
    """Absent and unreachable are different, at every layer.

    Returning None here would make a headless box indistinguishable from an
    operator who never configured an anchor.
    """

    class _Boom:
        def get_password(self, *_a):
            raise RuntimeError("no Secret Service on this bus")

    class _Errors:
        KeyringError = RuntimeError

    monkeypatch.setattr(keychain, "_import_keyring", lambda: (_Boom(), _Errors))
    with pytest.raises(keychain.KeychainUnavailable):
        keychain.read(ACCOUNT)


def test_available_is_false_when_there_is_no_usable_backend(monkeypatch) -> None:
    """A UI needs to distinguish "your anchor was not found" from "this
    machine has nowhere to keep one" before the user configures anything."""

    class _Null:
        priority = 0

        def get_keyring(self):
            return self

    monkeypatch.setattr(
        keychain,
        "_import_keyring",
        lambda: (_Null(), type("E", (), {"KeyringError": RuntimeError})),
    )
    assert keychain.available() is False


# --- the anchor source, which is where the three outcomes are decided -------


def test_a_stored_head_answers(_no_real_keychain, head_hex) -> None:
    keychain.write(ACCOUNT, head_hex)
    reading = KeychainAnchor(ACCOUNT).current_head()
    assert reading is not None
    assert reading.head.hex() == head_hex
    assert reading.source_kind == "keychain"


def test_an_empty_slot_is_absent(_no_real_keychain) -> None:
    """None means absent, and absent is normal — the same contract FileAnchor
    keeps for a missing file."""
    assert KeychainAnchor("never-written").current_head() is None


def test_a_head_is_normalised_on_the_way_out(_no_real_keychain, head_hex) -> None:
    """An operator who pasted an upper-case head into the store still has an
    anchor. Refusing it would be pedantry about a value that is unambiguous."""
    keychain.write(ACCOUNT, "  " + head_hex.upper() + "\n")
    reading = KeychainAnchor(ACCOUNT).current_head()
    assert reading is not None
    assert reading.head.hex() == head_hex


@pytest.mark.parametrize(
    ("stored", "why"),
    [
        ("not hex at all", "not hexadecimal"),
        ("ab" * 31, "too short"),
        ("ab" * 33, "too long"),
        ("", "empty string is a value, not an absence"),
    ],
)
def test_a_present_but_invalid_entry_is_an_error(
    _no_real_keychain, stored: str, why: str
) -> None:
    """Never downgraded to "no anchor configured".

    Someone put that value there and believes they have an anchor. Treating
    it as absent would answer question two with "not checked" while the
    operator reads the screen as "checked, and fine".
    """
    keychain.write(ACCOUNT, stored)
    with pytest.raises(AnchorSourceError) as caught:
        KeychainAnchor(ACCOUNT).current_head()
    assert caught.value.source_kind == "keychain"
    assert ACCOUNT in caught.value.source_detail


def test_an_unreachable_store_is_an_error_with_its_source_named(monkeypatch) -> None:
    """The provenance view has to be able to render the failed link."""

    class _Boom:
        def get_password(self, *_a):
            raise RuntimeError("the keychain is locked")

    monkeypatch.setattr(
        keychain,
        "_import_keyring",
        lambda: (_Boom(), type("E", (), {"KeyringError": RuntimeError})),
    )
    with pytest.raises(AnchorSourceError) as caught:
        KeychainAnchor(ACCOUNT).current_head()
    assert caught.value.source_kind == "keychain"
    assert "locked" in str(caught.value)


def test_no_observation_time_is_invented(_no_real_keychain, head_hex) -> None:
    """The store records no timestamp.

    Filling in "now" would present the moment we happened to look as the
    moment the head was observed — a Recorded claim manufactured by the
    reader, which is exactly the kind of thing L3 exists to prevent.
    """
    keychain.write(ACCOUNT, head_hex)
    assert KeychainAnchor(ACCOUNT).current_head().observed_at_ns is None


# --- the importer itself, which the isolation would otherwise never run -----


@pytest.mark.real_keyring
def test_the_real_importer_works() -> None:
    """Exercises the genuine import, with the autouse isolation switched off.

    Without this the isolation hides a real risk: every other test replaces
    `_import_keyring`, so the actual import path — the one that runs on a
    user's machine — would never execute. A fixture that makes a module
    untestable has traded one silent failure for another.

    Safe to run for real because importing keyring touches no stored secret.
    Nothing below reads or writes one.
    """
    module, errors = keychain._import_keyring()
    assert hasattr(module, "get_password")
    assert issubclass(errors.KeyringError, Exception)


@pytest.mark.real_keyring
def test_a_missing_extra_is_reported_as_unavailable(monkeypatch) -> None:
    """The base install does not carry keyring.

    The message names the fix, because "ImportError: keyring" tells an
    operator nothing about which extra they are missing.

    Marked `real_keyring` for a reason worth recording: without it the
    autouse fixture replaces `_import_keyring` with a lambda, so this test
    called the fake and asserted nothing about the real import path. It
    failed loudly only because `pytest.raises` notices a *missing*
    exception. Written as a plain assertion it would have passed while
    testing nothing — which is the shape of every vacuous test, and the
    reason isolation fixtures need an explicit way out.
    """
    import builtins

    real_import = builtins.__import__

    def _no_keyring(name, *args, **kwargs):
        if name == "keyring":
            raise ImportError("No module named 'keyring'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_keyring)
    with pytest.raises(keychain.KeychainUnavailable) as caught:
        keychain._import_keyring()
    assert "keyring]" in str(caught.value)


def test_available_is_false_without_the_extra(monkeypatch) -> None:
    monkeypatch.setattr(
        keychain,
        "_import_keyring",
        lambda: (_ for _ in ()).throw(keychain.KeychainUnavailable("not installed")),
    )
    assert keychain.available() is False


def test_a_failed_write_is_reported_not_swallowed(monkeypatch) -> None:
    """Seeding an anchor that silently did not land is worse than an error:
    the operator believes they have one."""

    class _Boom:
        def set_password(self, *_a):
            raise RuntimeError("the keychain is locked")

    monkeypatch.setattr(
        keychain,
        "_import_keyring",
        lambda: (_Boom(), type("E", (), {"KeyringError": RuntimeError})),
    )
    with pytest.raises(keychain.KeychainUnavailable):
        keychain.write(ACCOUNT, "ab" * 32)


# --- in a profile, alongside the other kinds --------------------------------


def test_a_keychain_source_composes_with_the_others(
    _no_real_keychain, chain_path, head_hex, tmp_path
) -> None:
    """The point of profiles: try the file, fall through to the keychain."""
    keychain.write(ACCOUNT, head_hex)
    handle = open_chain(chain_path)
    try:
        result = handle.verify(
            [
                {"kind": "file", "path": str(tmp_path / "absent.head")},
                {"kind": "keychain", "account": ACCOUNT},
            ]
        )
        assert result["completeness"]["complete_to_anchor"] is True
        assert result["anchor"]["source_kind"] == "keychain"
        assert [a["outcome"] for a in result["anchor_attempts"]] == ["absent", "answered"]
    finally:
        handle.close()


def test_an_unreadable_keychain_does_not_stop_the_walk(
    monkeypatch, chain_path, head_hex
) -> None:
    """Availability-first resolution, as the package defines it.

    A failing source is recorded and the walk continues — and the attempt is
    still reported, so the UI can show that the keychain was tried and
    refused rather than silently presenting the manual head as "the" anchor.
    """

    class _Boom:
        def get_password(self, *_a):
            raise RuntimeError("locked")

    monkeypatch.setattr(
        keychain,
        "_import_keyring",
        lambda: (_Boom(), type("E", (), {"KeyringError": RuntimeError})),
    )
    handle = open_chain(chain_path)
    try:
        result = handle.verify(
            [
                {"kind": "keychain", "account": ACCOUNT},
                {"kind": "manual", "head": head_hex},
            ]
        )
        assert [a["outcome"] for a in result["anchor_attempts"]] == ["error", "answered"]
        assert result["anchor"]["source_kind"] == "manual"
        assert result["completeness"]["complete_to_anchor"] is True
    finally:
        handle.close()


# --- the HTTP surface -------------------------------------------------------


def test_status_reports_a_usable_store(open_client, _no_real_keychain) -> None:
    body = open_client.get("/anchors/keychain").json()
    assert body["available"] is True
    assert body["detail"]


def test_status_says_nowhere_to_keep_one_when_there_is_not(
    open_client, monkeypatch
) -> None:
    """Distinct from "your anchor was not found".

    Conflating the two sends an operator to look for a value that could
    never have been read on this machine.
    """
    monkeypatch.setattr("auditor_sidecar.main.keychain_available", lambda: False)
    body = open_client.get("/anchors/keychain").json()
    assert body["available"] is False
    assert "keyring extra" in body["detail"]


def test_seeding_stores_a_head(open_client, _no_real_keychain, head_hex) -> None:
    r = open_client.put(
        "/anchors/keychain", json={"account": ACCOUNT, "head": head_hex}
    )
    assert r.status_code == 204
    assert keychain.read(ACCOUNT) == head_hex


def test_a_seeded_head_is_normalised(open_client, _no_real_keychain, head_hex) -> None:
    open_client.put(
        "/anchors/keychain", json={"account": ACCOUNT, "head": head_hex.upper()}
    )
    assert keychain.read(ACCOUNT) == head_hex


def test_seeding_a_malformed_head_is_422(open_client, _no_real_keychain) -> None:
    """A head seeded with a typo persists, and every later check reads it
    back and reports a chain that names no record — caused by us."""
    r = open_client.put(
        "/anchors/keychain", json={"account": ACCOUNT, "head": "deadbeef"}
    )
    assert r.status_code == 422
    assert keychain.read(ACCOUNT) is None


def test_seeding_without_a_store_is_503_not_500(open_client, monkeypatch) -> None:
    """The service is fine; the machine has nowhere to put this.

    A 500 would send the operator to our logs for a problem they can act on
    themselves.
    """

    def _boom(*_a):
        raise keychain.KeychainUnavailable("no usable store")

    monkeypatch.setattr("auditor_sidecar.main.keychain_write", _boom)
    r = open_client.put(
        "/anchors/keychain", json={"account": ACCOUNT, "head": "ab" * 32}
    )
    assert r.status_code == 503


def test_the_keychain_routes_require_the_token(gated_client, auth, head_hex) -> None:
    """They read and write the operator's secret store."""
    body = {"account": ACCOUNT, "head": head_hex}
    assert gated_client.get("/anchors/keychain").status_code == 401
    assert gated_client.put("/anchors/keychain", json=body).status_code == 401
    assert gated_client.put("/anchors/keychain", json=body, headers=auth).status_code == 204


def test_a_seeded_head_then_answers_as_an_anchor(
    open_client, _no_real_keychain, chain_path, head_hex
) -> None:
    """The round trip an operator actually performs: seed it, then use it."""
    open_client.put("/anchors/keychain", json={"account": ACCOUNT, "head": head_hex})
    open_client.put(
        "/anchors/profiles/desk",
        json={"name": "desk", "sources": [{"kind": "keychain", "account": ACCOUNT}]},
    )
    sid = open_client.post("/session", json={"path": str(chain_path)}).json()["session_id"]
    body = open_client.get(f"/session/{sid}/verify?profile=desk").json()

    assert body["completeness"]["complete_to_anchor"] is True
    assert body["anchor"]["source_kind"] == "keychain"
    assert body["anchor_attempts"][0]["outcome"] == "answered"
