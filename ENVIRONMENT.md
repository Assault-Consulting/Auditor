<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Environment and toolchain

How to get this building, what CI actually runs, and the traps that have
already cost a red build.

**This document does not reproduce configuration files.** An earlier draft
did, and within a week it was teaching a bug we had already fixed — it showed
a `main.py` that raised `HTTPException` inside middleware, which surfaces as
a 500 rather than a 401. A document that copies committed files will always
drift from them, and a drifted document is worse than no document because it
is read with the same trust. Every setting below names the file that owns it.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | 20 LTS | |
| pnpm | 9 | `corepack enable && corepack prepare pnpm@9 --activate` |
| Rust | stable | plus `rustfmt` and `clippy` components |
| Python | 3.11 or 3.12 | CI tests both |
| Python on PATH at runtime | — | The shell launches the sidecar as `python3 -m auditor_sidecar.main`. Packaging it as a self-contained binary is outstanding and must land before any release. |

Platform build dependencies:

- **macOS** — Xcode Command Line Tools.
- **Windows** — MSVC build tools; WebView2 runtime (present on Win11).
- **Linux** — `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`,
  `librsvg2-dev`, `patchelf`.

---

## 2. Layout, and which file owns what

```
Auditor/
├── ruff.toml                     lint rules for the WHOLE tree
├── package.json                  frontend deps and scripts
├── tsconfig.json                 strict + noUncheckedIndexedAccess
├── vite.config.ts                dev server, fixed port 1420
├── schemas/openapi.json          GENERATED from the sidecar models
├── scripts/
│   ├── check_no_wire_parsing.sh  ADR-0001, mechanically
│   ├── coverage_gate.py          statement >= 90 and branch >= 80
│   ├── generate_api_client.py    schema + TypeScript types
│   └── gen-placeholder-icons.py  build-time icons, gitignored output
├── src/                          React frontend
│   └── api/
│       ├── session.ts            IPC session + health
│       └── generated/types.ts    GENERATED — do not edit
├── src-tauri/
│   ├── Cargo.toml                shell deps
│   ├── tauri.conf.json           window, CSP, bundle
│   ├── capabilities/default.json webview permissions
│   └── src/{main,lib,sidecar}.rs shell, IPC, sidecar lifecycle
└── sidecar/
    ├── pyproject.toml            packaging, pytest, coverage
    ├── auditor_sidecar/
    │   ├── main.py               app factory, token gate, CORS
    │   ├── models.py             response models — the schema's source
    │   └── pala_seam.py          the ONLY import of palimpsests
    └── tests/
```

Two files deserve singling out. **`sidecar/auditor_sidecar/pala_seam.py`** is
the only module in the repository that imports `palimpsests` (ADR-0001);
`scripts/check_no_wire_parsing.sh` fails the build on any other. **`ruff.toml`
is at the root on purpose** — a `[tool.ruff]` block inside `sidecar/` would
silently take precedence for that subtree and make a file's lint rules depend
on which directory it sits in.

---

## 3. Commands

```bash
# one-time
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e "sidecar[dev]"

# the sidecar alone — most Phase 1 work happens here, headless
python -m auditor_sidecar.main                    # http://127.0.0.1:8771/docs

# the frontend alone, in a browser
pnpm dev                                          # http://localhost:1420

# the whole application
pnpm tauri dev
```

Running `pnpm dev` without the shell is a supported way to work: there is no
session token, so the boot screen says *desktop shell — not attached* rather
than reporting a failure.

### Everything CI runs, in order

```bash
ruff check sidecar scripts
python scripts/generate_api_client.py --check     # generated client is current
bash scripts/check_no_wire_parsing.sh
pytest sidecar -q
pytest sidecar --cov=auditor_sidecar --cov-report=json && python scripts/coverage_gate.py
pnpm build                                        # MUST precede cargo
(cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings \
   && cargo check && cargo test)
reuse lint
```

Regenerate the client after changing any response model:

```bash
python scripts/generate_api_client.py
```

---

## 4. Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `AUDITOR_SIDECAR_TOKEN` | sidecar | Per-launch session token. The shell sets it; unset disables the gate and prints a warning. |
| `AUDITOR_SIDECAR_PORT` | sidecar | Port to serve on. The shell picks a free one. Blank is treated as unset; malformed exits rather than falling back. |
| `AUDITOR_SIDECAR_PYTHON` | shell | Interpreter used to launch the sidecar, for development against a virtualenv. |
| `TAURI_DEV_HOST` | vite | Bind the dev server to a LAN address, for device testing. |

The token is passed in the **environment and never in `argv`**: command lines
are readable by any process on the machine.

---

## 5. Known traps — encoded in CI, listed here so they are not rediscovered

1. **`pnpm build` must run before any `cargo` command.** The Tauri context
   macro embeds `frontendDist` at compile time; without `dist/` the Rust
   build fails with an error that points nowhere near the cause.
2. **`icon.ico` is required on Windows even with `bundle.active = false`.**
   `tauri-build` reads it regardless, which is why CI generates placeholders.
3. **Do not add an empty `.setup(|_app| Ok(()))`** — type inference fails on
   the empty closure and the message is unhelpful.
4. **`cargo check` does not run `#[cfg(test)]` modules.** CI runs `cargo test`
   separately; without it the Rust tests sit in the repository unexecuted.
5. **Pin `ruff` exactly.** Lint behaviour changes between patch releases, and
   `no-sections` in the isort config removes the other half of that class of
   failure — import grouping otherwise depends on whether the package is
   installed editable, which differs between a laptop and a runner.
6. **Lint a plain checkout, not an editable install.** Same cause as above.
7. **Install the Linux system packages explicitly.** They are not on the
   runner by default.
8. **Regenerate the API client** after touching a response model, or the
   `api-client` job fails on the diff.

---

## 6. Developing without a desktop machine

Most work needs neither the shell nor a `.pala` file:

- **Sidecar** — `pytest` and the FastAPI `TestClient`, entirely headless.
- **Frontend** — `pnpm dev` in any browser; the no-shell state is a first-class
  screen rather than an error.
- **Cross-platform compilation** — the CI matrix.

What CI cannot do is tell you whether a screen reads correctly. That needs a
live desktop session, and it is a scheduled manual gate at the close of each
UI phase rather than something left to chance.

---

## 7. Licensing

`REUSE.toml` declares the tree Apache-2.0, with `schemas/**` as CC0-1.0 so a
third party can write a client or a bundle verifier without taking on our
licence terms. Licence texts live in `LICENSES/`; `reuse lint` gates merges.
