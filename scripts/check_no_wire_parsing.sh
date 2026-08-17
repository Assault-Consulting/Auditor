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
# This script fails the build if a wire-parsing primitive appears anywhere
# outside the one seam module. It is deliberately blunt: a false positive
# costs a comment or a rename, a false negative costs the product's whole
# proposition.
#
# If you are here because this failed: the answer is almost never to add an
# exception. It is either to call the package for the fact you need, or —
# when the package cannot yet produce it — to open a pull request upstream
# against Assault-Consulting/Palimpsests. See DEVELOPMENT-PLAN.md, Track U.

set -euo pipefail

SEAM="sidecar/auditor_sidecar/pala_seam.py"

# Searched trees. Rust and TypeScript are included on purpose: the rule is
# about the repository, not about Python.
ROOTS=(sidecar src src-tauri/src scripts)

# Primitives that indicate byte-level interpretation of a container.
PATTERNS=(
  'struct\.(un)?pack'                 # binary field extraction
  'from_bytes\('                      # int/bytes reinterpretation
  '\bPALA\b'                          # the wire magic
  'record_hash'                       # re-deriving a record identity
  'sha256'                            # re-deriving any digest over log bytes
  'blake2'                            #   "
  'hashlib'                           #   "
  'FIXED_HEADER_LEN'                  # frozen offsets, copied
  'prev_hash\s*=\s*'                  # reconstructing chain linkage locally
  'read_exact'                        # Rust byte reads
  'DataView|Uint8Array'               # TypeScript byte reads
)

# Paths exempt from the scan, with the reason stated. Adding to this list is
# a reviewed decision, not a convenience — see docs/REVIEW.md.
EXCLUDES=(
  ":(exclude)${SEAM}"                          # the seam itself: the point
  ":(exclude)sidecar/tests/**"                 # tests may build fixtures
  ":(exclude)scripts/check_no_wire_parsing.sh" # this file names the patterns
  ":(exclude)src/api/generated/**"             # generated from OpenAPI
)

fail=0

for pattern in "${PATTERNS[@]}"; do
  if hits=$(git grep -n -I -E "$pattern" -- "${ROOTS[@]}" "${EXCLUDES[@]}" 2>/dev/null); then
    echo "FAIL: wire-parsing primitive outside ${SEAM}"
    echo "      pattern: ${pattern}"
    echo "${hits}" | sed 's/^/      /'
    echo
    fail=1
  fi
done

# The seam must stay the only importer of the package.
if hits=$(git grep -n -I -E '^\s*(from|import)\s+palimpsests' \
            -- "${ROOTS[@]}" ":(exclude)${SEAM}" ":(exclude)sidecar/tests/**" 2>/dev/null); then
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

echo "ok: no wire-parsing primitives outside ${SEAM}"
