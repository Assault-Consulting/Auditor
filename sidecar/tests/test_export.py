# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""D-06 — the package's record export, streamed.

`export_jsonl` (channel 2 since palimpsests 0.14.1, R9) writes `pala-jsonl/1`.
These tests hold the sidecar to carrying it out unchanged: the bytes are the
package's for the same file, the summary is about the whole container whatever
the range, and nothing is held whole in memory on the way.
"""

from __future__ import annotations

import io
import json
from auditor_sidecar import pala_seam
from auditor_sidecar.pala_seam import open_chain
from palimpsests.audit.export import FORMAT, export_jsonl


def _open(client, path) -> str:
    return client.post("/session", json={"path": str(path)}).json()["session_id"]


def _package_export(path, **bounds) -> str:
    out = io.StringIO()
    export_jsonl(path.read_bytes(), out, **bounds)
    return out.getvalue()


def _lines(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines()]


def test_the_export_is_the_packages_own(open_client, chain_path) -> None:
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    assert r.text == _package_export(chain_path)
    summary = _lines(r.text)[-1]
    assert summary["summary"] is True and summary["format"] == FORMAT
    # The export reads no anchor, and says so.
    assert summary["completeness_checked"] is False


def test_a_range_bounds_the_lines_and_never_the_summary(open_client, chain_path) -> None:
    """The summary describes the whole file — a range export included."""
    sid = _open(open_client, chain_path)
    text = open_client.get(f"/session/{sid}/export", params={"from_seq": 1, "to_seq": 2}).text
    assert text == _package_export(chain_path, from_seq=1, to_seq=2)
    lines = _lines(text)
    assert [line["seq"] for line in lines[:-1]] == [1, 2]
    whole = _lines(_package_export(chain_path))[-1]
    summary = lines[-1]
    assert summary["records"] == whole["records"]
    assert summary["chain_head"] == whole["chain_head"]
    assert (summary["from_seq"], summary["to_seq"]) == (1, 2)


def test_a_swapped_body_is_marked_on_its_line_and_in_the_summary(
    open_client, body_swapped_chain
) -> None:
    sid = _open(open_client, body_swapped_chain)
    lines = _lines(open_client.get(f"/session/{sid}/export").text)
    marked = [line["seq"] for line in lines[:-1] if line.get("body_digest_mismatch")]
    assert marked
    assert lines[-1]["body_digest_mismatches"] == marked
    assert lines[-1]["consistent"] is False


def test_an_empty_file_exports_a_summary_of_nothing(open_client, tmp_path) -> None:
    """An empty file cannot be mapped; it is passed as no bytes."""
    empty = tmp_path / "empty.pala"
    empty.write_bytes(b"")
    sid = _open(open_client, empty)
    lines = _lines(open_client.get(f"/session/{sid}/export").text)
    assert len(lines) == 1
    assert lines[0]["summary"] is True and lines[0]["records"] == 0


def test_a_file_that_is_not_a_chain_exports_a_summary_of_nothing(open_client, tmp_path) -> None:
    junk = tmp_path / "notes.txt"
    junk.write_bytes(b"this was never a container" * 20)
    sid = _open(open_client, junk)
    lines = _lines(open_client.get(f"/session/{sid}/export").text)
    assert len(lines) == 1
    assert lines[0]["records"] == 0 and lines[0]["well_formed"] is False


def test_a_backwards_range_is_refused(open_client, chain_path) -> None:
    sid = _open(open_client, chain_path)
    r = open_client.get(f"/session/{sid}/export", params={"from_seq": 3, "to_seq": 1})
    assert r.status_code == 422


def test_a_changed_file_is_refused(open_client, chain_path) -> None:
    sid = _open(open_client, chain_path)
    open_client.app.state.sessions.detach(sid)
    chain_path.write_bytes(chain_path.read_bytes() + b"\x00")
    assert open_client.get(f"/session/{sid}/export").status_code == 409


def test_the_export_is_gated(gated_client, auth, chain_path) -> None:
    sid = gated_client.post("/session", json={"path": str(chain_path)}, headers=auth).json()[
        "session_id"
    ]
    assert gated_client.get(f"/session/{sid}/export").status_code == 401
    assert gated_client.get(f"/session/{sid}/export", headers=auth).status_code == 200


def test_the_stream_is_bounded(chain_path, monkeypatch) -> None:
    """The package's writer waits once the queue is full: memory is bounded by
    the queue, never by the chain. Checked with a queue of one chunk — the
    output is still whole and in order."""
    monkeypatch.setattr(pala_seam, "_EXPORT_QUEUE_CHUNKS", 1)
    monkeypatch.setattr(pala_seam, "_EXPORT_BLOCK", 64)
    handle = open_chain(chain_path)
    try:
        assert "".join(handle.export()) == _package_export(chain_path)
    finally:
        handle.close()


def test_a_failure_in_the_package_reaches_the_caller(chain_path, monkeypatch) -> None:
    """Not swallowed in the writer's thread: the stream raises."""

    def broken(*_args, **_kwargs):
        raise RuntimeError("export failed")

    monkeypatch.setattr(pala_seam, "export_jsonl", broken)
    handle = open_chain(chain_path)
    try:
        try:
            list(handle.export())
        except RuntimeError as exc:
            assert "export failed" in str(exc)
        else:  # pragma: no cover - the assertion is the point
            raise AssertionError("the failure was swallowed")
    finally:
        handle.close()
