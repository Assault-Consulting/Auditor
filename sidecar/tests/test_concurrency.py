# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""F19's own claim, checked rather than assumed: "Verify runs off the UI
thread; the window never blocks."

The claim was never wrong, but it was also never tested — it followed from
two properties of the existing code that nobody had written down together:
every route here is a plain ``def``, which Starlette runs in a worker
thread rather than on the event loop, and the frontend's own calls are
already `fetch`-based and non-blocking. Both were true by construction;
neither had a test standing behind it.

The test below makes ``verify`` artificially slow with a monkeypatch
rather than a large real fixture, for the reason every timing-sensitive
fixture in this suite gets built that way: a test whose pass/fail depends
on how many seconds a real decode takes is a test that is slow on some
machines and flaky on others. What is being tested is concurrency, not
speed, so the delay only needs to be reliably longer than the concurrent
request takes to answer.
"""

from __future__ import annotations

import threading
import time
from auditor_sidecar import sessions
from fastapi.testclient import TestClient


def test_verify_does_not_block_other_requests(
    open_client: TestClient, chain_path, monkeypatch
) -> None:
    """A concurrent /health call, issued after a slow /verify has started,
    must complete well before /verify does — proving the sidecar serves
    it from a different worker thread rather than queuing behind the
    request already in flight.
    """
    real_verify = sessions.Session.verify

    def slow_verify(self, *args, **kwargs):
        time.sleep(0.3)
        return real_verify(self, *args, **kwargs)

    monkeypatch.setattr(sessions.Session, "verify", slow_verify)

    sid = open_client.post(
        "/session", json={"path": str(chain_path)}
    ).json()["session_id"]

    results: dict[str, tuple[float, int]] = {}

    def run_verify() -> None:
        t0 = time.time()
        r = open_client.get(f"/session/{sid}/verify")
        results["verify"] = (time.time() - t0, r.status_code)

    def run_health() -> None:
        # Started after verify, so its own elapsed time is meaningful:
        # answering promptly here means it was not queued behind verify.
        time.sleep(0.1)
        t0 = time.time()
        r = open_client.get("/health")
        results["health"] = (time.time() - t0, r.status_code)

    verify_thread = threading.Thread(target=run_verify)
    health_thread = threading.Thread(target=run_health)
    verify_thread.start()
    health_thread.start()
    verify_thread.join()
    health_thread.join()

    verify_elapsed, verify_status = results["verify"]
    health_elapsed, health_status = results["health"]

    assert verify_status == 200
    assert health_status == 200
    assert verify_elapsed >= 0.3
    # health_elapsed is measured from when the health thread woke up, not
    # from when verify started — so "well under the delay" is the bar, not
    # "faster than verify finished", which a queued-behind-verify request
    # could also satisfy by coincidence on a fast enough machine.
    assert health_elapsed < 0.2
