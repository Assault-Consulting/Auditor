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

**What this first test does not cover.** ``time.sleep(0.3)`` releases
the GIL and shares no state between the two threads, so it can prove a
slow route does not queue behind another — a real property of the
Starlette threadpool — but it cannot see two routes racing over shared
state, because nothing here is shared. That gap let a wrong conclusion
stand once: an earlier reading of three concurrent requests against a
large chain, on the strength of a result *this* test's own shape would
have predicted, missed that ``AuditReader``'s decode cache has no lock
(U14; corrected in ``DEVELOPMENT-PLAN.md``'s U14 entry, and closed on
this side in ``docs/U14-decode-performance.md``, revision -01). The
second test below is the one that should have existed to catch it —
and, unlike this one, it counts decode calls under real contention
rather than only timing them.
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


# --- U14 / A1: the race the module docstring above names -------------------
#
# A tiny fixture works here specifically because the delay is injected
# per-record via monkeypatch, not paid by decoding a genuinely large
# chain: 5 threads against a 5-record fixture, each record taking 50ms
# to "decode", reproduces the same race a 1,000,004-record file does at
# real decode speed — deterministically, in about a quarter of a second,
# the same reasoning already given above for why
# `test_verify_does_not_block_other_requests` uses a monkeypatch instead
# of a large real fixture.


def test_concurrent_requests_do_not_each_redecode_the_chain(
    open_client: TestClient, chain_path, monkeypatch
) -> None:
    """Five concurrent requests against records/safety/timeline, on a
    session whose decode cache has not been warmed yet, must decode
    each record once between them — not once per request.

    Before the lock this closes: measured directly against the package
    (not through this sidecar), three concurrent calls on a 100k-record
    chain called `_decode` 300,006 times for 100,002 records — exactly
    3×, and slower in total wall time than a plain sequential run, not
    "serialized for free" by the GIL.
    """
    from palimpsests.audit.reader import AuditReader

    real_decode = AuditReader._decode
    decode_calls = 0

    def counting_slow_decode(self, index, hb):
        nonlocal decode_calls
        decode_calls += 1
        time.sleep(0.05)
        return real_decode(self, index, hb)

    monkeypatch.setattr(AuditReader, "_decode", counting_slow_decode)

    sid = open_client.post(
        "/session", json={"path": str(chain_path)}
    ).json()["session_id"]

    endpoints = ["/records", "/safety", "/timeline", "/records", "/safety"]
    statuses: list[int] = []
    lock = threading.Lock()

    def hit(path: str) -> None:
        r = open_client.get(f"/session/{sid}{path}")
        with lock:
            statuses.append(r.status_code)

    threads = [threading.Thread(target=hit, args=(p,)) for p in endpoints]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert statuses == [200] * len(endpoints)

    with AuditReader.open(chain_path) as probe:
        record_count = len(probe._headers)

    # The number that matters: decoded once, not once per concurrent
    # caller. `> record_count` is exactly the failure this test exists
    # to catch — it is what the unlocked code above measured as 3x.
    assert decode_calls == record_count
