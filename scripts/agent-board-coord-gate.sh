#!/usr/bin/env bash
# agent-board-coord-gate.sh — answers the SESSION operand of the scheduled
# board-coord launch gate: "is another board-coord session working right now?"
# — counting the agent-board-coord alias and its -local/-pr variants alike.
#
# The WeKan Executing operand is deliberately NOT evaluated here: a bash
# script cannot hold an MCP session, so the board check is the agent's own
# read-only turn, run only on a LIVE verdict (D16). A GATE: RUN short-circuits
# the board side entirely — the common idle hourly case needs no board
# dependency at all (D11).
#
# Network surface: the local `opencode api` CLI only. It carries the TUI's
# server discovery and auth, so this file holds no credentials (D1, D16).
#
# The coord filter is the agent name alone, enumerated explicitly for all
# three board-coord ids (alias + variants) — exact names, never prefix
# matching. The listing API also accepts a
# directory/project scope — smaller walks, but rejected: a manual or worktree
# launch must stay visible to the main-checkout hourly run and the other way
# around (D11: interactive launches count).
# With several worker repos sharing one OpenCode server the cross-project
# count stays deliberately unscoped (OQ-A3, DECISIONS 2026-10-31): hourly
# launches serialize across repos — counting every project is the conservative
# single-writer answer. Per-repo gate scoping is a human decision, not a
# silent fix; the board operand's repo filtering lives in the hourly command's
# BOARD CHECK, not here.
#
# Callers run `bash scripts/agent-board-coord-gate.sh` from the active project
# location; nothing here resolves against $0, so any cwd works.

set -euo pipefail

# Freshness window default: 15 minutes — the batched-round OQ3 answer (D9).
# Accepted residual (plan Risks): a coordinator silent longer than the
# threshold between two child activities reads stale; --threshold tunes it.
THRESHOLD_MIN_DEFAULT=15

# Self-exclusion window default: 5 minutes (D3). The scheduler creates the
# session before prompting it, so a coord session created inside this window IS
# this run; a run cannot know its own sessionID from inside its shell, so this
# recency floor is the fallback and --self the precise exclusion.
GRACE_MIN_DEFAULT=5

# Per-call timeout for the CLI, and a hard cap on cursor-walk pages. The walk
# ends when the server stops offering a next-cursor; the cap makes a looping or
# pathological listing fail CLOSED instead of burning the hourly launch.
CLI_TIMEOUT=20
PAGE_LIMIT=500
MAX_PAGES=40

usage() {
  cat <<'EOF'
agent-board-coord-gate.sh — session operand of the /pipeline-boards-hourly gate

Answers one question: is another board-coord session working right now? The
liveness set is the three explicit agent ids — "agent-board-coord" (the alias
the hourly launch creates), "agent-board-coord-local" and
"agent-board-coord-pr" (the variants a manual run uses) — so no live run hides
behind a name the gate does not count.
The WeKan Executing operand is the agent's own turn (read-only dev-boards) and
only runs on LIVE — this script never touches a board.

Verdict — the machine-readable first stdout line. The hourly command's
decision rule keys on these markers:
  GATE: RUN <basis>                   exit 0   no other live coord session; proceed to Card pickup (the board operand is never evaluated — short-circuit)
  GATE: LIVE <id> (<age>s) <title>    exit 2   a live coord session was found; the agent MUST run the BOARD CHECK protocol before anything else
  GATE: SKIP <reason>                 exit 1   session detection failed; fail-closed — the run must not start

Usage:
  agent-board-coord-gate.sh [--self <sessionID>] [--threshold <minutes>] [--grace <minutes>] [--json <file|->] [--help]

Flags:
  --self <sessionID>      Exclude this sessionID from the coord set — the
                          precise self-exclusion for a caller that knows its
                          own id (D3).
  --threshold <minutes>   Freshness window: a coord session is live when its
                          own time.updated, or any child session's (parentID
                          pointing at it — the child rule closes the
                          coordinator's silence while blocked in a subagent
                          launch, D2), is within this window. Default 15
                          minutes (D9). 0 is the forced-through escape.
  --grace <minutes>       Young-created window: coord sessions created within
                          this window are treated as the just-minted session of
                          this very launch and never count against it (D3).
                          Default 5 minutes.
  --json <file|->         Fixture mode: read the exact live response envelope
                          {"data":[...]} from a file, or from stdin with "-",
                          instead of calling the OpenCode CLI. GATE_NOW_MS
                          (epoch milliseconds) pins the clock in fixture mode
                          only — live mode ignores it so a stale pinned clock
                          can never mask real activity.
  --help                  This text.

Liveness set: sessions whose agent is exactly one of "agent-board-coord",
"agent-board-coord-local", or "agent-board-coord-pr" (explicit enumeration —
each board-coord name counts, missing one would let two runs collide), minus
--self, minus anything created inside --grace. No directory or project
scoping — interactive and worktree launches are supposed to count (D11).

Failure policy: fail-closed. A missing dependency, an unreachable CLI, a
non-JSON response, an exhausted page cap, or an unreadable, empty, malformed,
or non-envelope fixture all print GATE: SKIP <reason> and exit 1 — detection
can never "rescue" itself into a start. Reasons are single sanitized tokens;
raw response bodies and credential material are never echoed.

Exit codes: 0 RUN / 1 SKIP / 2 LIVE (paired with the markers above).
EOF
}

say_run() { printf 'GATE: RUN %s\n' "$1"; exit 0; }
say_skip() { printf 'GATE: SKIP %s\n' "$1"; exit 1; }

self=""
threshold="$THRESHOLD_MIN_DEFAULT"
grace="$GRACE_MIN_DEFAULT"
json=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help)
      usage
      exit 0
      ;;
    --self)
      [ "$#" -ge 2 ] || say_skip arg-missing-value-self
      self="$2"
      shift 2
      ;;
    --threshold)
      [ "$#" -ge 2 ] || say_skip arg-missing-value-threshold
      [[ "$2" =~ ^[0-9]{1,4}$ ]] || say_skip arg-not-integer-threshold
      threshold="$2"
      shift 2
      ;;
    --grace)
      [ "$#" -ge 2 ] || say_skip arg-missing-value-grace
      [[ "$2" =~ ^[0-9]{1,4}$ ]] || say_skip arg-not-integer-grace
      grace="$2"
      shift 2
      ;;
    --json)
      [ "$#" -ge 2 ] || say_skip arg-missing-value-json
      json="$2"
      shift 2
      ;;
    *)
      # Unknown argument: refuse rather than start a run on a half-parsed
      # command line — a mistyped flag must not silently mean "no filter".
      say_skip arg-unknown-flag
      ;;
  esac
done

command -v jq >/dev/null 2>&1 || say_skip dependency-jq-missing

thr_ms=$((threshold * 60 * 1000))
grace_ms=$((grace * 60 * 1000))

now=""
if [ -n "$json" ]; then
  if [ -n "${GATE_NOW_MS:-}" ]; then
    [[ "$GATE_NOW_MS" =~ ^[0-9]+$ ]] || say_skip clock-invalid-gate-now-ms
    now="$GATE_NOW_MS"
  fi
fi

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

if [ -n "$json" ]; then
  if [ "$json" = "-" ]; then
    raw="$(cat)" || say_skip fixture-unreadable
  else
    raw="$(cat "$json" 2>/dev/null)" || say_skip fixture-unreadable
  fi
  [ -n "$raw" ] || say_skip fixture-empty
  envelope="$(printf '%s\n' "$raw" | jq -c . 2>/dev/null)" || say_skip fixture-malformed-json
  jq -e 'type == "object" and ((.data | type) == "array")' <<<"$envelope" >/dev/null 2>&1 \
    || say_skip fixture-not-envelope
  jq '.data' <<<"$envelope" >"$TMPD/sessions.json" || say_skip fixture-malformed-json
else
  command -v opencode >/dev/null 2>&1 || say_skip cli-not-installed
  command -v timeout >/dev/null 2>&1 || say_skip dependency-timeout-missing
  : >"$TMPD/all.jsonl"
  cursor=""
  pages=0
  while :; do
    pages=$((pages + 1))
    [ "$pages" -le "$MAX_PAGES" ] || say_skip pagination-limit-exceeded
    path="/api/session?limit=${PAGE_LIMIT}&order=desc"
    [ -z "$cursor" ] || path="${path}&cursor=${cursor}"
    rc=0
    timeout "$CLI_TIMEOUT" opencode api get "$path" >"$TMPD/page.json" 2>/dev/null || rc="$?"
    [ "$rc" -ne 124 ] || say_skip cli-timeout
    [ "$rc" -eq 0 ] || say_skip cli-unreachable
    jq -e 'type == "object" and ((.data | type) == "array")' "$TMPD/page.json" >/dev/null 2>&1 \
      || say_skip cli-malformed-response
    jq -c '.data[]' "$TMPD/page.json" >>"$TMPD/all.jsonl" 2>/dev/null || say_skip cli-malformed-response
    if ! cursor="$(jq -r 'if .cursor == null then empty
                          else (.cursor | if type == "object" then (.next // empty) else error("bad cursor") end) end' \
                          "$TMPD/page.json" 2>/dev/null)"; then
      say_skip cli-malformed-response
    fi
    [ -z "$cursor" ] || [ "$cursor" != "null" ] || cursor=""
    [ -n "$cursor" ] || break
  done
  jq -s '.' "$TMPD/all.jsonl" >"$TMPD/sessions.json" 2>/dev/null || say_skip cli-malformed-response
fi

# GATE_NOW_MS pins the clock in fixture mode only; live mode always reads the
# wall clock so a stale pinned value cannot mask real activity.
[ -n "$now" ] || now="$(date +%s%3N)"

# Liveness evaluation, per the D2 rule: exclude --self and in-grace coords
# first, then for each remaining coord take the newest update across its tree
# (own time.updated OR any child session's, matched by parentID) and keep it
# when that tree age is within the threshold — the child rule is what closes
# the coordinator's silence while it is blocked in a long subagent launch.
# A missing/zero time reads as maximally old.
# Output: one TSV per live coord — id, age_s, title, basis, own_s, child_s, dir.
if ! jq -r \
  --argjson now "$now" \
  --argjson thr_ms "$thr_ms" \
  --argjson grace_ms "$grace_ms" \
  --arg self "$self" '
  def clamped($ms): ($ms | if . < 0 then 0 else . end);
  . as $all
  | map(select(.agent == "agent-board-coord" or .agent == "agent-board-coord-local" or .agent == "agent-board-coord-pr"))
  | map(select(.id != $self))
  | map(select((($now - (.time.created // 0)) | clamped(.)) >= $grace_ms))
  | map(
      . as $c
      | (clamped($now - (.time.updated // 0))) as $own
      | ([$all[] | select(.parentID == $c.id) | clamped($now - (.time.updated // 0))]
         | if length == 0 then null else min end) as $child
      | ([$own] + (if $child == null then [] else [$child] end) | min) as $tree
      | select($tree <= $thr_ms)
      | {id: ($c.id // "unknown-id"),
         tree_ms: $tree,
         age: ($tree / 1000 | floor),
         title: ($c.title // "untitled"),
         basis: (if $own <= $thr_ms then "own-fresh" else "child-fresh" end),
         own_s: ($own / 1000 | floor),
         child_s: (if $child == null then "none" else (($child / 1000 | floor) | tostring) + "s-ago" end),
         dir: (($c.location // {}).directory // "unknown")}
    )
  | sort_by(.tree_ms, .age)
  | .[]
  | [.id, .age, .title, .basis, .own_s, .child_s, .dir]
  | @tsv
' "$TMPD/sessions.json" >"$TMPD/live.tsv" 2>/dev/null; then
  say_skip eval-failed
fi

mapfile -t rows <"$TMPD/live.tsv"
if [ "${#rows[@]}" -eq 0 ]; then
  # Zero coords, all stale, and all excluded are the same answer by contract.
  say_run no-live-board-coord-session
fi

IFS=$'\t' read -r id age title basis own child dir <<<"${rows[0]}"
printf 'GATE: LIVE %s (%ss) %s\n' "$id" "$age" "$title"

if [ "${#rows[@]}" -gt 1 ]; then
  ids=""
  for row in "${rows[@]}"; do
    rid="${row%%$'\t'*}"
    ids="${ids:+$ids, }$rid"
  done
  printf '  live coord session ids: %s\n' "$ids"
fi

for row in "${rows[@]}"; do
  IFS=$'\t' read -r rid rage rtitle rbasis rrow rchild rdir <<<"$row"
  printf '  live: %s "%s" tree-age=%ss basis=%s own-updated=%ss-ago child-updated=%s directory=%s\n' \
    "$rid" "$rtitle" "$rage" "$rbasis" "$rrow" "$rchild" "$rdir"
done

printf 'next: BOARD CHECK runs on the agent side (read-only dev-boards) — this gate never reads the board.\n'
exit 2
