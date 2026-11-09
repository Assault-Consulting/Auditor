# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""D-04 — the report is deterministic: same file, same anchor, same bytes.

`FUNCTIONALITY.md` §15 and §19: both artifacts are deterministic given the
same inputs, except `checked_at`, which is isolated so two reports of the
same file diff to one place. Since D-01 the report is the package's
(`build_report`), so this is a check on the package's output, taken through
Auditor's own route: two separate sessions, so the per-session cache cannot
hand back the first report as the second.

The comparison is on the package's bytes, not on a re-serialisation here:
the one `"checked_at": {...}` object is cut out of each text and the rest is
compared byte for byte.
"""

from __future__ import annotations

import json
import re
import shutil

CHECKED_AT = re.compile(r'"checked_at": \{[^{}]*\}')


def _report_text(client, path, profile: str = "none") -> str:
    sid = client.post("/session", json={"path": str(path)}).json()["session_id"]
    try:
        return client.get(f"/session/{sid}/report", params={"profile": profile}).json()["json_text"]
    finally:
        client.delete(f"/session/{sid}")


def _without_checked_at(text: str) -> str:
    found = CHECKED_AT.findall(text)
    assert len(found) == 1, "exactly one checked_at, and it is the only thing removed"
    return CHECKED_AT.sub('"checked_at": <removed>', text)


def test_two_reports_of_one_file_differ_only_in_checked_at(open_client, chain_path) -> None:
    first = _report_text(open_client, chain_path)
    second = _report_text(open_client, chain_path)
    assert _without_checked_at(first).encode() == _without_checked_at(second).encode()
    # And checked_at is a real timestamp, not a constant that would make the
    # comparison above trivially true.
    assert json.loads(first)["checked_at"]["wall_ns"] > 0


def test_with_the_same_anchor_the_bytes_are_the_same(open_client, lagging_chain) -> None:
    path, early, _ = lagging_chain
    open_client.put(
        "/anchors/profiles/desk",
        json={"name": "desk", "sources": [{"kind": "manual", "head": early}]},
    )
    first = _report_text(open_client, path, "desk")
    second = _report_text(open_client, path, "desk")
    assert json.loads(first)["anchor"]["head"] == early
    assert _without_checked_at(first).encode() == _without_checked_at(second).encode()


def test_a_different_anchor_is_a_different_report(open_client, lagging_chain) -> None:
    """Determinism is per input: changing the anchor must change the bytes,
    or the comparisons above would pass for a report that ignores it."""
    path, early, _ = lagging_chain
    open_client.put(
        "/anchors/profiles/desk",
        json={"name": "desk", "sources": [{"kind": "manual", "head": early}]},
    )
    anchored = _report_text(open_client, path, "desk")
    unanchored = _report_text(open_client, path)
    assert _without_checked_at(anchored) != _without_checked_at(unanchored)


def test_a_renamed_copy_differs_only_in_its_filename(open_client, chain_path, tmp_path) -> None:
    """The report names the file it is about, and nothing else about where it
    sat: the same bytes under another name and directory differ in
    `subject.filename` alone."""
    elsewhere = tmp_path / "elsewhere" / "renamed.pala"
    elsewhere.parent.mkdir()
    shutil.copy(chain_path, elsewhere)
    a = json.loads(_report_text(open_client, chain_path))
    b = json.loads(_report_text(open_client, elsewhere))
    a.pop("checked_at")
    b.pop("checked_at")
    assert a["subject"].pop("filename") == chain_path.name
    assert b["subject"].pop("filename") == "renamed.pala"
    assert a == b


def test_the_report_does_not_carry_the_readers_path(open_client, chain_path) -> None:
    """A report travels to someone else; where it was made does not."""
    text = _report_text(open_client, chain_path)
    assert str(chain_path.parent) not in text
    assert str(chain_path.parent).replace("\\", "\\\\") not in text
