<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Engineering practices

These are not invented for this repo. They are the practices that carried
Palimpsests to a frozen wire format reproduced byte-for-byte by two
independent verifiers written from the prose alone — extracted, with the
reasoning kept, and adapted where Auditor differs (a desktop application
with a frontend, not a library + CLI).

Each section states **the practice**, **why it exists** (usually: a
specific failure it prevents, already paid for once), and **how it lands
here**.

---

## 1. Development

### 1.1 Everything through a non-draft PR with non-author review

No direct pushes to `main`, documentation included. Branch protection
enforces it rather than convention requesting it.

*Why.* An earlier "docs may land directly" allowance was retired upstream
once the protection went on. The reason is not ceremony: "every change was
reviewed" is a claim about history, and it can only be made from the date
the protection was actually enforced. Commits before that date are outside
the window forever, however careful they were.

*Here.* Auditor is a brand-new repository, so the strongest available
version of this was "every change but the first has had non-author review".
That version is **no longer available**: the skeleton was pushed directly to
an unprotected `main` over fifteen commits, and pull requests #1 through #5
were merged by their author. The opportunity was real and it was spent —
recorded here because a practices document that only lists the practices we
kept is worth less than one that also names the one we did not.

What was salvaged, and is now in force: the ruleset went on on 17 August
2026, and `GOVERNANCE.md` records that date as the measurement window.
Pull request #6 is the first change in this repository to require, and
receive, an approval from someone other than its author. Everything before
it sits outside the window and is described as outside it, rather than
averaged into a figure that would flatter us.

### 1.2 The settled constraints are not re-litigated per PR

Upstream has two: no attention-kernel modification, and the core is a
library + CLI, not an application. They live in `CONTRIBUTING.md` and are
governance-level to change.

*Here.* The equivalents are the invariants in `FUNCTIONALITY.md` §3, and
above all **L1: the shell renders verifier output; it never parses wire
bytes**. A PR arguing that "just this once" it is easier to read a
`seq` out of the header directly is closed, not debated. Changing L1 is an
ADR and a lead-maintainer decision.

### 1.3 Verify on a fresh clone with the exact CI steps

The upstream discipline, stated in ADR-0002: clone → install → ruff →
pytest, and commit exactly what passed. Not "it works on my machine with
my venv."

### 1.4 Byte-verify anything committed through tooling

Files created by a tool are confirmed byte-for-byte against the intended
content before the PR is trusted. This has caught real drift.

### 1.5 Dependencies are argued for, not added

Base install minimal; anything heavy or platform-specific behind an opt-in
extra. A new runtime dependency is called out in the PR body and justified
— why needed, why this one, what licence.

*Here.* The base sidecar carries FastAPI, uvicorn, pydantic, platformdirs
and `palimpsests[pala]`. Three groups sit behind extras rather than in it:
`[report]` for the PDF renderer, so the report path stays testable as JSON
without one installed; `[keyring]` for the OS keychain anchor source, so a
plain install does not require a Secret Service daemon; and, later, the
network anchor clients — which also means a plain install literally cannot
reach the network.

### 1.6 No SDK retry layers in adapters

Plain `httpx`, `max_retries=0`. Retry policy is a caller concern, not an
adapter default. Relevant here for the Phase-3 Rekor/TSA clients.

### 1.7 Rule of three before extraction

Upstream extracted `ProcessManager` on the *second* concrete lifecycle,
having committed to the rule. Do not build an abstraction for one caller.

---

## 2. Testing

### 2.1 Tests ship with behaviour, in the same PR

Bug fixes come with a test that fails before the fix. The reviewer
confirms the tests are *meaningful*, not coverage padding.

### 2.2 Coverage gate: statement ≥ 90, branch ≥ 80

Enforced by a script (`scripts/coverage_gate.py`), not by an argument in
a job name — so the thresholds can change without re-pointing branch
protection. Branch coverage is on in `[tool.coverage.run]`.

*Here.* The gate applies to `auditor_sidecar`. The frontend has its own
target once tests exist; it is not folded into the same number.

### 2.3 Isolate every global singleton with an autouse reset fixture

Upstream's `conftest.py` resets the audit-log singleton and the registry
after *every* test, autouse, so a test that never requests the fixture
still starts clean. It also redirects keychain access to an in-memory slot
so no test can touch the developer's real anchor.

*Here.* Directly applicable and non-negotiable: the session store, the
anchor-profile store, and the keychain. A test that reads the developer's
real OS keychain is a bug even when it passes.

### 2.4 Test the denial path, not just the happy path

Security-sensitive code — path safety, capability gating, deserialisation
of untrusted input — is tested for the escape and the refusal explicitly.

*Here.* The sidecar reads arbitrary paths on request. Tests must cover:
missing token → 401; wrong token → 401; path traversal; a non-PALA file; a
zero-byte file; a file that changes on disk mid-session.

### 2.5 Differential testing against an independent implementation

Upstream's strongest test: the production codec is pitted against the
standalone reference implementation that imports nothing from the package.
Byte-identical headers, identical hashes, identical Merkle roots, and —
the sharp part — **the same verdict on the same mutation**. Divergence
means one has drifted from the prose, and the prose decides which.

*Here.* Auditor's version of this is the **contract test**: the sidecar's
JSON compared against a direct `AuditReader` call in the same process,
catching any field the sidecar invented; and the **golden-vector test**:
Auditor's rendered verdict against `palimpsests audit verify` exit codes
on every published vector. If those disagree, Auditor is wrong by
definition.

### 2.6 Property tests where an equivalence is claimed

Upstream pins `batch(N) ≡ N × incremental` as a property test, because the
§7.1 rules exist in one place precisely so the two paths cannot drift.

*Here.* The equivalence to pin is: the report rebuilt from a fresh reader
run equals the report produced by the session. And: same file + same
anchor → identical bytes except the isolated `checked_at` field.

### 2.7 A fake backend for anything untestable in CI

Upstream cannot run the native backend in CI (needs a GGUF model and a
toolchain), so the scheduler is tested against a fake backend behind a
sharp interface, and the thin native layer is tested with mocks and
validated separately on hardware.

*Here.* The same split, one layer up: CI cannot verify appearance.
Frontend logic is tested against **recorded sidecar responses**; the
appearance is validated in a scheduled live-desktop session. The boundary
is sharp and stated, not fudged.

### 2.8 Fuzz the untrusted-input validator

Upstream added an Atheris harness on the KV-state frame validator after
correctly concluding that fuzzing the canonicalisation helpers would find
little — the audit *redirected the target*, which is the lesson.

*Here.* The fuzz target is the sidecar's request-parameter surface (path
handling, seq ranges, filter strings), not the PALA-1 codec — that one is
already fuzzed upstream and Auditor must not re-implement it.

---

## 3. Verification and CI

### 3.1 One fan-in check for branch protection

Upstream protects a single job named `ci-complete` that runs `if:
always()`, `needs` every other job, and fails unless all succeeded.

*Why.* Requiring individual jobs is brittle twice over: matrix job names
change when the matrix changes, and a required context that stops being
reported leaves every PR stuck on "Expected — waiting for status" with no
failure to debug. This has happened.

*Here.* Adopted verbatim in `.github/workflows/ci.yml`.

### 3.2 Least-privilege token permissions, actions pinned by SHA

`permissions: contents: read` at the top level; each job additively grants
only the one scope it needs; every action pinned to a commit SHA with the
version in a trailing comment. A compromised or retagged action then cannot
write to the repository, and cannot change under a tag that used to point
somewhere else.

### 3.3 Lint without an editable install

*Why.* A real, expensive bug: with the package pip-installed via `-e .`,
ruff's isort classifies it as third-party and regroups imports differently
than the src-layout heuristic does — passing locally, failing only in CI.
Two independent fixes are applied together: lint a plain checkout, and set
`no-sections` in the isort config so grouping is deterministic either way.

### 3.4 Pin the linter exactly

`ruff==<exact>` in the dev extra and in CI. A lower bound is not enough;
lint behaviour changes between patch releases.

### 3.5 Determinism as a merge-blocking check

Upstream builds the sdist and wheel **twice** and requires bit-identical
bytes, with `SOURCE_DATE_EPOCH` pinned to the commit date.

*Here.* The analogue is report determinism (§2.6), run as its own CI job.
A change that makes two reports of the same file differ is not
acceptable, for the same reason a non-reproducible build is not: a diff
between two reports must be a diff between two *logs*.

### 3.6 Regenerate the fixtures and compare byte-for-byte

Upstream's `pala-vectors` job regenerates the committed test vectors from
the reference implementation and `cmp`s them. If it fails, either the
reference drifted or the vectors were hand-edited — **both make the
specification unfalsifiable, which is the one property it cannot lose.**

*Here.* Two instances. The `api-client` job regenerates the OpenAPI schema
and the frontend's TypeScript types and diffs them against what is
committed, so a hand-edited generated client cannot survive a run. Auditor's
mutation fixtures will be generated and regenerated the same way. A
hand-edited generated artifact is the same failure in miniature: it makes
the guarantee unfalsifiable.

### 3.7 SAST on every push

Bandit merge-blocking upstream. Here: Bandit for the sidecar, plus
`npm audit` / CodeQL for the frontend and `cargo audit` for the shell.

### 3.8 Reviews judge cumulative effect

"A series of individually-small PRs that together alter a security
boundary is reviewed as the boundary change it is." Directly relevant to
the air-gap layers and to L1: no single PR will announce that it is
turning the shell into a parser.

---

## 4. Documentation

### 4.1 One document per question, and they cross-link

Upstream's set, and what each is *for*:

| Document | Answers |
|---|---|
| `README.md` | What is this, and what does it not claim? |
| `ARCHITECTURE.md` | Why is the code shaped this way? |
| `CONTRIBUTING.md` | How do I land a change? |
| `GOVERNANCE.md` | Who decides, and who has access? |
| `docs/REVIEW.md` | What does a reviewer actually check? |
| `SECURITY.md` | What is the reporting process, and what is guaranteed? |
| `docs/THREAT_MODEL.md` | Which attacker, which capability, detected or not? |
| `docs/ASSURANCE-CASE.md` | Claims → arguments → evidence, with defeaters |
| `docs/adr/` | Decisions that are settled and why |
| `CHANGELOG.md` | What changed, per release |
| `RELEASING.md` | How an artifact is cut and how you verify it |

*Here.* Same set, plus `FUNCTIONALITY.md` (the functional contract) and
`DEVELOPMENT-PLAN.md`. `docs/THREAT_MODEL.md` and
`docs/ASSURANCE-CASE.md` arrive at the close of Phase 1 — they need
something to make claims about.

### 4.2 Docs change in the same PR as the behaviour

A reviewer checks it. Documentation drift is a review failure, not a
backlog item.

### 4.3 Assurance case: claims, arguments, evidence — and residuals

Every claim upstream is paired with what it does **not** cover, and a
`Defeaters` table names the conditions that would break each one. The
top-level claim contains the load-bearing phrase *"materially supports,
but does not by itself satisfy"*.

*Here.* Auditor's version writes itself: it attests that a check was run.
Its defeaters include "an anchor source the operator does not control",
"a witness log that only proves what this desk saw", and — first in the
table — "reading a green verdict as a compliance certification".

### 4.4 Name the residual in the same breath as the claim

Not a separate limitations page nobody reads. Upstream puts the residual
directly under each claim, in the same section.

### 4.5 Comments explain *why*, especially for scar tissue

The upstream codebase is full of comments recording a specific failure:
why `no-sections` is set, why `ci-complete` exists, why the anchor file is
written atomically ("a torn anchor file is worse than a stale one"), why
the independent verification runs are excluded from the linter. Each one
prevents a future maintainer from "cleaning up" a load-bearing oddity.

*Here.* Every trap in `ENVIRONMENT.md` §5 gets its comment at the point of
use, not only in the doc.

### 4.6 Docstrings state the design boundary, not the mechanics

`reader.py`'s module docstring says what the module *is for* and what it
must never do: "Every fact a shell renders comes from `AuditReader`;
shells never parse wire bytes." That sentence in that file is why L1 is
implementable.

### 4.7 Describe what a change does, not how revolutionary it is

Upstream states this as a ground rule: measure before you claim, and never
advance a claim ahead of its evidence.

### 4.8 Honest boundaries are stated, not omitted

Upstream volunteers what its release provenance does *not* cover, which
dependencies fall outside its bill of materials, and that small-team review
is a structural limit. Volunteering a boundary is what makes the rest
credible.

### 4.9 Licensing is machine-verifiable

`REUSE.toml` declares copyright and licence for every path; `reuse lint`
runs in CI. Note the upstream refinement worth copying: the spec and its
reference implementations are **CC0-1.0**, overriding the Apache catch-all,
so a third party implementing the format independently is not bound by
Apache terms.

*Here.* Auditor has no spec of its own, so the tree is single-licensed
Apache-2.0 — except `schemas/**`, which `REUSE.toml` marks **CC0-1.0** for
exactly the same reason: a third party must be able to write a client, or a
bundle verifier, without touching our licence. That already covers the
generated OpenAPI document, and it will cover the report and bundle schemas
when they land.

---

## 5. Measurement discipline

Carried over verbatim, because it applies to a UI as much as to a
scheduler:

- **Figures from external sources are hypotheses until measured here.**
- **A benchmark is only worth running if it can disappoint us.**
- Adopt the *logic* of a result now; flag its *numbers* "to verify".

*Here.* The performance target in `FUNCTIONALITY.md` §19 (100 MB / ~1M
records, verify under 10 s, timeline interactive) is a **target, not a
claim**, until it is measured on a stated machine and written down with
the machine named.

---

## 6. The checklist this collapses into

For every PR in this repository:

1. Non-draft PR, non-author approval, `ci-complete` green — all three
   enforced by the ruleset since 17 August 2026, not requested.
2. Commits signed off (DCO).
3. Tests ship with the behaviour; denial paths covered.
4. Coverage gate met.
5. `ruff` clean at the pinned version; `reuse lint` clean.
6. No new dependency without a justification in the PR body.
7. Docs updated in the same PR.
8. No wire-parsing outside `pala_seam.py` (the CI test enforces it).
9. Any claim in a doc has evidence behind it, or is marked as a target.
10. Any boundary the change introduces is stated, not left implicit.
