<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# `auditor-witness/1` — the local witness log

Auditor's own record of the checks it ran (F14, E-05, ADR-0003). This
document is enough to check a log without any code from this repository;
`scripts/check_witness_log.py` is such a checker, written from it.

## What it shows, and what it does not

It shows that **this desk saw this head at this point in its own sequence**,
and makes a later change to an entry — edited, removed, reordered, inserted —
visible, because the entries after it stop linking.

It shows **nothing about the world**. The clock in it is the checking
machine's, a claim. A log cut at its end still links — as a PALA-1 chain
without an anchor does — so only a head noted somewhere else, or an external
witness, makes a cut visible. Whoever controls the machine can write a whole
new log. It is the floor under an external witness, not a substitute for
one.

## Where

One file per user and machine: `witness.jsonl` in the operating system's
per-user data directory, under `palimpsests-auditor` (Linux
`~/.local/share/palimpsests-auditor/`, macOS
`~/Library/Application Support/palimpsests-auditor/`, Windows
`%LOCALAPPDATA%\palimpsests-auditor\`). The environment variable
`AUDITOR_WITNESS_LOG` names another path.

## Format

UTF-8 text, one JSON object per line, each line ending in `\n`. Entries are
numbered from zero in file order.

Every entry has:

| Key | Value |
|---|---|
| `format` | `"auditor-witness/1"` |
| `n` | the entry's number: 0 for the first line, 1 for the second, … |
| `prev` | the previous entry's `hash`; `null` for entry 0 |
| `hash` | the SHA-256, lowercase hex, of the entry's **canonical bytes** |

**Canonical bytes:** the entry without its `hash` key, serialised as JSON
with keys sorted, no whitespace between tokens (`","` and `":"`), non-ASCII
characters written as themselves, encoded UTF-8. In Python:
`json.dumps(entry_without_hash, sort_keys=True, separators=(",", ":"),
ensure_ascii=False).encode("utf-8")`.

**A log links** when, for every line in order, the line is a JSON object,
`format` is as above, `n` equals its position, `prev` equals the previous
line's `hash` (or is `null` on the first line), and `hash` equals the SHA-256
of the line's canonical bytes. The first line where any of these fails is
where the log stops linking; nothing after it is vouched for.

## What an entry records

Written by Auditor 0.x, beside the four keys above. A checker needs none of
them; a reader does.

| Key | Value |
|---|---|
| `checked_at_wall_ns` | the checking machine's clock, nanoseconds since the Unix epoch — a claim |
| `subject` | `{name, sha256, bytes}` of the file checked: its name only, never its directory |
| `head` | the chain head the package reported, hex |
| `records` | how many records the package counted |
| `chain_ok`, `well_formed` | as the package reported them |
| `body_digest_mismatches` | how many records' bodies did not match their digest |
| `profile` | the anchor profile the check ran against (`none` for none) |
| `anchor` | `{head, source_kind, source_detail}` of the anchor that answered, or `null` |
| `complete_to_anchor`, `anchor_lag` | question two, as the package answered it |
| `diagnosis` | the package's diagnosis pattern, or `null` |
| `verifier` | the package and wire format behind the answer |
| `tool` | `palimpsests-auditor-sidecar <version>` |

No verdict word is recorded. Which of these facts answer "is what I hold
consistent?" is the package's rule; the log keeps what was seen.

`anchor.source_detail` is as the package gave it, which for a file anchor on
palimpsests 0.14 is the anchor file's full path. The log is local; it is not
an artifact made to be sent.

## One check, one entry

An entry is written when a check is first computed for an open file and an
anchor profile. Asking again shows the same answer and the same entry. A
check is never written to a log that does not link; the check is still
shown, with a sentence saying it was not written.
