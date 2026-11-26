# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""E-06: a SCITT Signed Statement about a chain, checked by the package.

Every answer is `verify_statement`'s (channel 8). The statements here are
made with the package's own `build_signed_statement`, the way an issuer
would; Auditor makes none in the product — displayed, never minted.
"""

from __future__ import annotations

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from fastapi.testclient import TestClient
from palimpsests.audit.pala.proofs import chain_root
from palimpsests.audit.pala.scitt import ALG_EDDSA, build_signed_statement
from palimpsests.audit.reader import AuditReader
from pathlib import Path
from writers import fixed_reopen


def _open(client: TestClient, path: Path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def _statement(chain: Path, tmp: Path, *, key=None, last: int | None = None, v3=True, alg=None):
    key = key or ec.generate_private_key(ec.SECP256R1())
    reader = AuditReader.open(chain)
    last = reader.record_count - 1 if last is None else last
    head = reader.record_by_seq(last).record_hash
    kwargs = {"alg": alg} if alg is not None else {}
    msg = build_signed_statement(
        head,
        first_seq=0,
        last_seq=last,
        key=key,
        issuer="https://issuer.example",
        subject="chain",
        root=chain_root(reader, last + 1) if v3 else None,
        **kwargs,
    )
    n = len(list(tmp.glob("statement-*.cose")))
    st = tmp / f"statement-{n}.cose"
    st.write_bytes(msg)
    pub = tmp / f"key-{n}.pem"
    pub.write_bytes(
        key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    )
    return st, pub, key


def _check(client, sid, st, pub) -> dict:
    r = client.post(
        f"/session/{sid}/scitt/check", json={"statement_path": str(st), "key_path": str(pub)}
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_a_v3_statement_is_accepted_and_its_root_recomputed(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    st, pub, _ = _statement(chain_path, tmp_path)
    body = _check(open_client, _open(open_client, chain_path), st, pub)
    reader = AuditReader.open(chain_path)
    assert body["accepted"] is True and body["code"] is None
    assert body["version"] == "v3" and body["root_status"] == "recomputed"
    assert body["head"] == reader.record_by_seq(reader.record_count - 1).record_hash.hex()
    assert len(body["statement_id"]) == 64


def test_a_statement_about_an_earlier_head_holds_on_the_grown_chain(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    grown = tmp_path / "grown.pala"
    grown.write_bytes(chain_path.read_bytes())
    st, pub, _ = _statement(grown, tmp_path, last=2)
    w = fixed_reopen(grown)
    w.boot()
    w.close()
    body = _check(open_client, _open(open_client, grown), st, pub)
    assert body["accepted"] is True
    assert body["checked_at_seq"] == 2 and body["last_seq"] == 2
    assert body["records_here"] > 3


def test_a_v2_and_an_ed25519_statement(open_client, chain_path, tmp_path) -> None:
    sid = _open(open_client, chain_path)
    st, pub, _ = _statement(chain_path, tmp_path, v3=False)
    v2 = _check(open_client, sid, st, pub)
    assert v2["accepted"] and v2["version"] == "v2" and v2["root_status"] == "absent"
    st, pub, _ = _statement(
        chain_path, tmp_path, key=ed25519.Ed25519PrivateKey.generate(), alg=ALG_EDDSA
    )
    assert _check(open_client, sid, st, pub)["accepted"] is True


def test_refusals_are_answers_with_the_package_s_code(
    open_client: TestClient, chain_path: Path, two_boot_chain: Path, tmp_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    st, _, _ = _statement(chain_path, tmp_path)
    _, other_pub, _ = _statement(chain_path, tmp_path)  # another issuer's key
    body = _check(open_client, sid, st, other_pub)
    assert body["accepted"] is False and body["code"] == "signature_invalid"
    assert body["detail"]

    foreign, pub, _ = _statement(two_boot_chain, tmp_path)  # about another chain
    body = _check(open_client, sid, foreign, pub)
    assert body["accepted"] is False
    assert body["code"] in {"head_mismatch", "root_mismatch", "chain_too_short"}

    junk = tmp_path / "junk.cose"
    junk.write_bytes(b"not cbor at all")
    body = _check(open_client, sid, junk, pub)
    assert body["accepted"] is False and body["code"] == "not_cose_sign1"


def test_files_that_cannot_be_used_are_refused_with_the_reason(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    sid = _open(open_client, chain_path)
    st, _, _ = _statement(chain_path, tmp_path)
    bad_key = tmp_path / "bad.pem"
    bad_key.write_text("-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----\n")
    r = open_client.post(
        f"/session/{sid}/scitt/check",
        json={"statement_path": str(st), "key_path": str(bad_key)},
    )
    assert r.status_code == 422 and r.json()["detail"].startswith("the key could not be read")
    r = open_client.post(
        f"/session/{sid}/scitt/check",
        json={"statement_path": str(tmp_path / "absent"), "key_path": str(bad_key)},
    )
    assert r.status_code == 422 and r.json()["detail"].startswith("the statement could not be read")


@pytest.mark.parametrize("route", ["/session/x/scitt/check"])
def test_the_route_needs_the_token(gated_client: TestClient, route: str) -> None:
    r = gated_client.post(route, json={"statement_path": "a", "key_path": "b"})
    assert r.status_code == 401


def test_a_statement_longer_than_the_chain_is_named_for_what_it_is(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    """R18 (0.15.1): the package takes the head from the reader and refuses a
    statement about a record this chain does not have as `chain_too_short`.
    On 0.15.0 the seam hands the last head, and the refusal is
    `head_mismatch` — the same "no", in less precise words."""
    from auditor_sidecar.pala_seam import _HEAD_FROM_READER

    longer = tmp_path / "longer.pala"
    longer.write_bytes(chain_path.read_bytes())
    w = fixed_reopen(longer)
    w.boot()
    w.close()
    st, pub, _ = _statement(longer, tmp_path)  # about the longer chain's last record
    body = _check(open_client, _open(open_client, chain_path), st, pub)
    assert body["accepted"] is False
    assert body["code"] == ("chain_too_short" if _HEAD_FROM_READER else "head_mismatch")


def test_the_seq_compared_at_is_the_package_s_when_it_says(
    open_client: TestClient, chain_path: Path, tmp_path: Path
) -> None:
    from auditor_sidecar.pala_seam import _HEAD_FROM_READER

    if not _HEAD_FROM_READER:
        pytest.skip("the package says where it compared from 0.15.1 (R18)")
    st, pub, _ = _statement(chain_path, tmp_path, last=1)
    body = _check(open_client, _open(open_client, chain_path), st, pub)
    assert body["accepted"] is True and body["checked_at_seq"] == 1
