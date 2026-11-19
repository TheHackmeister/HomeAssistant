#!/usr/bin/env bash
# kickoff-warm-location.sh — warm a run's session_move destination BEFORE
# the move. kickoff's "Move in" step, called by both coordinator families
# through the narrow grant `bash scripts/kickoff-warm-location.sh *`.
#
# Why (verified 2026-10-31 on OpenCode v2.1.4): session_move does NOT boot
# the destination's location services. A session moved into a directory
# whose services are not loaded never resolves the location's custom agents
# again (Session.AgentNotFoundError on every drain attempt) and is bricked
# permanently — the cf-90 board ticks died exactly this way twice in one
# night. Location services boot lazily at turn starts, and kickoff's move
# happens mid-turn, so the destination is cold unless an earlier turn of the
# same server process already ran there.
#
# The warm is a read-only resolve: GET /api/location boots the location
# synchronously when missing (empirically: the directory then appears in
# /api/debug/location, and a moved session drains normally). The presence
# check is the safety property: the verdict is WARMED only once the
# loaded-location list actually contains the directory, so the caller's
# session_move trusts a settled boot, never a fire-and-forget GET.
#
# Network surface: the local OpenCode service only (loopback control plane,
# the session-origin.sh posture family — one bounded call per leg, no
# retry). No credentials. Callers run
# `bash scripts/kickoff-warm-location.sh <worktree-dir>` from any cwd;
# nothing here resolves against $0 except the usage line.
#
# Verdict — exactly one stdout line, the coordinators' state machine keys on it:
#   WARMED <dir>       exit 0  location services loaded for <dir> (fresh boot
#                              or already loaded) — session_move may proceed
#   REJECT <reason>    exit 1  validation refusal, resolve failure, or the
#                              directory absent from the loaded list — the
#                              caller must NOT session_move
#   usage line         exit 2  wrong arity

set -euo pipefail

usage() {
  printf 'usage: bash scripts/kickoff-warm-location.sh <worktree-dir>\n' >&2
}

# REJECT reasons may carry multi-line api output; the verdict contract keeps
# every stdout line single, so fold control characters before printing.
oneline() {
  printf '%s' "$1" | tr '\n\r\t' ' ' | tr -s ' ' | sed 's/[[:space:]]*$//'
}

reject() {
  printf 'REJECT %s\n' "$(oneline "$1")"
  exit 1
}

[ "$#" -eq 1 ] || { usage; exit 2; }
dir=$1

case "$dir" in
  /*) : ;;
  *) reject "target must be an absolute path, got '$dir'" ;;
esac
[ -d "$dir" ] || reject "worktree dir '$dir' does not exist"
command -v opencode >/dev/null 2>&1 || reject "opencode CLI not on PATH"

# The move target is always a checkout root in this flow; physicalize and
# verify before spending the resolve call on it (realpath both sides: git
# reports worktree paths with symlinks resolved, the caller may pass either).
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) \
  || reject "'$dir' is not inside a git repository"
dir_abs=$(realpath -- "$dir" 2>/dev/null) || reject "cannot resolve '$dir'"
top_abs=$(realpath -- "$top" 2>/dev/null) || reject "cannot resolve '$top'"
[ "$dir_abs" = "$top_abs" ] \
  || reject "'$dir' is not the root of a git checkout"

# Boot-if-missing; the GET is synchronous, so a fresh boot has settled by the
# time it returns.
if ! out=$(timeout 30 opencode api get "/api/location?location[directory]=$dir_abs" 2>&1); then
  reject "location resolve failed: $out"
fi

# Verify the boot landed before the caller trusts session_move: the loaded
# list must contain the directory. Whitespace is folded away first so compact
# and pretty-printed shapes both match.
if timeout 30 opencode api get /api/debug/location 2>/dev/null | tr -d '[:space:]' \
    | grep -qF "\"directory\":\"$dir_abs\""; then
  printf 'WARMED %s\n' "$dir_abs"
  exit 0
fi
reject "location resolved but not loaded: $dir_abs"
