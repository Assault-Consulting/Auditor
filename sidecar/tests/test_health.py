# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Health probe, token gate and seam identity.

The denial paths are tested as thoroughly as the success path: this service
reads arbitrary file paths on request, so "the refusal works" is a stronger
requirement here than "the happy path works".
"""

from __future__ import annotations

import importlib.metadata as md
import pytest
from auditor_sidecar import __version__
from auditor_sidecar.main import PUBLIC_PATHS, build_app, new_token
from auditor_sidecar.pala_seam import package_version, verifier_identity, wire_format_version
from fastapi.testclient import TestClient

# --- health -----------------------------------------------------------------


def test_health_answers_without_a_token(gated_client: TestClient) -> None:
    """The probe stays reachable even when the gate is enforced.

    The shell polls this to decide when the sidecar is up. A probe that can
    fail for two different reasons — not started, or not authorised — cannot
    be used to distinguish them.
    """
    r = gated_client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_reports_the_verifier_identity(open_client: TestClient) -> None:
    """A verification result is only meaningful next to the verifier that made it."""
    body = open_client.get("/health").json()
    assert body["version"] == __version__
    assert body["package"] == f"palimpsests {package_version()}"
    assert body["spec"] == wire_format_version()


def test_health_states_whether_the_gate_is_on(
    open_client: TestClient, gated_client: TestClient
) -> None:
    assert open_client.get("/health").json()["authenticated"] is False
    assert gated_client.get("/health").json()["authenticated"] is True


def test_health_is_the_only_public_path() -> None:
    """A regression guard, not a tautology.

    Widening this set is the cheapest way to accidentally expose a
    file-reading endpoint, and it is a one-line diff that reviews easily.
    Changing it should require changing this test too.
    """
    assert PUBLIC_PATHS == frozenset({"/health"})


# --- the token gate ---------------------------------------------------------


def _protected(app):
    """Attach a throwaway protected route to an app instance.

    Added per-instance rather than to the module-level app so no test mutates
    shared state, and so the gate is exercised without waiting for the first
    real endpoint (B-01) to exist.
    """

    @app.get("/__probe")
    def probe() -> dict[str, bool]:
        return {"reached": True}

    return TestClient(app)


def test_gate_refuses_a_missing_token() -> None:
    client = _protected(build_app(token="s3cret"))
    r = client.get("/__probe")
    assert r.status_code == 401
    assert r.json()["detail"] == "bad or missing session token"


@pytest.mark.parametrize(
    "header",
    [
        "",
        "s3cret",  # right value, missing scheme
        "Bearer",  # scheme, no value
        "Bearer ",
        "Bearer wrong",
        "Bearer s3cret extra",
        "bearer s3cret",  # scheme is case-sensitive here, deliberately
        "Basic czNjcmV0",
    ],
)
def test_gate_refuses_malformed_and_wrong_tokens(header: str) -> None:
    client = _protected(build_app(token="s3cret"))
    r = client.get("/__probe", headers={"Authorization": header})
    assert r.status_code == 401


def test_gate_admits_the_correct_token() -> None:
    client = _protected(build_app(token="s3cret"))
    r = client.get("/__probe", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200
    assert r.json() == {"reached": True}


def test_gate_is_open_when_no_token_is_configured() -> None:
    """The development posture, verified rather than assumed.

    ``run()`` prints a warning in this state; the behaviour is deliberate and
    is therefore pinned, so it cannot become the production posture by
    accident and unnoticed.
    """
    client = _protected(build_app(token=None))
    assert client.get("/__probe").status_code == 200


def test_gate_refusal_is_a_401_not_a_500() -> None:
    """Regression guard for a real defect in the first draft of this module.

    Raising ``HTTPException`` inside middleware does not reach the
    application's exception handlers: it propagates and surfaces as a 500,
    reporting an authentication refusal as a server fault. The middleware
    returns a response instead.
    """
    client = _protected(build_app(token="s3cret"))
    assert client.get("/__probe").status_code == 401


def test_env_token_is_read_at_construction(monkeypatch) -> None:
    from auditor_sidecar.main import TOKEN_ENV

    monkeypatch.setenv(TOKEN_ENV, "from-env")
    client = _protected(build_app())
    assert client.get("/__probe").status_code == 401
    assert client.get("/__probe", headers={"Authorization": "Bearer from-env"}).status_code == 200


def test_new_token_is_unguessable_and_unique() -> None:
    a, b = new_token(), new_token()
    assert a != b
    assert len(a) >= 32


def test_run_binds_loopback_only(monkeypatch, capsys) -> None:
    """The bind address is a security property, so it is pinned, not assumed.

    ``0.0.0.0`` here would expose a service that reads arbitrary file paths to
    the whole network. That is a one-character diff and it reviews easily.
    """
    from auditor_sidecar import main as m

    captured: dict[str, object] = {}
    monkeypatch.setattr(m, "app", build_app(token=None))
    monkeypatch.setattr(
        m.uvicorn, "run", lambda app, **kw: captured.update(kw), raising=True
    )

    m.run()

    assert captured["host"] == "127.0.0.1"
    assert captured["port"] == m.PORT
    # Ungated start must say so out loud: a disabled gate that starts quietly
    # is how a development affordance becomes the production posture.
    assert "gate is DISABLED" in capsys.readouterr().out


def test_run_is_silent_when_the_gate_is_on(monkeypatch, capsys) -> None:
    from auditor_sidecar import main as m

    monkeypatch.setattr(m, "app", build_app(token="s3cret"))
    monkeypatch.setattr(m.uvicorn, "run", lambda app, **kw: None, raising=True)

    m.run()

    assert "DISABLED" not in capsys.readouterr().out


# --- the seam ---------------------------------------------------------------


def test_package_version_comes_from_distribution_metadata() -> None:
    """Distribution metadata, not ``palimpsests.__version__``.

    The two disagree in the 0.8.0 release: the distribution reports 0.8.0
    while the module constant still reads 0.7.0. Metadata is what pip
    resolved, and therefore what describes the code actually on disk. A
    report that names the wrong verifier version is a provenance defect in a
    tool whose purpose is provenance.

    This test fails if the seam ever switches to the module attribute — and
    keeps passing once upstream corrects the constant, because the two then
    agree.
    """
    assert package_version() == md.version("palimpsests")


def test_wire_format_version_names_the_format_and_its_version() -> None:
    v = wire_format_version()
    assert v.startswith("PALA-1 ")
    assert "format_version" in v


def test_verifier_identity_is_the_pair_artifacts_carry() -> None:
    ident = verifier_identity()
    assert set(ident) == {"package", "spec"}
    assert ident["package"].startswith("palimpsests ")
