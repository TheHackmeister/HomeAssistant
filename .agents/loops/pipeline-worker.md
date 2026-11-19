---
name: pipeline-worker
schedule: 0 * * * *
enabled: false
model: openrouter/qwen/qwen3.8-flash
agent: agent-board-coord
---

<!--
cf-76 pipeline worker loop, ported by cf-93 C07 (2026-11-01, replicating the
C06 reference port). SHIPS
DISABLED here: OpenChamber syncs loop files per project and enablement is
the owner's explicit per-repo decision (cf-76/OQ10 ruling — SpencersLab's
enabled:true was the owner's own toggle there, never copied silently). The
owner flips enabled: true once this repo's board runs are wanted; until
then /pipeline-boards-hourly + scripts/agent-board-coord-gate.sh are the
manual entry.

OpenChamber syncs loop files from the project tree; schedule is a cron —
hourly spans the 2 h stale window twice (D21); timezone is omitted so the
server default applies; the model is the code tier by the Q2 ruling and the
agent is the board-coord ALIAS (D15 — the command/gate/saved-approval
continuity name).

Swap target (checklist item 3): slash dispatch of a plugin command from loop
text is unproven on the pinned OpenCode v2.1.4 (D30 — opencode run sent a
"/cmd" line as literal text), so the body below is the plain-text worker
sentence and /pipeline-tick stays out of it. If the live smoke proves
dispatch, replace the body with the bare command /pipeline-tick and nothing
else on the line (no arguments — multi-line command arguments are broken on
that build). With the plain-text body the tick executor never runs from
here, and determinism still holds: the same guarded reap passes at every
claim and on the reap timer.
-->

Load the boards skill and run exactly one Parallel pipeline loops iteration. First call pipeline_status, then follow the skill.