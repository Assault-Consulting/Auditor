<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Contributing to Palimpsests Auditor

Early-stage, contributions welcome. Short on purpose.

## Ground rules

- **Read [FUNCTIONALITY.md](FUNCTIONALITY.md) §3 first.** Seven invariants
  govern this codebase. A change that breaks one is sent back regardless
  of how well it works.

- **The shell never parses wire bytes.** Every PALA-1 fact this
  application renders comes from a verifier call in the `palimpsests`
  package, reached through `sidecar/auditor_sidecar/pala_seam.py`. No
  `struct.unpack`, no `MAGIC`, no byte offsets, no re-derived hashes
  anywhere else in this repository — in Python, in Rust, or in
  TypeScript. A shell that parses is a second implementation of the
  format with no differential test, and one day it renders "valid" where
  the verifier says no. This is enforced by a CI test, not by discipline.
  Changing it requires an ADR and a lead-maintainer decision; it is not
  argued per PR.

- **We describe what a change does, not how significant it is.** The
  product attests that a check was run. It never certifies anything. A PR
  whose copy says "certified", "compliant", or "valid log" is sent back
  on the wording alone.

- **Read-only means read-only.** No code path in this repository opens a
  `.pala` container for writing, takes a write lock on one, or re-anchors
  anything.

## Workflow

- **All changes land via a non-draft pull request — never a direct push to
  `main`.** Documentation is no exception.
- **During the bootstrap period, pull requests are authored and merged by the
  lead maintainer without a second approver, and `main` is not yet
  protected.** Non-author review plus a green `ci-complete` is the standing
  requirement and is what this repository will enforce; it is not enforced
  today, and `GOVERNANCE.md` records the date that changes. Stating this
  plainly costs a paragraph; claiming a control the repository does not have
  costs the credibility of every other claim in it.
- Branch from `main`, open a PR, link an issue where one exists.
- CI must be green on all three platforms (macOS/Linux/Windows). Windows
  path separators and absolute-path behaviour differ from POSIX — do not
  assume a POSIX-only fix is complete.
- Verify on a fresh clone with the exact CI steps before pushing, and
  commit exactly what passed.

## Building and running the tests

Most work needs neither the desktop shell nor a `.pala` file.

```bash
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
python -m venv .venv && . .venv/bin/activate
pip install -e "sidecar[dev]"

ruff check sidecar                    # E/F/I/B/UP, line length 100, py311
pytest sidecar -q                     # headless; FastAPI TestClient
pnpm build                            # must precede cargo check
cd src-tauri && cargo check
reuse lint
```

`python -m auditor_sidecar.main` runs the sidecar alone on
`127.0.0.1:8771`; `pnpm dev` runs the frontend against it. `pnpm tauri
dev` runs the whole application and is needed only for shell-level work.

CI verifies that the code compiles, lints and passes tests on three
operating systems. It cannot verify **appearance**. Visual review happens
in a live desktop session and is a scheduled gate at the close of each UI
phase, not an ad-hoc check.

## Dependencies

- **Selection.** The base sidecar surface is deliberately small. Anything
  heavier or platform-specific lives behind an opt-in extra: PDF
  rendering (`report`), and later the network anchor clients — which also
  means a plain install cannot reach the network at all.
- **Justification.** A new runtime dependency is called out in the PR body:
  why it is needed, why this one, what licence. Build- and test-only
  additions are held to the same explanation at a lighter bar.
- **Tracking.** Direct dependencies are declared in `sidecar/pyproject.toml`,
  `package.json` and `src-tauri/Cargo.toml`. Dependabot monitors all three.

## Code style

- **Python:** `ruff` with `["E", "F", "I", "B", "UP"]`, line length 100,
  target py311, pinned to the exact version CI runs. Type hints on public
  functions.
- **TypeScript:** strict mode. The sidecar client in `src/api` is
  **generated** from the OpenAPI schema and is not hand-edited.
- **Rust:** `cargo fmt`, `cargo clippy` clean.
- Comments, docstrings, commit messages, PR text and all documentation in
  **English**. Working discussion may be in any language.
- Comments explain *why*, especially where the code looks odd. Every
  workaround records the failure it prevents.
- **No SDK retry layers.** Plain `httpx`, `max_retries=0`. Retry policy is
  a caller concern.

## Tests

- Every behavioural change ships with tests in the same PR. A bug fix
  ships with a test that fails before the fix.
- **Isolate global state.** The session store, anchor profiles and the
  keychain each get an autouse reset fixture. A test that touches the
  developer's real OS keychain is a bug even when it passes.
- **Test the denial path.** The sidecar reads arbitrary paths on request:
  missing token, wrong token, path traversal, non-PALA file, zero-byte
  file, file mutated mid-session — all covered explicitly.
- **Agreement over assertion.** Where an equivalence is claimed, pin it as
  a test: sidecar JSON against a direct reader call; the rendered verdict
  against `palimpsests audit verify` exit codes on every published vector;
  a rebuilt report against the session's report.
- Coverage gate: statement ≥ 90, branch ≥ 80 on `auditor_sidecar`.
  Coverage padding is a review failure, not a pass.

## Reporting vulnerabilities

Please **do not** report security issues in public issues or pull
requests. Use a private security advisory or the contact in
**[SECURITY.md](SECURITY.md)**.

## Licensing of contributions

Contributions are **inbound = outbound**: by contributing you license your
work under [Apache-2.0](LICENSE), the same licence the project ships
under. The tree is single-licensed except the report and bundle schemas,
which are CC0-1.0 so that a third party can write an independent verifier
without touching our licence terms; see `REUSE.toml`. **There is no CLA.**

We use the **Developer Certificate of Origin**
(<https://developercertificate.org>). Sign off your commits:

```bash
git commit -s -m "your message"
```

`git commit --amend -s` fixes the latest commit; `git rebase --signoff
<base>` fixes a branch.

## Scope

This repository is the **reader-side desktop shell**. Format changes,
verifier logic, codec behaviour and anything that decides *what is true
about a chain* belong in
[Palimpsests](https://github.com/Assault-Consulting/Palimpsests), not
here. A PR that would add verification logic to this repository is
redirected upstream — that redirection is the point of the boundary, not
an obstacle to it.
