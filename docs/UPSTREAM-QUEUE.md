<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Upstream loose ends

Things this repository has found in `Assault-Consulting/Palimpsests` while
building against it, collected here so they go upstream **as one considered
batch** rather than as a stream of interruptions.

Palimpsests develops on its own plan and cuts releases on its own schedule.
Nothing here is a request for that to change; it is a queue we keep so the
next upstream conversation starts from evidence instead of recollection.

## How to read this

Each item records what was **observed**, on which version, and why it
matters here. An item that turns out to be our misunderstanding gets struck
through with the correction rather than deleted — a list that only ever
grows in one direction is a list nobody trusts.

Items marked **question** are not defect reports. They are places where the
two implementations diverge and we believe ours is right, which is exactly
the situation that deserves a second opinion rather than a silent fork.

Verified against **palimpsests 0.9.0** unless stated otherwise.

---

## Q1 — a file that was never a chain is reported as TAMPERED

**Observed.** `palimpsests pala verify <any non-PALA file>` exits **1
(TAMPERED)**:

```
$ pala verify notachain.txt --json     # 360 bytes of ordinary text
exit 1
consistency.malformed_container = "bad magic at offset 0"
```

A shorter file takes a different path to the same code:

```
$ pala verify tiny.txt --json          # 18 bytes
exit 1
consistency.malformed_container = "truncated tail: fixed header cut at offset 0"
```

**Why it matters.** TAMPERED is the strongest accusation the tool can make,
and it is being made about a file that never had a history to tamper with.
The CLI's own table has **3 UNREADABLE — "the log could not be opened in a
trustworthy state"** — which describes this case exactly and is not used
here.

Auditor refuses to open such a file instead, and reports that it holds no
PALA-1 records. Two of our invariants require that: L6 separates *absent*
from *unreadable* from *failed*, and L4 forbids attributing intent. Calling
an ordinary text file "tampered" does both wrongs at once.

The divergence is pinned by a test on our side
(`test_a_file_that_was_never_a_chain_is_classified_differently`), so a change
upstream fails loudly here rather than passing unnoticed.

**Question, not a defect report.** There may be a reason we have not seen —
for instance that a chain truncated below one header length is genuinely
indistinguishable from junk, so the classification is deliberately
conservative. If so, the 18-byte case above supports it and the 360-byte
case (clean `bad magic`, nothing ambiguous) does not.

---

## U4-followup — `iter_records` still reads offsets as literals

**Observed.** After U4 shipped `HEADER_FIELDS`, the codec's own container
walk continues to use hard-coded offsets:

```python
(hlen,) = struct.unpack_from("<H", data, off + 6)
(blen,) = struct.unpack_from("<I", data, off + 120)
```

**Why it matters.** This is the thing the field map exists to prevent, still
present inside the module that now exports the map. Nothing is wrong today —
the numbers are correct — but the derivation is *available* rather than
*load-bearing*. Wiring `iter_records` to the map would mean any future drift
breaks parsing loudly instead of only breaking a hex view.

Raised in the U4 pull request as a follow-up and deliberately not bundled
with it: this is the format's hot path and deserves its own review.

---

## U9 — the published vectors are not shipped

**Observed.** `importlib.metadata.files("palimpsests")` lists neither
`test-vectors.json` nor `profiles/inference-vectors.json`. Both exist only
in the repository.

**Why it matters.** A vector set reachable only by cloning the repository is
checkable only by people who already have it — close to the opposite of what
publishing one is for. It also blocks the conformance half of our agreement
suite (`FUNCTIONALITY.md` §20.1b): we can compare ourselves against the CLI,
which shares the library, but not against an independent authority.

Our conformance tests exist and skip with that reason printed on every run.

**Note on composition**, because it was miscounted once in discussion: both
files carry twelve records, but different ones. The core set covers one
record of each type (genesis … key_shred); the companion covers the
inference profile (guard_refusal, incident_candidate, oversight_ack, tool
call and result, …) and is the only one with a `semantics` block — which is
the part a profile-aware reader must reproduce, and the part Auditor
actually renders.

---

## U0-closed — `__version__` disagreed with the distribution

**Closed in 0.9.0.** The 0.8.0 release shipped
`palimpsests.__version__ == "0.7.0"` while the distribution metadata read
`0.8.0`, and `audit/export.py` stamped the module constant into every JSONL
export — so every export from that release named the wrong verifier.

Fixed upstream, and now guarded by a test asserting the two agree. Recorded
here because the seam still reads distribution metadata rather than the
module attribute, and the docstring explaining why should not read as a live
workaround.

---

## Candidate — a self-check command

Not observed as a defect; noted because it falls out of U9 almost for free
and would have caught U0.

A `pala selftest` that runs the linked verifier against the packaged vectors
and reports pass/fail would let any installation answer "is this build
sound?" in one command. To actually catch a version drift it would have to
print **and compare** `palimpsests.__version__` against
`importlib.metadata.version(...)` — the vector run alone is unaffected by
that mismatch, so the claim only holds if the check is written in.
