<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Architecture

Why the codebase is shaped this way. `FUNCTIONALITY.md` says what it does;
`ENVIRONMENT.md` says how to run it.

## 1. One paragraph

Auditor is a desktop application in three processes: a React frontend
rendering the audit view, a Rust (Tauri 2) shell owning windows, dialogs,
capabilities and the sidecar lifecycle, and a Python sidecar that is the
**only** process that touches PALA-1 data — and touches it exclusively
through the `palimpsests` reader API. Python is in the stack for one
reason: the verifier is written in Python, and a second implementation in
Rust or TypeScript would be a second implementation of the format, which
is precisely the failure mode the whole project exists to avoid.

## 2. Three processes, two channels

```
┌────────────────┐   IPC    ┌────────────────┐   HTTP    ┌────────────────┐
│ React frontend │ ◄──────► │  Rust (Tauri)  │ ◄───────► │ Python sidecar │
│    (src/)      │          │  (src-tauri/)  │  :8771    │   (sidecar/)   │
└────────────────┘          └────────────────┘           └───────┬────────┘
        │                                                        │
        └───────────── HTTP + bearer token ──────────────────────┘
                                                                 │
                                                    ┌────────────▼────────┐
                                                    │ palimpsests         │
                                                    │ AuditReader / pala  │
                                                    └─────────────────────┘
```

- **Tauri IPC** carries OS concerns: file dialogs, window state,
  capability set, sidecar spawn/health/shutdown, and delivery of the
  session token to the frontend.
- **localhost HTTP** carries app concerns: open, verify, browse, report.
- The frontend talks to the sidecar with plain `fetch()`, authenticated
  by a token it can only have received from the Rust shell.

## 3. Why the sidecar is the only reader

Invariant L1 ("every fact comes from a verifier call") is an
architectural claim, not a coding-style rule. It holds only if there is
exactly one place in the app where PALA-1 bytes are interpreted. That
place is `palimpsests.audit`, reached through one seam module:

```
sidecar/auditor_sidecar/pala_seam.py     # the ONLY import of palimpsests.*
```

Consequences, all deliberate:

- The Rust shell never opens a `.pala` file. It passes a path.
- The frontend never receives raw record bytes except as a hex string the
  sidecar already produced from the package's decoded view.
- When the audit subsystem is extracted into the `palimpsests-audit`
  distribution, exactly one file in this repo changes.
- The CI test in §20.2 of `FUNCTIONALITY.md` greps for wire-parsing
  primitives everywhere except that file.

## 4. Sidecar HTTP surface

Sessions are explicit and server-side, because a 100 MB container should
be scanned once, not once per view.

```
GET    /health                          → {status, version, package, spec}

POST   /session                         {path[]}            → {session_id, subject}
DELETE /session/{id}
GET    /session/{id}/verify             ?anchor_profile=    → Verification
GET    /session/{id}/boots                                  → BootView[]
GET    /session/{id}/spans                                  → SpanView[]
GET    /session/{id}/records            ?from&to&kind&type&q&limit&cursor
GET    /session/{id}/record/{seq}                           → DecodedRecord + hex
GET    /session/{id}/origin             ?seq=               → OriginView | null
GET    /session/{id}/timeline           ?axis&bucket        → density buckets
GET    /session/{id}/health                                 → record-health (Phase 2)
POST   /session/{id}/report             {format}            → artifact path
POST   /session/{id}/bundle             {from_seq,to_seq}   → artifact path (Phase 2)
POST   /session/{id}/export             {from_seq,to_seq}   → pala-jsonl/1

GET    /anchors/profiles
PUT    /anchors/profiles/{name}         {sources:[...]}
POST   /anchors/probe                   {profile}           → AnchorAttempt[]
```

Every response body is a direct serialisation of package dataclasses.
The sidecar adds no field the package did not produce, except:
pagination envelopes, the file digest computed on open, and artifact
paths. Anything else is a bug.

`GET /session/{id}/verify` is idempotent and cached per (session, anchor
profile): verification is deterministic, so a re-render must never
re-verify and never risk a different answer.

## 5. Anchor sources live here

The package's placement rule is explicit: only stdlib-backed sources live
in `palimpsests.audit.anchors` (`ManualAnchor`, `FileAnchor`,
`ChainedAnchorSource`). Sources needing a dependency the core must not
carry — an OS keychain, a Rekor client, a TSA client — live with their
consumer. Their consumer is this repo:

```
sidecar/auditor_sidecar/anchors/keychain.py   # keyring
sidecar/auditor_sidecar/anchors/rekor.py      # Phase 3, network, opt-in
sidecar/auditor_sidecar/anchors/tsa.py        # Phase 3
```

Each implements the `AnchorSource` protocol: `source_kind`,
`source_detail`, `current_head() -> AnchorReading | None`, raising
`AnchorSourceError` when present-but-unreadable. They are composed with
the package's own `ChainedAnchorSource` — Auditor does not write its own
chaining logic, because `last_attempts` is the UI and a second
implementation would drift from it.

## 6. Air-gap is two layers, not one toggle

A single switch is one misconfiguration away from being no switch at all.

1. **Tauri capabilities.** `src-tauri/capabilities/default.json` grants
   no HTTP permission to the webview beyond localhost; the air-gap
   variant is a separate capability file, not a runtime flag.
2. **Sidecar outbound guard.** The sidecar's HTTP client is wrapped so
   any request to a non-localhost host returns an explicit refusal
   carrying the caller's name. `netstat` shows nothing leaving.

MVP ships with no network anchor source at all, so both layers are
closed by construction. They exist before Phase 3 opens Rekor/TSA, not
after.

## 7. What Auditor writes

Read-only means read-only with respect to the audited container. Auditor
does write:

- report artifacts (PDF, JSON) to a user-chosen path;
- evidence bundles (Phase 2);
- the local witness log (Phase 2) — its own hash-chained record of checks
  performed, in its per-OS data directory;
- UI preferences and anchor profiles, keyed by file digest.

It never opens a `.pala` file for writing, never takes a write lock, and
never re-anchors anything. A prior defect in the writer path — `close()`
re-anchoring a read-only session and destroying evidence — is the reason
this is stated as an architectural constraint rather than assumed.

## 8. Frontend structure

```
src/
  app/            shell, routing, session state
  views/
    verify/       the triptych, anchor flow, diagnosis card
    chronoscope/  date rail, time strip, axis toggle, pins row
    browse/       boots, spans, record table, inspector
    safety/       SAFETY list, r2 oversight loop
    report/       report preview and export
  components/     verdict badge, proved/recorded badge, hex view
  i18n/           en, uk
  api/            typed sidecar client — generated from the OpenAPI schema
```

`src/api` is generated from the sidecar's FastAPI schema, so a package
dataclass change surfaces as a TypeScript compile error rather than a
runtime blank field.

The Proved/Recorded badge is a shared component used by every fact-bearing
element. There is one implementation of that distinction in the UI, and
it is not optional per view.

## 9. Testing seams

- **Sidecar unit tests** run against generated fixture chains and the
  published test vectors; no GUI needed.
- **Contract tests** compare sidecar JSON to a direct `AuditReader` run
  in the same process — catching any field the sidecar invented.
- **Frontend tests** run against recorded sidecar responses, so UI work
  needs neither a real container nor a real machine.
- **CI** compiles and tests on macOS, Linux and Windows. It does *not*
  verify appearance; visual review needs a live desktop session and is a
  separate, manual step before each phase closes.
