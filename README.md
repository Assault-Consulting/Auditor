<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Palimpsests Auditor

The reader-side desktop application for **PALA-1** audit chains.

Open a `.pala` container and get an honest answer to three separate
questions:

1. **Is what I hold internally consistent?** — the hash chain, checked
   without a key and without trusting the writer.
2. **Is what I hold all of it?** — checked against an anchor obtained
   from *outside* the log, with the anchor's source always shown.
3. **Did this history exist at time T?** — answered only when an external
   witness exists, and honestly reported as unavailable when it does not.

When something fails, Auditor gives a **diagnosis, not a verdict word**:
"intact to seq 1,447; the anchor names a head 295 records further on —
consistent with the file being cut at the tail, not with corruption."

## What it is not

- **Not a compliance certificate.** Auditor attests that a specific check
  was run against a specific file with a specific anchor at a specific
  time. It never states that a system is conformant with anything.
- **Not a writer.** Read-only with respect to every audited container.
- **Not a universal log viewer.** PALA-1 only.
- **Not a BI tool.** It analyses the record as an artefact, never the
  content the record describes.

## Status

Phases 1–3 are built (open, verify, browse, report, export) and Phase 4 has
begun. Releases are not cut yet; nothing is signed.

## Trying it on Windows

The `installers` workflow builds an unsigned Windows installer on every push
to `main` (and on demand, **Actions → installers → Run workflow**). Download
the `palimpsests-auditor-windows-x64` artifact from the run, check it against
the `.sha256` beside it (`Get-FileHash -Algorithm SHA256 <file>` in
PowerShell prints the same digest), and run the `…-setup.exe`. It installs for the
current user, with no administrator rights and no Python needed: the sidecar
is bundled as a single executable.

Windows SmartScreen warns about an unsigned installer: **More info → Run
anyway**. The installer stays unsigned until before the first outside user
(decided 24 Nov 2026): the SHA-256 is what says it is the file CI built.

| Document | Contents |
|---|---|
| [`FUNCTIONALITY.md`](FUNCTIONALITY.md) | Full functional specification, invariants, report schema |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Process model, the package seam, sidecar API, air-gap layers |
| [`DEVELOPMENT-PLAN.md`](DEVELOPMENT-PLAN.md) | Phases, PR-level breakdown, effort, risks |
| [`ENVIRONMENT.md`](ENVIRONMENT.md) | Toolchain, scaffold files, CI, known traps |

## Where this sits

| Component | Role |
|---|---|
| `PALA-1` | The frozen wire format (spec v1.0) |
| [`Palimpsests`](https://github.com/Assault-Consulting/Palimpsests) | The library: codec, verifier, `AuditReader`, CLI, test vectors |
| **Palimpsests Auditor** | This repo — the desktop shell over the reader side |
| `Palimpsests Scriptorium` | Later: the writer-side runtime shell |

The governing rule of this codebase: **every fact rendered comes from a
verifier call in the package.** The shell never parses wire bytes. A
shell that parses would be a second implementation of the format with no
differential test — and one day it would show "valid" where the verifier
says no. This is enforced by a CI test, not by discipline.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE).
