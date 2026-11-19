---
name: pipeline-conventions
description: >-
  Shared operational contract of the agent-* pipeline — plan-folder layout, file
  semantics, read order, and the RESULT handoff block. MUST-loaded by every
  pipeline agent at run start; never auto-selected.
metadata:
  opencode/autoinvoke: 'false'
disable-model-invocation: true
---
# Pipeline shared conventions

The operational contract for every `agent-*` pipeline session.

## Plan folders

Every feature gets its own folder under the plan root `.agents/plans/`, named `<yyyy>/<yyyy-mm>-<type>-<slug>/` (e.g. `.agents/plans/2026/2026-10-feat-searxng-rate-limits/`), where `<type>` is one of feat|bug|debug|dep|refactor|chore|docs:
- The plan file (`<yyyy-mm-dd>-<type>-<slug>.md` — the `templates/PLAN.md` boilerplate, renamed on copy) is the plan of record: goal, scope, chunk table, order/waves. Everyone reads it; only plan/coord write it. The one sanctioned second plan file is `<plan-file>-fusion.md`, written by `agent-fuser` when parallel runs of the ticket are fused; the base session executes it as a replan.
- `STATE.json` — machine state: feature folder, current wave, per-chunk status, retries, verdicts, last handoff. Only coord writes it.
- `DECISIONS.md` — append-only log of decisions, rejected alternatives, conventions. Read it before acting; add to it only if you are plan or coord.
- `RESEARCH.md` — optional: the deep-research summary `agent-research` writes on demand, next to the plan file (findings with sources, contradictions, implications for the plan). Everyone reads it at run start if it exists.
- `FRICTION.md` — append-only friction log: what blocked or slowed agents down, each with the resolution used. Everyone reads it at run start so known workarounds are not rediscovered; agents report new items via RESULT `friction:`; only coord appends.
- `chunks/<chunk-id>.md` — one file per chunk: tasks, files in scope, acceptance criteria, test list, review notes.

Blank templates live in `.agents/plans/templates/`; `agent-plan` copies them into the new feature folder.

## Files are the bus

You never receive another agent's conversation and you must not assume shared memory. Read first, then act:
1. `STATE.json` (inside the feature folder)
2. the chunk file you were given
3. the parts of the plan file you need
4. `DECISIONS.md`
5. `RESEARCH.md` (if it exists — research grounded upstream of you)
6. `FRICTION.md` (known workarounds — do not rediscover them)

## RESULT block

End every hand-back with exactly this block (the coordinator parses it):

```
RESULT
status: DONE | BLOCKED | NEEDS_INFO | CHANGES_REQUESTED
chunk: <chunk-id, "plan", or "fusion">
files_changed: [<paths>]
commands_run: [<cmd> => pass|fail]
deviations: <anything you did differently from the chunk/plan, or "none">
friction: <one line per item: what blocked/slowed the run + resolution used, or "none">
open_questions: <questions for coord/human, or "none">
next_suggested: <what you think should happen next, one line>
```
