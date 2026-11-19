# Plan folders, STATE.json, RESULT, friction

The pipeline's living state. Everything here is per-ticket; there is no global state, so tickets never overwrite each other.

## Ticket folder layout

```
.agents/plans/
  templates/                         blank versions of every plan/tracking file
  <yyyy>/
    <yyyy-mm>-<type>-<slug>/         ONE folder per ticket, everything together;
                                     <type> = feat|bug|debug|dep|refactor|chore|docs
      <yyyy-mm-dd>-<type>-<slug>.md  plan of record: goal, scope, chunk table, waves.
                                     Only plan/coord write it. Renamed from
                                     templates/PLAN.md when the ticket is created.
      <companions>                   runbooks/scripts share the plan file's prefix
      STATE.json                     machine state: status, waves, per-chunk handoffs. Only coord writes it.
      DECISIONS.md                   append-only decision log. Read before acting; only plan/coord add to it.
      RESEARCH.md                    optional: deep-research summary by agent-research (findings with sources, implications).
                                     Written ONLY here, next to the plan file, at the exact folder path from the launch message.
                                     Everyone reads at run start if present.
      FRICTION.md                    append-only friction log. Agents report via RESULT; coord appends; everyone reads at run start.
      FUSION-REPORT.md               optional: agent-fuser's run-comparison report (planning quality, code/research/friction deltas,
      <plan-file>-fusion.md           base choice). The -fusion plan is the ONE sanctioned second plan file in a ticket folder:
                                     the user-confirmed plan for fusing parallel runs, executed by this branch's session as a replan.
      chunks/C01.md ...              one per chunk: goal, tasks, files in scope, acceptance criteria, verification, review notes.
```

- Keep a ticket in its **earliest** folder — the one created in the year/month the ticket started; follow-up plans join the existing folder even in later months or years.
- Folders created before 2026-10-17 use the legacy `yyyy-mm/<feature-slug>/` layout and are migrated per-ticket; plans created before the per-ticket convention live flat at the `.agents/plans/` root — historical and immutable.
- New ticket: copy the blanks from `templates/` into `<ticket>/`, renaming `PLAN.md` to the dated plan file `<yyyy-mm-dd>-<type>-<slug>.md` (`agent-plan` does this). One plan file per ticket — never a second one.

## STATE.json schema

```json
{
  "feature": "<yyyy>/<yyyy-mm>-<type>-<slug>",
  "kickoff": { "slug": "<slug>", "run_tag": "<tag>", "worktree": "<slug>-<tag>",
               "models": { "plan": "<planning-tier provider/model>",
                           "code": "<code-tier provider/model>" },
               "local": false },
  "plan_status": "draft | approved | needs-replan | complete",
  "coord_session": null,
  "test_session": null,
  "current_wave": 1,
  "updated_at": "YYYY-MM-DDTHH:MM:SSZ",
  "chunks": {
    "C01": { "status": "pending | in-progress | done | blocked",
             "wave": 1, "depends_on": [], "dev_rounds": 0, "review_rounds": 0,
             "dev_session": null, "last_verdict": null,
             "handoffs": [ { "round": "dev-1", "result": { /* RESULT block, verbatim */ } } ] }
  },
  "blocked": [], "deferred": []
}
```

## RESULT block (every subagent hand-back ends with exactly this)

```
RESULT
status: DONE | BLOCKED | NEEDS_INFO | CHANGES_REQUESTED
chunk: <chunk-id, "plan", or "fusion">
files_changed: [<paths>]
commands_run: [<cmd> => pass|fail]
deviations: <anything done differently from the chunk/plan, or "none">
friction: <one line per item: what blocked/slowed the run + resolution used, or "none">
open_questions: <questions for coord/human, or "none">
next_suggested: <one line>
```

Coord copies it verbatim into `STATE.json` under `chunks.<id>.handoffs[]` **before anything else** — context may be compacted at any moment; the file is the only memory.

## Chunk lifecycle (per wave, one chunk at a time)

Plan approved → `agent-test` writes the tests for **every** chunk in ONE session, before any dev starts (its sessionID recorded as `test_session` in `STATE.json`). Then per chunk: `agent-dev` implements (tests are read-only to it) → `agent-review` runs the validation commands/full suite, then reviews. On `CHANGES_REQUESTED`, the fix goes back to the dev session that implemented the chunk (sessionID `chunks.<id>.dev_session`; a fresh session if that one is gone) and review re-runs — reviews are ALWAYS fresh sessions, never continued (max 3 rounds; then chunk `blocked`, ask the user: more rounds / accept / re-plan / drop). If review judges a test itself at fault it returns `BLOCKED` with `validation_at_fault` — the reviewer never edits tests; coord routes the fix silently to the test session (`test_session`; a fresh `agent-test` session if that one is gone), which returns `NEEDS_INFO` when a repair would change functionality — only that escalation reaches the user (`plan_status: "needs-replan"` when the plan itself moves) — then re-reviews. A chunk is `done` only with dev DONE + review APPROVED, the validation commands shown passing in review's `commands_run`. Two consecutive dev rounds failing the same verification on the same files → stop and escalate. When all chunks are `done`, coord launches a final `agent-review` over the whole plan — on the planning-tier model — (full suite + full diff against every acceptance criterion, plus DECISIONS.md and FRICTION.md); only its APPROVED marks `plan_status: "complete"`. Coord then reports to the user; whenever its session ends with `open` friction items it asks ONE multi-select question over them, and each item the user checks gets a fresh `agent-plan` session planning its fix as a new ticket.

`coord_session` in `STATE.json` is the sessionID of the coordinator currently driving the ticket (captured from the `session_rename` return at kickoff, re-captured on resume) — `agent-fuser` uses it to hand a confirmed fusion plan back to this ticket's session.

Deep research sits outside the chunk loop: any agent reports a research need via RESULT, coord launches `agent-research` (storm + `global-searxng`) with the scope, the questions AND the absolute feature-folder path, and the summary lands in the ticket folder as `RESEARCH.md` — next to the plan file, nowhere else — for every later agent to read.

Fusion sits outside the loop too: `agent-fuser` (user-launched) compares parallel runs of the ticket across branches, the user confirms the base branch and every conflicted sourcing choice (always with a follow-up confirmation), and the fuser writes `FUSION-REPORT.md` + `<plan-file>-fusion.md` into the base worktree's ticket folder, gets the plan confirmed, and prompts the base session (`coord_session`) to execute it as a replan — `done` chunks stay done.

## Friction lifecycle

Friction = anything an agent could not find or had no access to, crashes/tool-MCP failures, stale docs/plans, forced repeats or workarounds — **each with the resolution actually used**.

1. Every agent reads `FRICTION.md` at run start (known workarounds are not rediscovered) and reports new items in RESULT `friction:`.
2. Coord appends reported + own items after every hand-back. Primary agents without a coord append their own.
3. User triages: entries are never deleted, only re-statused `open` → `fixed` (cause repaired) or `ignored` (accepted). Agents treat `fixed` as history and `ignored` as known-OK.

Entry format:

```
- YYYY-MM-DD · <role>(<chunk>) · <what happened + impact> · resolution: <what the agent did> · <open|fixed|ignored>
```
