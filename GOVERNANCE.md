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

## Review and merge

`main` is protected by a repository ruleset. In force:

- **Direct pushes are blocked.** Every change arrives as a pull request,
  documentation included.
- **One approval from someone other than the author** is required before
  merge. GitHub does not permit self-approval, so this is enforced
  mechanically rather than requested.
- **The `ci-complete` status check must pass**, and the branch must be up to
  date with `main` before merging. `ci-complete` is a single fan-in job that
  aggregates lint, the test matrix, the ADR-0001 scan, the coverage gate and
  the REUSE check, and it is the only context branch protection points at —
  matrix job names change when the matrix changes, and a required context
  that stops being reported leaves every pull request stuck on
  "Expected — waiting for status" with no failure to debug.
- **Stale approvals are dismissed** when new commits are pushed, so an
  approval always refers to the code that merges.
- **Conversations must be resolved** before merge.
- **Force pushes and branch deletion are blocked.**
- **The bypass list is empty.** The rules apply to repository owners, which
  is the difference between a protected branch and a claim about one.

### The measurement window

The ruleset was enabled on **17 August 2026**. That date is the anchor for
any review-coverage figure this project reports, and the boundary is stated
precisely rather than rounded in our favour:

- **Outside the window:** the fifteen commits that created the repository
  skeleton, pushed directly to an unprotected `main`, and pull requests #1
  through #5, which were opened and merged by the lead maintainer without a
  second approver. That period is described in `CHANGELOG.md` and is not
  being rewritten to hide it.
- **Inside the window:** everything from pull request **#6** onward. #6 is
  the first change in this repository to require, and receive, an approval
  from someone other than its author.

No review-coverage figure is reported for the period before the ruleset, and
none should be inferred from the care taken in it. A control that was not
enforced cannot be evidenced afterwards.

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
  [`docs/REVIEW.md`](docs/REVIEW.md) for what a reviewer checks. As a small
  team, review depth is bounded by there being two of us — a structural
  limit acknowledged openly, not misrepresented.

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
- **Anything touching the session token or the origin allowlist.** ADR-0002
  puts the trust boundary on the token; widening the allowlist is a security
  review, not a configuration tweak.
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
