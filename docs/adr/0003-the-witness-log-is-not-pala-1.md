<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# ADR-0003: The witness log is a format of Auditor's own, not PALA-1

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** `sidecar/auditor_sidecar/witness.py`, `scripts/check_witness_log.py`,
  `scripts/check_no_wire_parsing.sh`
- **Related:** ADR-0001, `FUNCTIONALITY.md` F14, `docs/WITNESS-LOG.md`

## Context

F14 asks Auditor to keep a local, hash-chained record of the checks it runs:
which file, which head, which anchor, what the package answered, when. Two
ways to build it present themselves.

1. **As a PALA-1 chain, written by the package's writer.** One format, one
   verifier, and the log checkable by `pala verify`. But PALA-1 has no record
   type for "a check was run on another chain": its record types are the
   inference profile's. Carrying a check in a `TOOL_CALL` or an `EVENT` would
   give a record a meaning the specification does not give it — the thing
   this repository exists to refuse in a reader. And the writer surface is
   not stable before 1.0 (`WRITER-SURFACE.md`).
2. **As a small format of Auditor's own.** JSON Lines, each entry carrying
   the SHA-256 of the one before it.

## Decision

The second. The log is `auditor-witness/1`, specified in
`docs/WITNESS-LOG.md`. It is **not PALA-1** and does not claim to be: it
holds no container byte, and every PALA-1 fact in it — the head, the
answers, the anchor — is copied from the package's verdict as the seam
returned it, never re-derived (ADR-0001 holds).

What the format hashes is its own entries. That hashing lives in one module,
`witness.py`, and in a stand-alone checker, `scripts/check_witness_log.py`,
which imports nothing from this repository so a reader can check a log
without trusting the application that wrote it. The ADR-0001 scan exempts
those two named files, as it exempts `digest.py`, and for the same reason.

The log keeps **facts, not a verdict**: `chain_ok`, `well_formed`, the count
of body digest mismatches, `complete_to_anchor`, the diagnosis pattern.
Which facts answer question one is the package's rule, and it has changed
once already (T1); a later reader applies the rule of their day to what was
seen.

## Consequences

- What the log shows is one sentence, and what it does not is said with it,
  on screen, every time: it shows that this desk saw this head at this point
  in its own sequence, and makes a later change to an entry visible; it
  shows nothing about the world — the clock is this machine's, a log cut at
  its end still links, and whoever controls the machine can write a new one.
- A log that does not link is not appended to. A check made then still
  shows the package's verdict, with a sentence saying it was not written.
  Nothing repairs the log: the person who keeps it decides what to do with
  it.
- If PALA-1 ever gains a record type for an attestation about another chain,
  this ADR is the one to revisit.
