---
description: >-
  Scheduled hourly WeKan AI-Dev board launch — the gated variant of
  /pipeline-boards for agent-board-coord
agent: agent-board-coord
---
The Gate output below was produced when this command expanded — before your first turn, outside the tool-permission flow — and it decides what you do next.

!`bash scripts/agent-board-coord-gate.sh || true`

<!-- Root-relative path is deliberate: the shell block runs from the active project location — after landing, the main checkout that the hourly scheduled task owns. '|| true' keeps a non-zero verdict exit from blanking the inserted output. -->

Request (card ID, optional): $ARGUMENTS

Current state:
!`state=$(find .agents/plans -mindepth 2 -maxdepth 3 -name STATE.json 2>/dev/null); if [ -z "$state" ]; then echo "no plan yet"; else for f in $state; do echo "== $f"; cat "$f"; done; fi`

Decision rule — key on the FIRST line of the Gate output above, not on the exit code (the `|| true` masks it). It starts with one of three markers:

- `GATE: SKIP <reason>` — session detection failed; the run is skipped fail-closed (an unproven guard is a stopped guard). Reply with ONE short line quoting that verdict, then stop: no board calls at all (not even reads), no mint, no worktree, no `session_rename`, no subagent launch, no STATE.json/DECISIONS.md/FRICTION.md writes, no skill loading.
- `GATE: RUN <basis>` — no other live board-coord session; continue exactly as `/pipeline-boards` does — card-driven kickoff, batched-question protocol, chunk loop; the flow authority stays in the boards skill.
- `GATE: LIVE <id> (<age>s) <title>` — another board-coord session is live; run the BOARD CHECK below before anything else.

BOARD CHECK (LIVE branch only, read-only dev-boards calls): `list_boards` → the board **AI-Dev**; its lists under swimlane **In Process** → the list titled **Executing**; `list_cards_in_list` on it, then `get_card` on each returned card — the by-list projection strips labels and the repo filter needs them. A card counts against THIS run only when it is ELIGIBLE under the boards skill's Card pickup step-4 `Repo:` test — that rule is the single authority, cited here, never restated: `Repo:<this run's repo>` among the card's labels, or no `Repo:` label at all while this repo is the default picker, the run's repo resolving per that skill's Repo identity section. Foreign Executing cards never stop the tick.

- Executing EMPTY of filtered-in cards (zero pass the `Repo:` filter) → continue exactly as `/pipeline-boards`.
- ≥1 filtered-in card → stop with ONE short line quoting the LIVE verdict (session id + age) and the filtered-in card titles (max 5, then a truncation marker). No board WRITES ever on this path.
- Any call failure, ambiguous board/list resolution, or unexpected output → board-check unavailable → stop with ONE short line (run skipped, fail-closed like the session gate: the empty-card disjunct cannot be proven).

Until that filtered EMPTY verdict, the ONLY allowed dev-boards operations on the LIVE branch are reads: `list_boards`, `list_lists`, `list_swimlanes`, `get_board`, `list_cards_in_list`, `get_card`, `list_comments`, checklist reads. Banned outright until that verdict: `move_card`, `add_comment`, `set_card_custom_field`, `delete_checklist_item`, `toggle_checklist_item`, and card creation.

Session origin rule: the 'Session origin:' line below was produced when this command expanded (outside the tool-permission flow, on the OpenChamber host). Its value IS this run's SESSION_URL_BASE — copy it verbatim into every session link. On 'Session origin: UNRESOLVED …' write the RAW session id wherever a link would go (user ruling 2026-10-25; D13's full-URL rule stands whenever an origin resolves) and record the fallback in RESULT. Never substitute a remembered, guessed or historically-observed host.
!`if [ -z "${VSCODE_PROXY_URI:-}" ]; then printf 'Session origin: UNRESOLVED (no Coder app-origin env)\n'; elif printf '%s\n' "$VSCODE_PROXY_URI" | grep -qF '{{port}}'; then b=$(printf '%s\n' "$VSCODE_PROXY_URI" | sed 's/{{port}}/openchamber/' | tr 'A-Z' 'a-z'); c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$b/" || true); case "$c" in 200|301|302|303|401|403) printf 'Session origin: %s\n' "$b";; *) printf 'Session origin: UNRESOLVED (derived host answered %s)\n' "$c";; esac; else printf 'Session origin: UNRESOLVED (unexpected VSCODE_PROXY_URI shape)\n'; fi`

Notes:
- Manual one-off launches use `/pipeline-boards` and are ungated by design — the guard lives only on this scheduled path.
- A session shown LIVE here may be an interactive or worktree run — that it counts is deliberate: this launch asks "is anything running, however started".
- The session gate counts board-coord sessions of ALL projects on this OpenCode server deliberately (D11 unchanged): with several worker repos sharing one server, hourly launches serialize across repos by design — the conservative single-writer posture. Per-repo gate scoping is a human decision (OQ-A3), not a silent fix.
- A human-instructed forced-through launch: the human re-runs the gate command above on the host shell with `--threshold 0` (agent-board-coord's own shell is scoped to git plus the two own-session API rows — the gate script is not agent-runnable; the earliest scheduled launches carried no shell at all and reached OpenChamber only through its local HTTP API) and the run follows that verdict.
- The `Session origin:` block probes its derived host once at expansion (a single curl, 5 s cap) — `UNRESOLVED` never blocks the run: the raw-session-id fallback in the rule above keeps the board record complete.
- The board, swimlane and list names above must match the boards skill — on drift the check fails CLOSED (a skip); the boards skill remains the flow authority.
- For runs that push the branch to be built/tested remotely, use `/pipeline-boards-pr` (manual one-off only — this scheduled launch never pushes; unattended runs keep -local semantics).
