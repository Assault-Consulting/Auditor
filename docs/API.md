<!--
SPDX-FileCopyrightText: Assault Consulting
SPDX-License-Identifier: Apache-2.0
-->

# The sidecar API — conventions, not contents

**This document does not list endpoints or fields.** `schemas/openapi.json`
does that, it is generated from the models, and CI fails when the two
disagree. A second listing here would be a second source of truth, and it
would drift — as three sections of `FUNCTIONALITY.md` did before anyone
noticed.

What lives here is the part a schema cannot carry: the rules the surface
obeys, and why. A person adding an endpoint needs those before they choose a
status code; a person consuming the API needs them before they decide what a
field means.

Two headings, because the distinction matters more than it looks.

---

## Part 1 — inherited, not invented

These rules are the **package's**, and Auditor's job is to pass them through
without smoothing them. Where this section and `palimpsests` disagree, the
package is right and this document is stale.

### The three outcomes of an anchor source

`answered`, `absent`, `error`. Never two.

- **absent** — the source has nothing. Normal, and not a failure.
- **error** — the source exists and could not be read: a corrupt anchor
  file, a keychain that will not unlock, a machine with no secret store.

Merging them would hide a corrupt anchor behind "no anchor configured".
Those call for different actions from an operator, so they stay apart from
the verifier all the way to the screen.

### Completeness is a tri-state

`complete_to_anchor` is `true`, `false`, or **`null`**.

Null means **no anchor answered** — either none was configured, or every
source in the profile was absent — so the question was never asked. It is
not a pass, and a consumer that renders it as one has introduced a defect
this API took care to make impossible.

### Provenance never travels apart from the claim

`anchor` and `anchor_attempts` are **required** fields on a verification
response, not optional extras. A completeness answer is worth exactly as
much as the anchor behind it.

Every source consulted is reported, including the ones that were absent or
failed. The answering source alone would let a consumer present it as *the*
anchor while silently skipping one the operator believed was authoritative.

### A diagnosis describes; it does not accuse

`diagnosis.pattern` is the machine-readable key and a consumer may drive
visuals from it. `diagnosis.narrative` is the **package's own sentence,
carried verbatim** — a consumer may render a localised sentence beside it,
never instead of it, or the artifact stops saying what the verifier said.

### `chain_ok` is not, by itself, an answer

A container cut mid-record reports `chain_ok: true` — every record the
reader could read does link to its predecessor — with the truncation carried
in `diagnosis`. Rendering `chain_ok` alone would put a green tick on a
truncated file: truthful about the field, misleading about the file.

The answer to "is what I hold internally consistent?" is `chain_ok` **and**
the absence of a diagnosis.

### Unknown is reported, never rejected

Records with an unrecognised type or format version appear in
`uninterpretable`. The verifier not understanding a record is not the same
as the record being wrong, and the API keeps the difference.

---

## Part 2 — ours

These are this repository's decisions. Argue with them here.

### There is no "valid" field, and there will not be

Three questions have three answers, one of which can be "not asked". Any
field collapsing them would be the shell deciding what a verdict means,
which is the one thing ADR-0001 exists to prevent.

A test greps responses for `valid`, `ok`, `passed`, `verdict` and `status`,
so the convenience field a UI developer will eventually and reasonably ask
for cannot arrive quietly.

### Status codes carry meaning, not habit

| Code | When | Why not something else |
|---|---|---|
| **422** | the path resolved and the bytes are not a chain | 404 would say the file is missing; 500 would say this service is broken. Both send the operator to the wrong place |
| **404** | no such session, or no such anchor profile | Never a silent fallback to "no anchor": that answers a question the caller did not ask and labels it as theirs, and *not checked* looks identical whether it was requested or substituted |
| **409** | the file changed under an open session; or an attempt to redefine the `none` profile | A verdict about bytes that have since changed is worse than no verdict, because it looks like one |
| **503** | the machine has no usable secret store | The service is fine. A 500 would send the operator to our logs for something they can fix |
| **401** | missing or wrong session token | **Returned, not raised.** An `HTTPException` raised inside middleware bypasses the exception handlers and surfaces as 500 — reporting an authentication refusal as a server fault |

### Identity is established before, and separately from, any verdict

`POST /session` says what the artifact **is** — digest, size, record count,
verifier identity — and says nothing about whether it verifies.

A reader of a report must be able to confirm they hold the same bytes the
check ran against **whether or not that check passed**. If identity were a
field inside a verdict, that would stop being possible exactly when it
matters most.

For the same reason `subject_sha256` is repeated on the verification
response: the pairing has to survive being copied into a report, a ticket or
an email.

### The empty anchor profile is a real profile

`none` exists, is listed, and cannot be redefined or deleted (409 for both).

Verifying without an anchor is the honest default, not a degraded mode — it
produces "not checked", a truthful answer to a question nobody asked. A
profile someone quietly redefined would make every subsequent "not checked"
a lie.

### Verification is cached per session **and** profile

The same container checked against two anchors is two answers, and both are
legitimate: an operator who tries the keychain, finds nothing, and then
pastes a head by hand has asked two questions rather than corrected one.

Caching is a correctness measure before it is a performance one. Two runs
that disagreed would mean a verdict was shown that can no longer be
reproduced.

### Every route but `/health` requires the session token

The sidecar reads arbitrary paths on request, so the token is the trust
boundary (ADR-0002). CORS narrows browser access and is **never** relied on
as protection — it is enforced by browsers, and any local process with
`curl` ignores it.

`/health` is exempt because the shell polls it to decide when the sidecar is
up, and a liveness probe that can fail for two different reasons cannot
distinguish them. It discloses versions and nothing else.

### One route writes, and the boundary still holds

`PUT /anchors/keychain` stores a head in **Auditor's own anchor store**,
never in an audited container. The read-only rule is about not touching
evidence, not about never writing a byte.

Stated here as well as in the route, so it is not read later as a precedent
for writing somewhere else.

### Descriptions belong on the model

Field descriptions are generated into the OpenAPI schema and from there into
the TypeScript client — so the reasoning arrives where someone is deciding
how to render the value, rather than in a specification they may never open.

That is why `complete_to_anchor` says, in capitals, that null is not a pass.
It is the last place able to say so.

---

## When this document is wrong

It describes conventions, and conventions drift — three sections of
`FUNCTIONALITY.md` described a command that could not take a file, exit codes
that omitted the one that matters, and a CI scan that had been narrowed
months earlier.

There is no mechanical check for prose. The working rule: **a pull request
that changes a status code, adds a field that can be null, or adds a route
grep this file for the thing it changed.** That is discipline rather than a
gate, and it is worth naming as such instead of pretending otherwise.
