#!/usr/bin/env bash
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0
#
# ADR-0001 made mechanical.
#
# Every PALA-1 fact this application renders comes from a `palimpsests`
# verifier call. Nothing in this repository parses, decodes, hashes or
# interprets container bytes — because a shell that parses is a second
# implementation of the format with no specification, no vectors and no
# differential test, and it will eventually render "valid" where the
# verifier says no.
#
# This script fails the build if a wire-parsing primitive appears in any
# source file outside the one seam module.
#
# If you are here because this failed: the answer is almost never to add an
# exception. It is either to call the package for the fact you need, or —
# when the package cannot yet produce it — to open a pull request upstream
# against Assault-Consulting/Palimpsests. See DEVELOPMENT-PLAN.md, Track U.

set -euo pipefail

SEAM="sidecar/auditor_sidecar/pala_seam.py"

# The file list is built explicitly with `git ls-files` rather than handed to
# `git grep` as a pathspec.
#
# This is not a style choice. Pathspec globs of the form `src/**/*.rs` do NOT
# match `src/peek.rs` — the `**/` requires an intervening directory — so an
# earlier version of this scan silently examined zero Rust and TypeScript
# files while reporting success. A guard that passes because it looked at
# nothing is worse than no guard, and this one is the mechanical half of
# ADR-0001.
SOURCE_RE='\.(py|rs|ts|tsx)$'

# Directories that contain source. Config and documentation are deliberately
# out of scope: a rule that punished the word "PALA-1" in a docstring would
# teach people to stop explaining the format, which is the opposite of what
# this repository wants.
TREES=(sidecar src src-tauri/src scripts)

# Paths exempt from the scan, each with its reason. Adding to this list is a
# reviewed decision, not a convenience — see docs/REVIEW.md.
#   the seam            — the point of the exercise
#   sidecar/tests/      — tests may construct fixture chains
#   src/api/generated/  — generated from the OpenAPI schema
EXEMPT_RE="^(${SEAM}|sidecar/tests/|src/api/generated/)"

# Primitives that indicate byte-level interpretation of a container.
#
# Each pattern targets a CODE form, never a prose word. The distinction is
# load-bearing: `PALA` as a bare word appears in every honest docstring, while
# `b"PALA"` is the wire magic and has no business outside the seam.
PATTERNS=(
  'struct\.(un)?pack'                 # binary field extraction
  'int\.from_bytes'                   # int/bytes reinterpretation
  'b["'\'']PALA'                      # the wire magic as a byte literal
  '\bMAGIC\b'                         # ... or imported by name
  '\brecord_hash\b'                   # re-deriving a record identity
  'sha256\('                          # re-deriving any digest over log bytes
  'blake2[bs]\('                      #   "
  'import hashlib'                    #   "
  'FIXED_HEADER_LEN'                  # frozen offsets, copied
  'decode_tlvs'                       # body decoding outside the package
  '\bread_exact\b'                    # Rust byte reads
  'new (DataView|Uint8Array)'         # TypeScript byte reads
)

mapfile -t FILES < <(
  git ls-files -- "${TREES[@]}" 2>/dev/null \
    | grep -E "$SOURCE_RE" \
    | grep -Ev "$EXEMPT_RE" || true
)

if [ "${#FILES[@]}" -eq 0 ]; then
  # Legitimate before the scaffold lands, and a silent failure afterwards.
  # Say which it is rather than printing "ok" over an empty set.
  echo "note: no source files to scan yet (trees: ${TREES[*]})"
  exit 0
fi

fail=0

for pattern in "${PATTERNS[@]}"; do
  if hits=$(grep -n -I -E "$pattern" "${FILES[@]}" 2>/dev/null); then
    echo "FAIL: wire-parsing primitive outside ${SEAM}"
    echo "      pattern: ${pattern}"
    echo "${hits}" | sed 's/^/      /'
    echo
    fail=1
  fi
done

# The seam must stay the only importer of the package.
if hits=$(grep -n -I -E '^[[:space:]]*(from|import)[[:space:]]+palimpsests' \
            "${FILES[@]}" 2>/dev/null); then
  echo "FAIL: palimpsests imported outside ${SEAM}"
  echo "${hits}" | sed 's/^/      /'
  echo
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "ADR-0001: the shell renders verifier output; it never parses wire bytes."
  echo "See docs/adr/0001-the-shell-renders-verifier-output.md"
  exit 1
fi

echo "ok: ${#FILES[@]} source file(s) scanned, no wire-parsing outside ${SEAM}"
