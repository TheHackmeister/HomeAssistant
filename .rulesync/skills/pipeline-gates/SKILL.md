---
name: pipeline-gates
description: Gates and escalation rules for the agent-* coordinator — deterministic-first advancement, stuck detection, retry caps, BLOCKED/NEEDS_INFO handling, deviation logging. MUST-loaded by agent-coord; never auto-selected.
targets: ["*"]
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Gates and escalation

- Deterministic first: a chunk cannot advance past validation unless commands_run shows the commands in the plan file's "Commands" passing.
- Stuck detection: if two consecutive dev rounds change the same files with the same failing validation, stop and escalate.
- Retry cap: 3 dev rounds or 3 review rounds per chunk, then set the chunk to `blocked` and ask the user with options: more rounds, accept as-is, re-plan the chunk, or drop it.
- `BLOCKED` or `NEEDS_INFO` from any agent: record it, ask the user if the question needs them, otherwise answer from the plan file/DECISIONS.md and relaunch. Never guess at product decisions.
- `validation_at_fault` from review: the reviewer never edits tests. Mechanical repairs route automatically — **silently**, no user question — back to the session that wrote the validation (`test_session` in `STATE.json`; a fresh `agent-test` session if it is gone). The test session adjudicates "mechanical": if the fix would change functionality or contradicts the acceptance criteria it returns `NEEDS_INFO` instead of writing it, and only then does coord escalate to the user (marking `plan_status: "needs-replan"` when the plan itself moves). Coord's process is step 2.d of `pipeline-role-coord`.
- If a subagent reports a deviation that changes the plan (new file, changed interface, dropped task), log it in the feature folder's `DECISIONS.md` and, if it affects later chunks, mark `plan_status: "needs-replan"` and ask the user to rerun planning for the remaining chunks.
