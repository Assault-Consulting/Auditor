# Checking an evidence bundle without Auditor (E-02)

An evidence bundle (`pala-bundle/1`, E-01) is made to be sent. Its recipient
should not have to trust the application that showed it, nor the package
that assembled it. `scripts/check_bundle.py` is that recipient's check:
written from the specifications alone — `pala-bundle-1.md` §8 and PALA-1
core §1.2, §2.1, §2.4, §4.1–§4.3, in Palimpsests — using Python's standard
library and nothing else, from this repository or from Palimpsests.

    python3 -I check_bundle.py chain.pala.bundle.tar

Exit `0` when every check holds, `1` when one does not (each is listed with
`FAIL`), `2` when the file is not a bundle it can read. Copy the one file to
wherever the bundle went; it needs nothing beside it.

## What it recomputes

1. Each member's SHA-256 against `MANIFEST.json`.
2. `records.pala` walks as a container to its end; every body matches the
   digest its header binds; the records link and their seqs run without a
   gap; a range from seq 0 starts at a `GENESIS` with a zero `prev_hash`;
   a range that reaches the chain's last record ends on `source_head`.
3. Every non-null inclusion proof folds from its leaf — the hash of that
   record's header in `records.pala` — to its root, and that root is the one
   the `MERKLE` record at `root_seq` carries, when that record is bundled.
4. Each time claim equals its record's header.

## What it does not

- **The manifest is unsigned.** Someone who alters a member and restates its
  SHA-256 beats check 1 — and is then caught by the others: a body is bound
  by the digest in its header, a header by the chain, a proof by its root.
  What gives a bundle provenance is how it was handed over, or a head held
  outside it.
- **§7.4's semantic checks and the anchor** are not run. `verification.json`
  is the assembler's statement on the whole source chain; the checker prints
  what it says, marked as not rechecked.
- **A null proof is "not yet aggregated"**, never "not included": the chain
  carries no `MERKLE` window over that record yet. It is counted, not failed.

`sidecar/tests/test_check_bundle.py` holds the checker to what the package
assembles and to each kind of tampering above, running it as a recipient
would: as a program, isolated, with the standard library only.
