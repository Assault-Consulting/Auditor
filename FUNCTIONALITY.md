<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Palimpsests Auditor — functional specification

**Repo:** `Assault-Consulting/Auditor` · **License:** Apache-2.0
**Status:** pre-implementation. This document is the contract the code is
written against.

---

## 1. What this is

Auditor is the **reader-side desktop shell** over PALA-1 audit chains. It
opens a `.pala` container, asks the package the three verification
questions, and renders the answers — plus the structure of the record —
for a human who has to decide whether the log in front of them can be
relied on.

The tool answers one thing: **can this record be relied on?** Nothing else.

Position in the ecosystem:

| Term | What it is |
|---|---|
| `PALA-1` | The frozen wire format (spec v1.0, `docs/specs/pala-1/PALA-1.md`) |
| `palimpsests` / future `palimpsests-audit` | The library: codec, verifier, `AuditReader`, CLI, vectors |
| **Palimpsests Auditor** | This repo: the desktop shell over the reader side |
| `Palimpsests Scriptorium` | The (later, hardware-gated) writer-side shell |

### 1.1 Non-goals — binding

- **Not a compliance certifier.** Auditor never states that a system is
  conformant with the AI Act, GDPR, or anything else. It states that a
  specific check was run against a specific file with a specific anchor
  at a specific time. Same reasoning that rejected the name "AI Auditor".
- **Read-only.** No writer functionality of any kind. The only bytes
  Auditor ever writes are its own artifacts: reports, bundles, and the
  local witness log (§16). It never writes into a `.pala` container.
- **PALA-1 only.** Not a universal log viewer, not a syslog UI.
- **Local-first.** In MVP nothing leaves the machine. No telemetry, no
  cloud, no auto-update fetch of chain data.
- **No content analytics / BI.** The boundary, in one sentence: *we
  analyse the record as an artefact, never the content it describes.*
  Record-health analytics (§16, F12) is in scope and core; dashboards over
  what the model did are not.

---

## 2. Users and the question each brings

| User | The question | Blocks that answer it |
|---|---|---|
| Compliance officer | "Can I put this in front of an authority?" | F2, F3, F11 |
| Incident investigator | "What happened at 22:41 on 6 Aug?" | F6, F7, F8, F13 |
| Deployer / ops engineer | "Is my logging healthy?" | F5, F15, F17 |
| Independent verifier | "Do I get the same answer the tool got?" | F11, F13, F18 |

---

## 3. Invariants — the laws of this codebase

These are not preferences. A PR that breaks one of them does not merge.

**L1. Every fact rendered comes from a package verifier call.**
The shell never parses wire bytes. No `struct.unpack`, no `MAGIC`, no
byte offsets, no re-derivation of a hash anywhere in this repo. A shell
that parses is a fourth format implementation with no differential test,
and one day it renders "valid" where the verifier says no.
*Enforced by a CI test (§20.2), not by discipline.*

**L2. Anchors arrive only through `AnchorSource`.**
The verifier takes a trusted head as input; where heads live is the
shell's problem and the verifier never learns it. Anchor provenance is
always displayed alongside any completeness claim.

**L3. Proved ≠ Recorded.**
Chain order is *proved*. Wall-clock time is *recorded* — a claim by the
writer. Every time-bearing element in the UI carries which of the two it
is. The default timeline axis is proved order; wall time is an explicit,
watermarked toggle.

**L4. Description, never intent.**
"The chain ends 295 records before the anchored head — consistent with
tail truncation" — yes. "Signs of tampering" — never. Anomaly ≠
violation. The tool shows; the human judges.

**L5. Advisory is never a verdict.**
Advisory items never change the verdict badge, never change the report's
pass/fail line, never change an exit code. They render in their own
channel with their own visual weight.

**L6. Absent ≠ unreadable ≠ failed.**
A missing anchor file is *absent* (normal). A corrupt one is
*unreadable* (an error with a source name). A head that does not match
is a *completeness failure*. Three states, three UI treatments, three
report lines, end to end.

**L7. Not-checked is never rendered as passed.**
`complete_to_anchor is None` renders as "not checked — no anchor
supplied", never as green.

---

## 4. The package seam

Everything Auditor consumes lives behind one module in this repo
(`sidecar/auditor_sidecar/pala_seam.py`). When the audit subsystem is
extracted into the `palimpsests-audit` distribution, exactly one file
changes.

Surface consumed as of `palimpsests` 0.8:

```
palimpsests.audit.reader
    AuditReader.open(path, *, anchor=None) / .from_bytes(...)
        .verify() -> Verification
        .head() -> bytes
        .records() -> Iterator[DecodedRecord]
        .spans() -> list[SpanView]
        .boots() -> list[BootView]
        .origin_at(seq) -> OriginView | None
    Verification(chain, anchor, anchor_attempts, complete_to_anchor,
                 anchor_lag, diagnosis, advisory)
    Diagnosis(pattern, at_seq, expected, narrative)
    DecodedRecord(seq, index, record_type, type_name, header,
                  body_tlvs, kind, kind_name)
    SpanView / BootView / OriginView

palimpsests.audit.pala.verify
    VerifyResult(chain_ok, count, head, breaks, gaps, violations,
                 uninterpretable, complete_to_anchor, anchor_lag,
                 anchor_reason)

palimpsests.audit.pala.incremental
    Advisory, AdvisoryItem(code, at_seq, boot_id, detail)

palimpsests.audit.anchors
    AnchorSource (protocol), AnchorReading, AnchorSourceError,
    AnchorAttempt, ManualAnchor, FileAnchor, ChainedAnchorSource

palimpsests.audit.export
    export_jsonl(data, out, from_seq=None, to_seq=None)   # pala-jsonl/1

palimpsests.audit.tailing
    TailingReader                                          # watch mode
```

Anything not on this list is either not used, or must first land upstream
(§21).

---

## 5. F1 — Open and identify

**Input:** a `.pala` file, chosen by dialog or drag-drop. Multiple files
selected together are treated as one **segment sequence** in order.

**Output header, shown before any verdict:**

- File name, absolute path, byte size, `sha256` of the file as opened.
- Record count, first and last `seq`, boot count.
- Format version and the spec revision the verifier claims.
- Verifier version string (`palimpsests X.Y.Z`, spec `PALA-1 v1.0`).

The file digest is computed once, on open, and carried into every
artifact the session produces. If the file changes on disk mid-session,
the session is invalidated with an explicit banner — never silently
re-read.

**Zero-length file, non-PALA file, unreadable file:** three distinct
states, each with a plain sentence and no verdict badge at all.

---

## 6. F2 — Verify: the three questions

Rendered as a triptych. Each panel is one question, one answer, one
input.

| # | Question | Source field | "Not checked" possible? |
|---|---|---|---|
| 1 | Is what I hold internally consistent? | `chain.chain_ok` | No — always answerable |
| 2 | Is what I hold all of it? | `complete_to_anchor` | **Yes** — `None` without an anchor |
| 3 | Did this history exist at time T? | witness receipt | Yes — absent at tier A |

Question 1 expands into the diagnostics the verifier returns:
`breaks` (seqs where `prev_hash` does not name the predecessor),
`gaps` (skipped sequence numbers — a break whether or not hashes link),
`violations` (`(seq, reason)` normative MUSTs),
`uninterpretable` (unknown `format_version` / `record_type` — chain-checked,
reported, **never** rejected).

Question 2 renders the anchor and its source in the same panel as the
answer, always. A completeness claim without visible provenance is not
rendered.

Question 3 is honest at tier A: "order proved, wall time claimed, no
external existed-by evidence." The panel is the standing visual argument
for a tier upgrade, not an error.

**Tier awareness.** The assurance tier from the header (A / B / B+ / C)
changes the *wording* of each answer, not the answer. At tier A,
"complete" means "complete against a local anchor store" — the UI says
so.

---

## 7. F3 — Anchor provenance flow

`AnchorSource` made visible. The shell owns the concrete sources; the
package owns the protocol.

Sources shipped by Auditor:

| Kind | Phase | Notes |
|---|---|---|
| `manual` | MVP | Paste a 64-char hex head. Validated at entry. |
| `file` | MVP | `FileAnchor` format. Missing = absent; malformed = error. |
| `keychain` | MVP | macOS Keychain / Windows Credential Manager / Secret Service, via `keyring`. Lives here, not in the core — the core must not carry the dependency. |
| `rekor` | Phase 3 | Transparency-log inclusion. Requires network — explicit opt-in, off by default. |
| `tsa` | Phase 3 | RFC 3161 timestamp token. |

Sources are composed with `ChainedAnchorSource`; the first that answers
wins. `last_attempts` **is** the UI: the chain renders as a flow with

- the answering link highlighted,
- absent links dimmed with "nothing stored here",
- erroring links marked red with the source name and the error text.

The order is user-configurable and persisted per file digest.

Chained resolution is availability-first by design: a raising link is
recorded and the walk continues. The UI must therefore never present the
answering source as "the" source without showing what was skipped.

---

## 8. F4 — Diagnosis, not "invalid"

When something fails, the package returns one primary `Diagnosis`. The
shell renders `narrative` and a pattern-specific visual. It may re-word
the sentence for locale; it may **never** override the pattern.

| `pattern` | Visual |
|---|---|
| `truncated_tail` | Cut bar at end-of-file; "writer interrupted mid-write" |
| `prefix_absent` | Chain start marked missing; first record is not GENESIS |
| `seq_gap` | Gap marker at `at_seq` on the timeline |
| `chain_break` | Link broken at `at_seq`; records before it still verify |
| `record_violation` | Single record flagged, chain around it intact |
| `unanchored_tail` | Green up to the anchored head, `anchor_lag` records past it |
| `replaced_or_rolled_back` | Anchor names no record in this chain |

The `unanchored_tail` / `replaced_or_rolled_back` split is the highest-value
distinction in the product: a crash between write and anchoring looks
nothing like a replacement, and only this pane tells the operator which
investigation to open.

**Failure never hides structure.** A chain that fails verification stays
fully browsable. Inspecting broken evidence is half the job.

---

## 9. F5 — Advisory channel

A separate, always-present lane. Never a badge, never a verdict.

Header-only codes: `mono_regression_in_boot`, `wall_regression_in_boot`,
`mid_boot_time_trust_change`, `anchor_never_written`.

Referential codes (r2 oversight semantics):
`reference_unresolved`, `reference_hash_mismatch`,
`ack_target_not_a_candidate`, `shred_target_unresolved`,
`shred_target_key_mismatch`.

Rendering rules:

- Grouped by code, with a count, expandable to per-item `at_seq` /
  `boot_id` / `detail`.
- Each item is a jump target on the timeline.
- `reference_hash_mismatch` is visually stronger than
  `reference_unresolved` — it is the stronger signal, and the package
  separates them for exactly that reason.
- The advisory count appears in the report, labelled advisory, with the
  sentence "advisory items do not affect the verdict."

---

## 10. F6 — The time model and the Chronoscope

Four levels, four different truth-values, all four surfaced:

1. **Proved order** — `seq` and the hash chain. Default axis.
2. **Monotonic offsets** — `monotonic_ns`, valid only *within* one boot.
3. **Recorded wall claim** — `wall_clock_ns` plus its `time_trust`
   qualifier. A claim, never a proof.
4. **External bracket** — witness/TSA "existed by". Absent at tier A.

Navigation paradigm: **Chronoscope**.

- **Coarse date rail (vertical, left).** The whole dataset by date, with
  start and end dates pinned at the caps and visible before any
  interaction. Day rows carry a record-density bar and a SAFETY marker;
  empty days dim. A draggable thumb selects a day or a range.
- **Fine time strip (horizontal).** The rail's selection expanded: boots
  as blocks, SAFETY diamonds, anchor ticks, open-span ticks — all
  clickable. Between boots, a hatched wall-gap; the ruler **disappears
  inside the gap** ("no ruler: the clock is unverifiable while down").
- **Axis toggle.** Wall-time view is opt-in and watermarked with the
  file's actual `time_trust` ("writer's clock · unsynced").
- **Boot boundaries render as axis breaks**, never seamless, labelled
  with the wall gap and the monotonic reset.
- **External pins row**, always present — honestly empty at tier A.
- **Accordion for empty stretches**, with explicit compression marks.
  Never silent compression.
- **Per-record "When was this?" card** — the four levels as four rows for
  the selected record.

---

## 11. F7 — Browse: boots, spans, records

**Boot list** (`BootView`): `boot_id`, first/last `seq`, record count,
`time_trust_values` (more than one element = a mid-boot change, flagged),
`recovery_seq` when a `RECOVERY_TRUNCATED_TAIL` follows the BOOT — which
is the honest marker of a crash-recovered chain.

**Span list** (`SpanView`): `span_id`, parent, start/end `seq`, member
records. **`end_seq is None` renders as "opened, never closed by its
owner"** — first-class evidence, styled as an unclosed bracket, not an
error. Nested spans render by `parent_span_id`.

**Record inspector** (`DecodedRecord`):

- `seq`, container index, `record_type` + `type_name`, `record_hash`.
- Header envelope: `boot_id`, `span_id`, `parent_span_id`,
  `assurance_tier`, `time_trust`, `monotonic_ns`, `wall_clock_ns`,
  `key_id`, header TLVs.
- Body: cleartext TLVs when `key_id == 0`; otherwise marked **present,
  opaque** — never guessed at.
- `kind` / `kind_name` for EVENT and SAFETY records only. Unknown kinds
  render as their number, labelled unknown.
- `prev_hash` is a clickable link to the predecessor.
- Raw hex view with field highlighting — rendered from the package's
  field map, not from the shell's own offsets (L1).

Records with `type_name is None` or an undecoded header render as
"chain-checked, not interpretable by this verifier version" — visible,
never dropped.

---

## 12. F8 — SAFETY records and the oversight loop

SAFETY is a first-class list, not a filter: it is what an auditor reads
first. Sorted by `seq`, grouped by `kind_name`, with `detail` text and a
recurrence count for identical details.

The r2 oversight loop gets its own view:

- `INCIDENT_CANDIDATE` records, each with acknowledged / **unacknowledged**
  state. An unacknowledged candidate is the loudest thing in the UI —
  it is visible without a key, by design, and it is the Art. 73 trigger.
- `OVERSIGHT_ACK` records, resolved to their candidate through
  `EVT_REF_SEQ` + `EVT_REF_HASH`. The ack shows the pseudonymous
  `operator_id` and the monotonic deadline delta.
- `KEY_SHRED` records with their target list, and the resolution result
  from the advisory channel.

The loop closes across a resume (references are seq-indexed over the
whole chain), and the view must render that case without complaint.

---

## 13. F9 — Origin inspection

"Which weights and configuration were active at record N?"

`origin_at(seq)` returns an `OriginView`: `role`, `model_digest` (the
SHA-256 of the GGUF file itself, not a name), `config_digest`,
`since_seq`, `detail`. Rendered as a resolved card on any selected
record, with `since_seq` as a jump link to the `MODEL_LOAD` that made it
active. After a `MODEL_UNLOAD`, the card honestly reads "no model
active".

The model digest is a **Recorded** fact — the writer's claim about what
it loaded — and is badged as such (L3).

---

## 14. F10 — Search and jumps

One bar, four behaviours:

- Free text over `detail` strings ("no frame magic").
- Filter chips: `kind:SAFETY`, `type:KEY_SHRED`, `span:s-0b71`, `boot:6`,
  `tier:A`, date range.
- Time jump: `06.08 22:41` (wall) — with the wall-claim caveat.
- Seq jump: `#1447`.

Three fixed quick buttons: **next warning**, **first record**, **anchor**.

---

## 15. F11 — Verification report

The primary deliverable. Two artifacts from one model.

**PDF (human).** The Dossier layout: verdict ledger at the top, then every
fact carrying a margin badge of Proved or Recorded.

**JSON (machine).** Format id `pala-verification-report/1`:

```jsonc
{
  "format": "pala-verification-report/1",
  "subject": {
    "filename": "...", "sha256": "...", "bytes": 0,
    "records": 0, "boots": 0, "spans": 0,
    "first_seq": 0, "last_seq": 0
  },
  "verifier": { "tool": "palimpsests-auditor X.Y.Z",
                "package": "palimpsests 0.8.0",
                "spec": "PALA-1 v1.0" },
  "checked_at": { "wall_ns": 0, "note": "the auditing machine's clock" },
  "chain": { "chain_ok": true, "head": "...", "breaks": [], "gaps": [],
             "violations": [], "uninterpretable": [] },
  "anchor": { "head": "...", "source_kind": "file",
              "source_detail": "/var/lib/pala/anchor.head",
              "observed_at_ns": 0,
              "attempts": [ { "source_kind": "...", "outcome": "absent" } ] },
  "completeness": { "complete_to_anchor": true, "anchor_lag": null,
                    "anchor_reason": null },
  "existence": { "external_pins": [], "note": "tier A: none available" },
  "diagnosis": null,
  "advisory": { "count": 0, "items": [],
                "note": "advisory items do not affect the verdict" },
  "safety": { "count": 0, "unacknowledged_candidates": 0, "items": [] },
  "time_basis": { "axis": "proved-order",
                  "wall_claims_qualified_by": "time_trust",
                  "caveats": [] }
}
```

**Wording discipline.** The report says: *this tool verified file X
against an anchor obtained from source Y at time Z, and these are the
results.* It is an attestation of a check. It never says "compliant",
"certified", or "valid log".

Both artifacts are deterministic given the same inputs, except for the
`checked_at` field, which is isolated so two reports of the same file
diff to one line.

---

## 16. Phase-2 blocks

### F12 — Record health

Analytics **about the record itself**. Never about content.

Time integrity: drift slope per boot (ppm) as a clock-quality
fingerprint; a step catalog (magnitude, direction, seq, classified
slew / step / regression); a cross-boot gap table flagging negative gaps;
the time-trust profile; boot cadence (many short boots reads as a
crash-loop signal); anchor cadence and lag distribution — which converts
directly into the tier-C argument, "your existed-by brackets would be
X wide"; span-duration distribution and open-span rate.

Warning patterns: SAFETY frequency over time and per boot, by kind and
role; **recurrence** of an identical detail (systematic caller bug, not
an episode); correlation with origin events ("state rejects rose after
the config digest changed at record N" — a correlation of record events,
never an interpretation of content); baseline change.

Three disciplines, without which this block becomes the thing we said we
would not build:

1. **Every metric carries its time-truth basis.** Counts per seq/boot ride
   on proved order; per-day buckets ride on recorded wall time — and if a
   step was detected inside the period, those buckets carry a caveat.
2. **Description, never intent** (L4).
3. **Split at the package boundary.** Detection — drift series, step
   catalog, per-boot statistics — lives in the package as structured
   advisory output, because it must be differential-testable. The shell
   only aggregates, trends, and charts that output (§21).

### F13 — Incident evidence bundle

Select a span or a time range → a self-contained, re-verifiable package:

- the selected records as raw PALA-1 bytes,
- Merkle inclusion proofs binding them to the chain,
- the chain head and the anchor with its provenance,
- the verification result,
- the record-health summary, labelled advisory,
- an explicit **"what time claims this bundle does and does not make"**
  section,
- a `MANIFEST` with digests of every component.

Acceptance criterion: an independent verifier written from the spec
alone, with no Auditor code, reproduces the bundle's claims. This
operationalises the Art. 73 scenario the `INCIDENT_CANDIDATE` /
`OVERSIGHT_ACK` types were designed for.

### F14 — Local witness log

The zero-cost floor under tier B/C. Auditor appends each verification it
performs — file digest, head, anchor and source, result, wall time — to a
local hash-chained log of its own. It proves nothing about the world; it
proves that *this desk saw this head at this point in its own sequence*,
and it makes silent retroactive substitution visible to the auditor
themselves. Explicitly not a substitute for an external witness, and the
UI says so.

---

## 17. F15 — Watch mode (Phase 3)

`TailingReader` against a live chain: the same incremental verifier the
batch path uses, stepped as records arrive. Renders a running verdict, a
live SAFETY feed, and an alert on an unacknowledged
`INCIDENT_CANDIDATE`. Read-only; the file is opened read-only and never
locked against the writer.

## 18. F16 — JSONL export passthrough

`export_jsonl` exposed as a menu action, unchanged, including range
bounds. The export is derived, never authoritative; the UI repeats that
sentence on the export dialog. Deterministic: same container bytes → same
export bytes.

---

## 19. Non-functional requirements

**Security.** The sidecar binds `127.0.0.1` only and requires a
per-launch bearer token generated by the shell and passed to the frontend
over Tauri IPC — the sidecar reads arbitrary files on request and must
not be callable by any other local process. Air-gap posture is the
default: no outbound socket is opened unless the user enables a network
anchor source, and that switch is enforced on two independent layers
(Tauri capability set + a sidecar-side outbound guard).

**Performance.** Container scan is one pass; bodies decode lazily.
Target: a 100 MB / ~1M-record chain verifies in under 10 s and the
timeline stays interactive, with the record table virtualised. Verify
runs off the UI thread; the window never blocks.

**Accessibility.** Verdict is never conveyed by colour alone — every
state carries a glyph and a word. Keyboard-navigable timeline. Reduced-motion
respected. Contrast AA minimum.

**i18n.** UI strings externalised from day one (en, uk). Diagnosis
`pattern` and advisory `code` are the stable keys; `narrative` and
`detail` from the package are shown verbatim in English with the
localised sentence above them — never a translated substitute that could
drift from what the verifier said.

**Determinism.** Same file + same anchor → same report bytes, modulo the
isolated `checked_at` field.

---

## 20. Verification of the verifier-shell

**20.1 Golden vectors.** The published `test-vectors.json` and companion
chains are fixtures. Auditor's rendered verdict must agree with
`palimpsests audit verify` exit codes (0 / 2 / 3, including PARTIAL
semantics when no anchor is supplied) on every one.

**20.2 The no-parsing test.** A CI test greps this repo's source for
`struct.`, `MAGIC`, `unpack`, `record_hash`, `sha256(` and literal byte
offsets outside `pala_seam.py`, and fails the build on a hit. L1 is
enforced mechanically.

**20.3 Mutation demo.** The mutation set (flip a byte, drop a record,
truncate the tail, replace the log, back-date a wall stamp) is a fixture
suite: each mutation must produce its expected `Diagnosis.pattern` and
the expected UI copy.

**20.4 Report round-trip.** The JSON report must be re-derivable from the
package output alone; a test rebuilds it from a fresh `AuditReader` run
and compares.

---

## 21. Upstream dependencies — what must land in the package first

These are Auditor features that **cannot** be built in the shell without
breaking L1. Each is a PR into `Assault-Consulting/Palimpsests`.

| Id | Need | Consumer |
|---|---|---|
| U0 | Correct `palimpsests.__version__`, which reads `0.7.0` in the 0.8.0 release while the distribution metadata reads `0.8.0`. `audit/export.py` stamps every JSONL export with the module constant, so every export from that release names the wrong verifier. Add a test asserting the two agree, and add `src/palimpsests/__init__.py` to the `RELEASING.md` checklist. | F1, F11, F16 |
| U1 | Drift series `d_i = (wall_i − wall_0) − (mono_i − mono_0)` per boot, exposed as structured advisory output | F6, F12 |
| U2 | Step catalog: detected clock steps with magnitude, direction, seq, class | F6, F12 |
| U3 | Per-boot statistics (counts, uptime by monotonic, anchor cadence, span durations) | F12 |
| U4 | A field map for header rendering, so the hex inspector highlights fields without the shell knowing offsets | F7 |
| U5 | Merkle inclusion proof API for a `seq` range | F13 |
| U6 | Verification-report model as a package dataclass, so the JSON schema has one owner | F11 |
| U7 | `time_trust` and `assurance_tier` constant tables exported as names (the §10.5 pattern already used for kinds) | F2, F6 |

Everything else in the MVP is buildable against the 0.8 surface as it
stands today.

---

## 22. Open questions

1. Segment sequences: how the UI presents several files as one logical
   chain, and what it does when one segment is missing.
2. Whether `keychain` ships in MVP or the MVP is manual + file only.
3. MVP cut line inside Browse: span view and origin inspection are in;
   is free-text search over `detail` MVP or fast-follow?
4. Record-health thresholds: what slope deviation, recurrence count, or
   baseline change is worth surfacing by default — and how the user tunes
   it without turning the tool into an alert factory.
5. Whether the record-health summary belongs in the evidence bundle
   (proposal: yes, labelled advisory, with its time-truth caveats).
6. Report signing: does Auditor sign its own reports, and if so with
   what key — noting that a self-signed report proves only that this
   installation produced it.
