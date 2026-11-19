---
targets:
  - '*'
description: Plan and run a WeKan AI-Dev board card through the agent-board-coord pipeline (pushes work for remote build/test)
opencode:
  agent: agent-board-coord-pr
---
Request (card ID, optional): $ARGUMENTS

Current state:
!`state=$(find .agents/plans -mindepth 2 -maxdepth 3 -name STATE.json 2>/dev/null); if [ -z "$state" ]; then echo "no plan yet"; else for f in $state; do echo "== $f"; cat "$f"; done; fi`

Session origin rule: the 'Session origin:' line below was produced when this command expanded (outside the tool-permission flow, on the OpenChamber host). Its value IS this run's SESSION_URL_BASE — copy it verbatim into every session link. On 'Session origin: UNRESOLVED …' write the RAW session id wherever a link would go (user ruling 2026-10-25; D13's full-URL rule stands whenever an origin resolves) and record the fallback in RESULT. Never substitute a remembered, guessed or historically-observed host.
!`if [ -z "${VSCODE_PROXY_URI:-}" ]; then printf 'Session origin: UNRESOLVED (no Coder app-origin env)\n'; elif printf '%s\n' "$VSCODE_PROXY_URI" | grep -qF '{{port}}'; then b=$(printf '%s\n' "$VSCODE_PROXY_URI" | sed 's/{{port}}/openchamber/' | tr 'A-Z' 'a-z'); c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$b/" || true); case "$c" in 200|301|302|303|401|403) printf 'Session origin: %s\n' "$b";; *) printf 'Session origin: UNRESOLVED (derived host answered %s)\n' "$c";; esac; else printf 'Session origin: UNRESOLVED (unexpected VSCODE_PROXY_URI shape)\n'; fi`

Intake is the WeKan AI-Dev board: a card id given in `$ARGUMENTS` is picked up as-is; otherwise take the first card walking Rework → Not Started → Low Priority, each list top-to-bottom (boards skill Card pickup, confirmed via `get_card`). The card description is the request, and its five standard checklists (Services / Type / Model(s) / Lifecycle / Human in the Loop) plus the `slug` custom field (value `[<slug>](<session link>)`) supplies the kickoff answer — the card-driven kickoff replaces the live questions. Research-labelled cards run the iterative research-only loop and exit at Review. If there is no approved plan, start with the card-driven kickoff — no user questions during planning; every genuine gap is recorded and batched into the one plan question round — then start Phase 1 (plan). If `plan_status` is `approved`, resume Phase 2 at the next ready chunk.
