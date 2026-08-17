<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# Governance

How decisions are made on Palimpsests Auditor, and who makes them. Short,
and honest about scale: this is a small, commercially-backed open-source
project, and the governance below is the real one.

This document covers the **desktop shell** in this repository. The format,
the codec and the verifier are governed in
[Palimpsests](https://github.com/Assault-Consulting/Palimpsests).

## Stewardship

Developed and maintained by **Assault Consulting** (Kyiv), free and open
source under **Apache-2.0**. The commercial entity behind the project is
stated plainly rather than obscured. The project is maintainer-led;
authority rests with the maintainers, and a **lead maintainer** holds the
final decision.

## Roles

- **Users** — anyone running the application.
- **Contributors** — anyone opening a PR or issue. No formal status
  required; start with [CONTRIBUTING.md](CONTRIBUTING.md).
- **Maintainers** — hold merge rights; review PRs, cut releases, triage
  security reports.
- **Lead maintainer** — final decision authority on architecture, scope
  and releases, and steward of the project's stated boundaries.

## Members and access

| Member | Role | Access |
|---|---|---|
| [@andreysparish](https://github.com/andreysparish) | Lead maintainer | Repository admin; release authority |
| [@olksandrvertel-arch](https://github.com/olksandrvertel-arch) | Co-maintainer | Repository admin; review |

`main` is protected: direct pushes are blocked, and every change —
**including documentation** — requires a pull request with at least one
approval from someone other than the author, plus a passing status check,
before merge.

The bootstrap commits that created this repository skeleton predate that
protection and are the only changes in this history without non-author
review. The date protection is enabled is the measurement anchor for any
review-coverage figure this project reports; this section is updated with
that date when it is set, and the figure is never stated ahead of it.

The canonical required status context is the single fan-in check
**`ci-complete`**, which aggregates lint, the test matrix, the coverage
gate, the no-parsing check, report determinism and the golden-vector
agreement. Protection points at that one stable context rather than at
individual job names, which can be renamed or — in a matrix — multiply.

## Becoming a maintainer

By sustained, quality contribution and demonstrated alignment with the
project's boundaries — chiefly that **the shell renders verifier output
and never parses wire bytes**, and the no-overclaim discipline. New
maintainers are invited by existing maintainers.

## How decisions are made

- **Lazy consensus.** A proposal with no sustained objection proceeds.
  Unresolved disagreement goes to the lead maintainer.
- **Architecture and scope.** Decisions touching a load-bearing invariant
  are recorded as ADRs in [`docs/adr/`](docs/adr/). Three constraints are
  settled and are not re-litigated per PR: **the shell never parses wire
  bytes**; **the application is read-only with respect to every audited
  container**; **the product attests to a check and certifies nothing**.
- **Code review.** All changes land via PR against protected `main`; see
  [`docs/REVIEW.md`](docs/REVIEW.md) for what a reviewer checks. As a
  small team, a change may be authored and reviewed within a narrow group
  — a structural limit acknowledged openly, not misrepresented.

## Decisions that need special care

- **Security.** Reported privately per [SECURITY.md](SECURITY.md) and
  handled by the maintainers, who agree a disclosure timeline with the
  reporter.
- **Anything that opens a network socket.** The application ships
  air-gapped by construction: there is no network anchor source in the
  MVP, and both enforcement layers (the webview capability set and the
  sidecar outbound guard) exist before the first one is needed. A change
  that opens outbound traffic is a lead-maintainer decision and must
  demonstrate both layers still hold.
- **Anything touching `pala_seam.py`.** That file is the entire reason
  invariant L1 is enforceable. Changes to it get the scrutiny a trust
  boundary gets.
- **Releases.** Cut by a maintainer per `RELEASING.md`. Installer signing
  requires certificates; until those exist, releases are source-only and
  say so.

## Licensing of contributions

Inbound equals outbound, Apache-2.0, **no CLA**, DCO sign-off
([CONTRIBUTING.md](CONTRIBUTING.md)). The report and bundle schemas are
CC0-1.0 by deliberate exception, so an independent verifier can be written
against them freely; see `REUSE.toml`.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies to all project spaces and
is enforced by the maintainers.

## Funding and independence

Backed by Assault Consulting. No external sponsor directs the roadmap.
Priorities are set in the open — issues and
[`DEVELOPMENT-PLAN.md`](DEVELOPMENT-PLAN.md).

## Changing this document

By pull request like any other change, and a lead-maintainer decision.
Material changes are noted in [CHANGELOG.md](CHANGELOG.md).
