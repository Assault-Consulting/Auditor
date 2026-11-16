#!/usr/bin/env python3
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Check an Auditor witness log (`auditor-witness/1`) with nothing but Python.

Written from `docs/WITNESS-LOG.md` alone and imports nothing from this
repository, so a reader can check a log without trusting the application
that wrote it. Exit 0 when every entry links, 1 at the first that does not.

    python3 check_witness_log.py witness.jsonl
"""

import hashlib
import json
import sys


def main(path: str) -> int:
    prev = None
    n = 0
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            try:
                entry = json.loads(line)
                claimed = entry.pop("hash")
            except (ValueError, KeyError, AttributeError, TypeError):
                print(f"line {lineno}: not an entry")
                return 1
            body = json.dumps(entry, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            ok = (
                entry.get("format") == "auditor-witness/1"
                and entry.get("n") == n
                and entry.get("prev") == prev
                and hashlib.sha256(body.encode("utf-8")).hexdigest() == claimed
            )
            if not ok:
                print(f"line {lineno}: does not link")
                return 1
            prev, n = claimed, n + 1
    print(f"{n} entries link; head {prev}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
