#!/usr/bin/env bash
# kickoff-mint-branch.sh — attach the run's branch to the run's worktree,
# idempotently. kickoff's mint step, called by both coordinator variants
# through the narrow grant `bash scripts/kickoff-mint-branch.sh *`.
#
# The validation envelope is the safety property: a shell grant matches a
# command string, not a target, so the raw alternative (`git -C * checkout -b *`)
# could aim at the main checkout and flip the hourly scheduled runs off `main`.
# Hence the hard rules below — the mint target must be the root of a LINKED
# worktree of its own repo (the main checkout is never a mint target), and the
# branch must equal the worktree basename (the de-facto run naming invariant)
# and pass a shell-metacharacter-free refname regex. Arguments are only ever
# used quoted and never eval'd.
#
# Network surface: none. No credentials (agent-board-coord-gate.sh's posture).
# Callers run `bash scripts/kickoff-mint-branch.sh <worktree-dir> <branch>`
# from any cwd; nothing here resolves against $0 except the usage line.
#
# Verdict — exactly one stdout line, the coordinators' state machine keys on it:
#   MINTED <branch> <sha>  exit 0  branch created at the worktree's current HEAD,
#                                  so commits made on detached HEAD are carried
#   EXISTS <branch> <sha>  exit 0  branch already exists: nothing is checked out,
#                                  a resume run is a no-op (sha = branch tip)
#   REJECT <reason>        exit 1  any validation refusal or checkout failure,
#                                  target untouched
#   usage line             exit 2  wrong arity

set -euo pipefail

# No leading `-` (never an option string), no shell or git-special characters
# (`;`, space, `~`, `*`, `!` all fall out). Git's stricter check-ref-format
# still applies at checkout time; its refusal surfaces as the REJECT arm.
BRANCH_RE='^[A-Za-z0-9._][A-Za-z0-9._/-]*$'

usage() {
  printf 'usage: bash scripts/kickoff-mint-branch.sh <worktree-dir> <branch>\n' >&2
}

# REJECT reasons may carry git's raw multi-line message; the verdict contract
# keeps every stdout line single, so fold control characters before printing.
oneline() {
  printf '%s' "$1" | tr '\n\r\t' ' ' | tr -s ' ' | sed 's/[[:space:]]*$//'
}

reject() {
  printf 'REJECT %s\n' "$(oneline "$1")"
  exit 1
}

[ "$#" -eq 2 ] || { usage; exit 2; }
dir=$1
branch=$2

[ -d "$dir" ] || reject "worktree dir '$dir' does not exist"
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) \
  || reject "'$dir' is not inside a git repository"

# Physicalize both sides before comparing: git reports worktree paths with
# symlinks resolved, the caller may have passed either form.
dir_abs=$(realpath -- "$dir" 2>/dev/null) || reject "cannot resolve '$dir'"
top_abs=$(realpath -- "$top" 2>/dev/null) || reject "cannot resolve '$top'"
[ "$dir_abs" = "$top_abs" ] \
  || reject "'$dir' is not the root of a git checkout"

# Linked-vs-main test: in the main checkout git-dir == git-common-dir; in a
# linked worktree git-dir lives under .git/worktrees/, so equality here is
# exactly the "never touch the main checkout" rule.
gitdir=$(git -C "$dir" rev-parse --path-format=absolute --git-dir 2>/dev/null) \
  || reject "cannot resolve git-dir for '$dir'"
commondir=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
  || reject "cannot resolve git-common-dir for '$dir'"
[ "$gitdir" != "$commondir" ] || reject "the main checkout is never a mint target"

[[ "$branch" =~ $BRANCH_RE ]] || reject "invalid branch name '$branch'"
base=$(basename -- "$dir")
[ "$branch" = "$base" ] || reject "branch '$branch' must equal the worktree basename '$base'"

# The EXISTS pre-check is the idempotent verdict kickoff's resume path needs;
# it is not papering over a race — checkout -b below would refuse regardless.
if sha=$(git -C "$dir" rev-parse --verify "refs/heads/$branch" 2>/dev/null); then
  printf 'EXISTS %s %s\n' "$branch" "$sha"
  exit 0
fi

# checkout -b at the worktree's current HEAD is the only mutation this script
# makes; a detached HEAD with the run's commits on it is carried onto the
# branch (the cf-50/cf-52 recovery ordering becomes unnecessary).
if ! out=$(git -C "$dir" checkout -q -b "$branch" 2>&1); then
  reject "checkout -b failed: $out"
fi
sha=$(git -C "$dir" rev-parse HEAD 2>/dev/null) \
  || reject "created '$branch' but cannot resolve its sha"
printf 'MINTED %s %s\n' "$branch" "$sha"
