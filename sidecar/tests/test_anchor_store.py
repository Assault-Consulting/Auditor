# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Anchor profiles survive a restart, and a file that cannot be read is never
written over (E-08: profiles made in the window)."""

from __future__ import annotations

import json
import pytest
from auditor_sidecar.anchors import FORMAT, NO_ANCHOR, AnchorProfiles
from auditor_sidecar.main import build_app
from fastapi.testclient import TestClient
from pathlib import Path

FILE_SOURCE = {"kind": "file", "path": "/srv/anchor/head.json", "detail": "the desk's copy"}


def _client() -> TestClient:
    return TestClient(build_app(token=None))


def test_a_profile_made_through_the_api_is_there_after_a_restart(
    anchor_profiles_path: Path,
) -> None:
    first = _client()
    r = first.put("/anchors/profiles/desk", json={"name": "desk", "sources": [FILE_SOURCE]})
    assert r.status_code == 200, r.text
    # A new app is a restarted sidecar: it knows only what the file holds.
    names = [p["name"] for p in _client().get("/anchors/profiles").json()]
    assert sorted(names) == sorted([NO_ANCHOR, "desk"])
    held = json.loads(anchor_profiles_path.read_text(encoding="utf-8"))
    assert held["format"] == FORMAT
    assert held["profiles"]["desk"][0]["path"] == FILE_SOURCE["path"]
    assert NO_ANCHOR not in held["profiles"]  # the empty profile is not data


def test_a_deleted_profile_stays_deleted(anchor_profiles_path: Path) -> None:
    c = _client()
    c.put("/anchors/profiles/desk", json={"name": "desk", "sources": [FILE_SOURCE]})
    assert c.delete("/anchors/profiles/desk").status_code == 204
    assert [p["name"] for p in _client().get("/anchors/profiles").json()] == [NO_ANCHOR]


def test_the_store_says_where_it_is(anchor_profiles_path: Path) -> None:
    body = _client().get("/anchors/store").json()
    assert body == {"path": str(anchor_profiles_path), "problem": None}


@pytest.mark.parametrize(
    "text",
    [
        "{not json",
        '{"format": "something-else/1", "profiles": {}}',
        '{"format": "auditor-anchor-profiles/1", "profiles": []}',
    ],
)
def test_a_file_that_cannot_be_read_is_left_alone_and_said(
    anchor_profiles_path: Path, text: str
) -> None:
    anchor_profiles_path.parent.mkdir(parents=True, exist_ok=True)
    anchor_profiles_path.write_text(text, encoding="utf-8")
    c = _client()
    store = c.get("/anchors/store").json()
    assert store["problem"] is not None and str(anchor_profiles_path) in store["problem"]
    # Only the empty profile, and verifying without an anchor still works.
    assert [p["name"] for p in c.get("/anchors/profiles").json()] == [NO_ANCHOR]
    # Every change is refused, and the file is untouched.
    r = c.put("/anchors/profiles/desk", json={"name": "desk", "sources": [FILE_SOURCE]})
    assert r.status_code == 409 and "cannot be changed" in r.json()["detail"]
    assert anchor_profiles_path.read_text(encoding="utf-8") == text


@pytest.mark.parametrize("name", ["", "   ", "a\nb", "x" * 65])
def test_a_name_is_one_short_line(name: str) -> None:
    store = AnchorProfiles()
    with pytest.raises(ValueError, match="one line"):
        store.put(name, [FILE_SOURCE])


def test_a_save_that_fails_keeps_nothing(tmp_path: Path) -> None:
    """A profile the disk did not take is not kept in memory either: it would
    vanish at the next start with nothing said."""
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("a file where the directory should be")
    store = AnchorProfiles(blocker / "anchor-profiles.json")
    with pytest.raises(ValueError, match="could not be saved"):
        store.put("desk", [FILE_SOURCE])
    assert store.names() == [NO_ANCHOR]


def test_a_write_is_whole_or_absent(anchor_profiles_path: Path) -> None:
    store = AnchorProfiles(anchor_profiles_path)
    store.put("desk", [FILE_SOURCE])
    assert not anchor_profiles_path.with_name(anchor_profiles_path.name + ".tmp").exists()
    assert AnchorProfiles(anchor_profiles_path).get("desk") == [FILE_SOURCE]
