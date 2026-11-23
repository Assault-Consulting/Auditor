# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""E-02: scripts/check_bundle.py, the recipient's check, against the package.

The checker imports nothing from Palimpsests or from here; these tests hold
it to what the package assembles — a whole bundle passes, with every proof
verified — and to each kind of tampering a recipient must catch: a member
altered, a body altered, a proof bent, a time claim edited. Run as a
program, isolated (`-I`), the way a recipient runs it.
"""

from __future__ import annotations

import hashlib
import io
import json
import pytest
import subprocess
import sys
import tarfile
from palimpsests.audit.pala.bundle import assemble_bundle
from palimpsests.audit.pala.checkpoints import merkle_checkpoint
from pathlib import Path
from writers import fixed_writer

CHECKER = Path(__file__).resolve().parents[2] / "scripts" / "check_bundle.py"


def _run(bundle: Path) -> tuple[int, str]:
    r = subprocess.run(
        [sys.executable, "-I", str(CHECKER), str(bundle)], capture_output=True, text=True
    )
    return r.returncode, r.stdout


@pytest.fixture
def aggregated(tmp_path: Path) -> Path:
    """A chain with MERKLE checkpoints, so bundled records carry proofs."""
    path = tmp_path / "agg.pala"
    w = fixed_writer(path)
    w.genesis()
    w.boot()
    for i in range(3):
        for _ in range(5):
            call = w.tool_call("t", args_digest=i.to_bytes(32, "little"))
            w.tool_result(w.seq - 1, call, 0, result_digest=b"\x02" * 32)
        merkle_checkpoint(w)
    w.anchor()
    w.close()
    return path


def _bundle(src: Path, out: Path, **kw) -> Path:
    return Path(assemble_bundle(src, out, **kw).path)


def _rewrite(bundle: Path, member: str, change, *, fix_manifest: bool) -> Path:
    """The same bundle with one member changed, the manifest restated or not."""
    with tarfile.open(bundle) as tar:
        raw = {m.name: tar.extractfile(m).read() for m in tar.getmembers()}
    raw[member] = change(raw[member])
    if fix_manifest:
        manifest = json.loads(raw["MANIFEST.json"])
        manifest["members"][member]["sha256"] = hashlib.sha256(raw[member]).hexdigest()
        raw["MANIFEST.json"] = json.dumps(manifest, indent=2, sort_keys=True).encode() + b"\n"
    out = bundle.with_name("tampered.tar")
    with tarfile.open(out, "w", format=tarfile.USTAR_FORMAT) as tar:
        for name, data in raw.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return out


def test_a_whole_bundle_passes_with_its_proofs(aggregated: Path, tmp_path: Path) -> None:
    result = assemble_bundle(aggregated, tmp_path / "b.tar", from_seq=0)
    assert result.proven > 0
    code, out = _run(Path(result.path))
    assert code == 0, out
    assert f"{result.proven} inclusion proofs verify" in out
    assert "ends on source_head" in out
    assert "starts at a GENESIS" in out


def test_a_middle_range_passes_without_a_head_to_compare(aggregated: Path, tmp_path: Path) -> None:
    code, out = _run(_bundle(aggregated, tmp_path / "m.tar", from_seq=4, to_seq=9))
    assert code == 0, out
    assert "no head to compare" in out


def test_a_member_altered_without_the_manifest_fails(aggregated: Path, tmp_path: Path) -> None:
    b = _bundle(aggregated, tmp_path / "b.tar")
    bad = _rewrite(
        b,
        "verification.json",
        lambda d: d.replace(b'"chain_ok": true', b'"chain_ok": false', 1),
        fix_manifest=False,
    )
    code, out = _run(bad)
    assert code == 1
    assert "FAIL  verification.json: SHA-256 does not match" in out


def test_a_body_altered_and_restated_is_still_caught(aggregated: Path, tmp_path: Path) -> None:
    """The manifest is unsigned: restating it beats check 1. The body's
    digest sits in its header, which the chain binds, so check 2 holds."""
    b = _bundle(aggregated, tmp_path / "b.tar")
    def flip(d: bytes) -> bytes:
        at = d.index(b"\x02" * 32)  # a TOOL_RESULT's result digest, in its body
        return d[:at] + b"\x03" + d[at + 1 :]

    bad = _rewrite(b, "records.pala", flip, fix_manifest=True)
    code, out = _run(bad)
    assert code == 1
    assert "FAIL  bodies that do not match" in out


def test_a_proof_bent_and_restated_is_caught(aggregated: Path, tmp_path: Path) -> None:
    b = _bundle(aggregated, tmp_path / "b.tar")

    def bend(d: bytes) -> bytes:
        doc = json.loads(d)
        seq, proof = next((k, p) for k, p in doc["proofs"].items() if p and p["path"])
        side, h = proof["path"][0]
        proof["path"][0] = [side, ("0" if h[0] != "0" else "1") + h[1:]]
        return json.dumps(doc, indent=2, sort_keys=True).encode() + b"\n"

    code, out = _run(_rewrite(b, "proofs.json", bend, fix_manifest=True))
    assert code == 1
    assert "does not fold to its root" in out


def test_a_time_claim_edited_and_restated_is_caught(aggregated: Path, tmp_path: Path) -> None:
    b = _bundle(aggregated, tmp_path / "b.tar")

    def edit(d: bytes) -> bytes:
        doc = json.loads(d)
        doc["claims"][3]["wall_clock_ns"] += 1
        return json.dumps(doc, indent=2, sort_keys=True).encode() + b"\n"

    code, out = _run(_rewrite(b, "time-claims.json", edit, fix_manifest=True))
    assert code == 1
    assert "time claims that differ from their header" in out


def test_a_damaged_source_bundles_and_the_checker_finds_the_damage(
    body_swapped_chain: Path, tmp_path: Path
) -> None:
    code, out = _run(_bundle(body_swapped_chain, tmp_path / "d.tar"))
    assert code == 1
    assert "FAIL  bodies that do not match" in out
    assert "consistent=False" in out


def test_what_is_not_a_bundle_is_said_so(tmp_path: Path, chain_path: Path) -> None:
    code, out = _run(chain_path)
    assert code == 2 and out.startswith("cannot check")


def test_the_checker_imports_nothing_it_would_have_to_trust() -> None:
    """Standard library only: a recipient runs it with no package installed."""
    import ast

    tree = ast.parse(CHECKER.read_text(encoding="utf-8"))
    imported = {
        (n.module if isinstance(n, ast.ImportFrom) else a.name).split(".")[0]
        for n in ast.walk(tree)
        if isinstance(n, ast.Import | ast.ImportFrom)
        for a in (n.names if isinstance(n, ast.Import) else [None])
        if isinstance(n, ast.ImportFrom) or a is not None
    }
    assert imported <= {"hashlib", "json", "struct", "sys", "tarfile"}, imported
