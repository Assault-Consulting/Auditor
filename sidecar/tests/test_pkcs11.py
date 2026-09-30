# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""A PKCS#11 token as an anchor source (B-12).

What a head on a token *means* is the package's (``anchors_pkcs11``,
ADR-0004 upstream) and is tested there against SoftHSM. What is tested here
is only what this application adds on top:

* a profile refuses a pkcs11 source that is missing what it needs, at entry;
* the PIN comes from the keychain, and every way that can fail is an
  ``error`` for that one link — never a 500, never ``absent``;
* the ``[pkcs11]`` extra being absent is the same: one link reports it, the
  walk continues;
* and, where SoftHSM is present, the whole path end to end: a head the
  package wrote to a real token answers a real verification.

The last group skips rather than fails without SoftHSM. CI does not install
it today (DEVELOPMENT-PLAN.md, B-12 notes) — so on CI these are the four
tests that can mislead by being green. They are named so a skip is visible.
"""

from __future__ import annotations

import os
import pytest
import shutil
import subprocess
from auditor_sidecar import keychain
from auditor_sidecar.pala_seam import open_chain
from pathlib import Path

PIN_ACCOUNT = "token-pin"
MODULE = "/nonexistent/libpkcs11.so"


def _pkcs11_source(**over) -> dict[str, str]:
    spec = {
        "kind": "pkcs11",
        "module_path": MODULE,
        "token_label": "desk-token",
        "pin_account": PIN_ACCOUNT,
    }
    spec.update(over)
    return spec


# --- refused at entry -------------------------------------------------------


@pytest.mark.parametrize("missing", ["module_path", "token_label", "pin_account"])
def test_a_pkcs11_source_missing_a_field_is_422(open_client, missing) -> None:
    source = _pkcs11_source()
    del source[missing]
    r = open_client.put(
        "/anchors/profiles/tok", json={"name": "tok", "sources": [source]}
    )
    assert r.status_code == 422
    assert missing in r.text


def test_a_pin_is_never_part_of_a_profile(open_client) -> None:
    """There is no field to put one in. An unknown key is dropped by the
    model, and the listing — which anyone with the session token can read —
    carries only the keychain account that names where the PIN lives."""
    source = _pkcs11_source(user_pin="1234")
    open_client.put("/anchors/profiles/tok", json={"name": "tok", "sources": [source]})
    listed = open_client.get("/anchors/profiles").json()

    assert "1234" not in str(listed)
    tok = next(p for p in listed if p["name"] == "tok")
    assert tok["sources"][0]["pin_account"] == PIN_ACCOUNT


@pytest.mark.parametrize(
    ("kind", "field"),
    [("manual", "head"), ("file", "path"), ("keychain", "account")],
)
def test_the_older_kinds_are_refused_at_entry_too(open_client, kind, field) -> None:
    """Found while adding pkcs11, fixed in the same place: a manual source
    with no head used to be accepted, then fail inside a verification as a
    KeyError — a 500 about a mistake made in an earlier request."""
    r = open_client.put(
        "/anchors/profiles/bad", json={"name": "bad", "sources": [{"kind": kind}]}
    )
    assert r.status_code == 422
    assert field in r.text


# --- every failure is one link's error, and the walk goes on ----------------


def _verify(chain_path, sources):
    handle = open_chain(chain_path)
    try:
        return handle.verify(sources)
    finally:
        handle.close()


def test_no_pin_stored_is_an_error_not_absent(_no_real_keychain, chain_path, head_hex) -> None:
    """Absent would say "no anchor here". The operator configured one; the
    truthful report is that it could not be read."""
    result = _verify(chain_path, [_pkcs11_source(), {"kind": "manual", "head": head_hex}])

    first = result["anchor_attempts"][0]
    assert first["source_kind"] == "pkcs11"
    assert first["outcome"] == "error"
    assert PIN_ACCOUNT in first["error"]
    assert result["anchor"]["source_kind"] == "manual"


def test_an_unreachable_keychain_is_an_error_for_that_link(
    monkeypatch, chain_path, head_hex
) -> None:
    class _Boom:
        def get_password(self, *_a):
            raise RuntimeError("locked")

    monkeypatch.setattr(
        keychain,
        "_import_keyring",
        lambda: (_Boom(), type("E", (), {"KeyringError": RuntimeError})),
    )
    result = _verify(chain_path, [_pkcs11_source(), {"kind": "manual", "head": head_hex}])

    assert [a["outcome"] for a in result["anchor_attempts"]] == ["error", "answered"]
    assert "secret store" in result["anchor_attempts"][0]["error"]


def test_a_missing_extra_is_an_error_for_that_link_not_a_500(
    _no_real_keychain, monkeypatch, chain_path, head_hex
) -> None:
    """Pkcs11Unavailable is a plain RuntimeError upstream. Unconverted it
    would escape the chained source and fail the whole verification."""
    from palimpsests.audit import anchors_pkcs11

    def _unavailable():
        raise anchors_pkcs11.Pkcs11Unavailable("install the [pkcs11] extra")

    monkeypatch.setattr(anchors_pkcs11, "_pkcs11", _unavailable)
    keychain.write(PIN_ACCOUNT, "1234")

    result = _verify(chain_path, [_pkcs11_source(), {"kind": "manual", "head": head_hex}])

    assert [a["outcome"] for a in result["anchor_attempts"]] == ["error", "answered"]
    assert "[pkcs11]" in result["anchor_attempts"][0]["error"]


def test_the_link_is_named_as_the_package_names_it(_no_real_keychain, chain_path) -> None:
    """token/object — the same source_detail Pkcs11Anchor uses, so a link
    that fails here and one that fails inside the package read alike."""
    result = _verify(chain_path, [_pkcs11_source(object_label="custom")])
    assert result["anchor_attempts"][0]["source_detail"] == "desk-token/custom"


def test_the_http_surface_reports_it_the_same_way(open_client, chain_path, head_hex) -> None:
    open_client.put(
        "/anchors/profiles/tok",
        json={
            "name": "tok",
            "sources": [_pkcs11_source(), {"kind": "manual", "head": head_hex}],
        },
    )
    sid = open_client.post("/session", json={"path": str(chain_path)}).json()["session_id"]
    r = open_client.get(f"/session/{sid}/verify?profile=tok")

    assert r.status_code == 200
    assert [a["outcome"] for a in r.json()["anchor_attempts"]] == ["error", "answered"]


# --- a real token -----------------------------------------------------------

_MODULE_CANDIDATES = [
    os.environ.get("AUDITOR_TEST_PKCS11_MODULE", ""),
    "/usr/lib/softhsm/libsofthsm2.so",
    "/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so",
    "/usr/local/lib/softhsm/libsofthsm2.so",
    "/opt/homebrew/lib/softhsm/libsofthsm2.so",
]


def _softhsm_module() -> str | None:
    return next((m for m in _MODULE_CANDIDATES if m and Path(m).exists()), None)


def _have_real_token() -> bool:
    try:
        import pkcs11  # noqa: F401
    except ImportError:
        return False
    return _softhsm_module() is not None and shutil.which("softhsm2-util") is not None


needs_softhsm = pytest.mark.skipif(
    not _have_real_token(),
    reason="needs SoftHSM2 (softhsm2-util + libsofthsm2) and the [pkcs11] extra",
)

USER_PIN = "1234"


#: One token per test that needs one, all created before the library loads.
_TOKEN_LABELS = ("answers", "empty", "wrong-pin", "why-pin")


@pytest.fixture(scope="module")
def _softhsm_tokens(tmp_path_factory):
    """Every token this module uses, initialised before SoftHSM is loaded.

    SoftHSM reads SOFTHSM2_CONF — and scans its token directory — once, when
    python-pkcs11 first initialises the library, then keeps that library for
    the life of the process. Found the hard way, twice: a fresh directory per
    test meant the second test read the *first* test's token (an "empty"
    token that answered with someone else's head), and a token created after
    the first load was simply not there. So all of them are created here,
    up front, one label per test, and no test shares one.
    """
    root = tmp_path_factory.mktemp("softhsm")
    (root / "tokens").mkdir()
    conf = root / "softhsm2.conf"
    conf.write_text(f"directories.tokendir = {root / 'tokens'}\nobjectstore.backend = file\n")
    previous = os.environ.get("SOFTHSM2_CONF")
    os.environ["SOFTHSM2_CONF"] = str(conf)
    for label in _TOKEN_LABELS:
        subprocess.run(
            [
                "softhsm2-util", "--init-token", "--free", "--label", label,
                "--pin", USER_PIN, "--so-pin", "5678",
            ],
            check=True,
            capture_output=True,
        )
    yield
    if previous is None:
        os.environ.pop("SOFTHSM2_CONF", None)
    else:
        os.environ["SOFTHSM2_CONF"] = previous


def _token(label: str) -> dict[str, str]:
    return {"module_path": _softhsm_module(), "token_label": label}


def _seed(token, head_hex: str) -> None:
    """The test writes; the application never does. Seeding goes through the
    package's own store so the object is exactly what a real writer leaves."""
    from palimpsests.audit.anchors_pkcs11 import Pkcs11AnchorStore

    Pkcs11AnchorStore(
        token["module_path"], token["token_label"], user_pin=USER_PIN
    ).store_head(bytes.fromhex(head_hex))


@needs_softhsm
def test_a_head_on_a_real_token_answers(
    _no_real_keychain, _softhsm_tokens, chain_path, head_hex
) -> None:
    token = _token("answers")
    _seed(token, head_hex)
    keychain.write(PIN_ACCOUNT, USER_PIN)

    result = _verify(chain_path, [_pkcs11_source(**token)])

    assert result["anchor"]["source_kind"] == "pkcs11"
    assert result["anchor"]["head"] == head_hex
    assert result["completeness"]["complete_to_anchor"] is True


@needs_softhsm
def test_an_empty_token_is_absent(_no_real_keychain, _softhsm_tokens, chain_path) -> None:
    token = _token("empty")
    keychain.write(PIN_ACCOUNT, USER_PIN)
    result = _verify(chain_path, [_pkcs11_source(**token)])

    assert result["anchor_attempts"][0]["outcome"] == "absent"
    assert result["completeness"]["complete_to_anchor"] is None


@needs_softhsm
def test_a_wrong_pin_is_an_error(
    _no_real_keychain, _softhsm_tokens, chain_path, head_hex
) -> None:
    token = _token("wrong-pin")
    _seed(token, head_hex)
    keychain.write(PIN_ACCOUNT, "0000")
    result = _verify(chain_path, [_pkcs11_source(**token)])

    assert result["anchor_attempts"][0]["outcome"] == "error"


@needs_softhsm
def test_why_the_pin_is_required(_softhsm_tokens, head_hex) -> None:
    """The measurement behind making pin_account mandatory, kept as a test
    so it is re-checked rather than remembered.

    On 0.11.0 the package's own reader, asked without a PIN, reported a
    head it wrote itself as absent (None) — and could be handed a planted
    public decoy instead. That was reported upstream from this repository
    and fixed in 0.12.0 (F1): the reader now refuses outright. This test
    flipped with the fix, and now pins the fixed behaviour — if a future
    release ever returned None here again, the reason pin_account exists
    would be back, and this is where it would show.
    """
    from palimpsests.audit.anchors import AnchorSourceError
    from palimpsests.audit.anchors_pkcs11 import Pkcs11Anchor

    token = _token("why-pin")
    _seed(token, head_hex)

    with pytest.raises(AnchorSourceError, match="no PIN"):
        Pkcs11Anchor(token["module_path"], token["token_label"]).current_head()
