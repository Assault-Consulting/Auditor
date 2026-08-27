#!/usr/bin/env bash
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0
#
# Run every CI check against the bytes that are actually on the branch.
#
# CONTRIBUTING.md has said "verify on a fresh clone with the exact CI steps"
# since the first commit. It was a request, and requests get skipped when the
# working tree looks fine. This is the same instruction as a command.
#
# It exists because two failures in one pull request came from the gap
# between "what I checked" and "what I pushed":
#
#   1. ruff had already fixed a file on the working copy, and the version
#      committed through the API was the pre-fix text. Local: clean. Branch:
#      I001. The two never met until CI ran.
#   2. the locally-installed ruff had drifted a patch version ahead of the
#      pinned one, so "lint passes" was a statement about a different linter.
#
# Both are invisible from inside the working tree, which is why this clones.
#
#   ./scripts/verify_branch.sh                 # the current branch
#   ./scripts/verify_branch.sh some/branch     # any branch
#
# Requires the dev dependencies to be installed in the active environment.

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REMOTE="${REMOTE:-origin}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# --- the pinned linter, before anything that depends on it ------------------
#
# Checked first because a lint result from the wrong version is not a lint
# result. The pin lives in one place; this reads it rather than repeating it.
step "toolchain"
PINNED="$(grep -oE 'ruff==[0-9]+\.[0-9]+\.[0-9]+' "$REPO_ROOT/sidecar/pyproject.toml" | head -1 | cut -d= -f3)"
ACTUAL="$(ruff --version | awk '{print $2}')"
printf 'ruff pinned : %s\nruff active : %s\n' "$PINNED" "$ACTUAL"
[ "$PINNED" = "$ACTUAL" ] || fail "ruff version mismatch — run: pip install ruff==$PINNED"

# --- what is on the branch, versus what is in front of you ------------------
step "fetching $BRANCH from $REMOTE"
git -C "$REPO_ROOT" fetch --quiet "$REMOTE" "$BRANCH"
git -C "$REPO_ROOT" archive "$REMOTE/$BRANCH" | tar -x -C "$WORK"
printf 'branch head : %s\n' "$(git -C "$REPO_ROOT" rev-parse --short "$REMOTE/$BRANCH")"

# The specific defect that motivated this script: a file edited locally and
# committed through a whole-file tool, where the two silently diverge. Report
# it as information rather than an error — the working tree is legitimately
# ahead while you are still writing — but never let it pass unmentioned.
#
# EVERY tracked file, not a list of extensions. The original checked five
# source suffixes, which left the three files drift has actually happened on
# invisible to it: schemas/openapi.json three times, styles.css once, and
# docs/API.md once. A drift check with a filter is a drift check that reports
# clean on whatever the filter forgot — and the forgotten file is the large
# generated one nobody re-reads, which is exactly where hand-carrying goes
# wrong.
#
# Comparison runs both ways. A file on the branch and not in the tree is the
# ordinary case while rebasing; a file in the TREE and not on the branch is
# the dangerous one — it means something was written locally and never
# committed, and every check just run against it proved nothing about what
# CI will see.
step "working tree vs branch"
DRIFT=0
while IFS= read -r f; do
  if [ ! -f "$REPO_ROOT/$f" ]; then
    printf 'only on branch : %s\n' "$f"
    DRIFT=1
  elif ! cmp -s "$WORK/$f" "$REPO_ROOT/$f"; then
    printf 'differs        : %s\n' "$f"
    DRIFT=1
  fi
done < <(cd "$WORK" && find . -type f -not -path './.git/*' | sed 's|^\./||')

while IFS= read -r f; do
  [ -f "$WORK/$f" ] || {
    printf 'only in tree   : %s\n' "$f"
    DRIFT=1
  }
done < <(git -C "$REPO_ROOT" ls-files)

[ "$DRIFT" -eq 0 ] && echo "no drift: the branch holds what you have been testing"

# --- the checks, in CI's order ----------------------------------------------
cd "$WORK"

# Point Python at the EXTRACTED tree, ahead of anything already installed.
#
# Without this the script has the very defect it was written to prevent. An
# editable install (`pip install -e sidecar`) registers the working copy on
# sys.path, so `pytest` run from this temporary tree imports auditor_sidecar
# from wherever that install points — and happily reports a pass for code
# that is not on the branch. CI does not have the problem because it installs
# from its own checkout; a script that clones and then imports someone else's
# tree is worse than no script, because it produces a confident wrong answer.
export PYTHONPATH="$WORK/sidecar${PYTHONPATH:+:$PYTHONPATH}"
IMPORTED="$(python -c 'import auditor_sidecar; print(auditor_sidecar.__file__)')"
case "$IMPORTED" in
  "$WORK"/*) printf 'importing    : %s\n' "$IMPORTED" ;;
  *) fail "auditor_sidecar resolves to $IMPORTED, not the extracted tree" ;;
esac

step "lint"
ruff check --output-format=full sidecar scripts

step "generated client is current"
python scripts/generate_api_client.py --check

step "no wire parsing outside the seam"
# git ls-files needs a repository; the archive is a plain tree, so give it one.
git init --quiet . && git add -A >/dev/null 2>&1
bash scripts/check_no_wire_parsing.sh

step "tests"
pytest sidecar -q

step "coverage gate"
pytest sidecar -q --cov=auditor_sidecar --cov-report=json >/dev/null
python scripts/coverage_gate.py

step "reuse"
if command -v reuse >/dev/null 2>&1; then
  reuse lint | tail -3
else
  echo "skipped: reuse not installed (pip install reuse)"
fi

printf '\n'
if [ "$DRIFT" -ne 0 ]; then
  echo "PASSED — but your working tree differs from the branch (listed above)."
  echo "CI will run the branch. Push before trusting this result."
else
  echo "PASSED — the branch is what CI will see."
fi

# Not run here: pnpm build and the cargo legs. They need Node and a Rust
# toolchain, and a script that half-runs them would report a pass that means
# less than it looks like. Run them yourself, or let the matrix do it.
