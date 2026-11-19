---
targets:
  - '*'
name: agent-board-coord
description: 'Board-driven coordinator (commit-only alias of agent-board-coord-local): pulls work cards from the WeKan AI-Dev board and runs the approved plan chunk by chunk via plan/research/dev/review subagents; writes only STATE.json, DECISIONS.md and FRICTION.md; commits each chunk, never pushes'
opencode:
  mode: primary
  color: '#22c55e'
  permissions:
    - action: '*'
      resource: '*'
      effect: deny
    - action: read
      resource: .agents/plans/**
      effect: allow
    - action: read
      resource: .opencode/skills/**
      effect: allow
    - action: read
      resource: .agents/skills/**
      effect: allow
    - action: read
      resource: skills/**
      effect: allow
    - action: read
      resource: .agents/loops/**
      effect: allow
    - action: read
      resource: .opencode/agents/**
      effect: allow
    - action: read
      resource: '*.env'
      effect: deny
    - action: read
      resource: '*.env.*'
      effect: deny
    - action: skill
      resource: '*'
      effect: allow
    - action: skill
      resource: pipeline-role-plan
      effect: deny
    - action: skill
      resource: pipeline-role-research
      effect: deny
    - action: skill
      resource: pipeline-role-test
      effect: deny
    - action: skill
      resource: pipeline-role-dev
      effect: deny
    - action: skill
      resource: pipeline-role-review
      effect: deny
    - action: question
      resource: '*'
      effect: allow
    - action: opencode
      resource: '*'
      effect: allow
    - action: shell
      resource: opencode api get /api/session*
      effect: allow
    - action: shell
      resource: opencode api patch /api/session/*
      effect: allow
    - action: shell
      resource: bash scripts/kickoff-mint-branch.sh *
      effect: allow
    - action: shell
      resource: bash scripts/kickoff-warm-location.sh *
      effect: allow
    - action: shell
      resource: bash scripts/session-origin.sh*
      effect: allow
    - action: shell
      resource: date *
      effect: allow
    - action: shell
      resource: bash scripts/board-preload-probe.sh *
      effect: allow
    # Surface grants (user ruling 2026-10-29, cf-88 ruled 2026-10-30): cf-88's
    # ls/pwd block rides the scoped-read family directly after the probe row,
    # not at the git tail — the push tail is the load-bearing last rows. The
    # probe row's spaced literal never matches a zero-arg command line, so
    # live-fire invocations always carry an argument.
    - action: shell
      resource: ls
      effect: allow
    - action: shell
      resource: ls *
      effect: allow
    - action: shell
      resource: pwd
      effect: allow
    - action: shell
      resource: pwd *
      effect: allow
    # In-work mark epoch: the kickoff recipe embeds $(date +%s%3N) in the
    # patch payload, and the shell matcher extracts command substitutions
    # and checks the date subcommand against this list on its own — the
    # global config's `date *` allow sits before this agent's deny baseline
    # and loses under last-match-wins, so the grant lives here.
    # Surface checks (cf-88 postmortem 2026-10-30): verifying its own kickoff
    # surfaces (worktree/branch present, session location) is coordination, not
    # investigation — denied ls/pwd probes once masqueraded as a broken env and
    # a healthy run was abandoned. Command pairs: `ls *`/`pwd *` miss the bare
    # forms; `ls*`/`pwd*` would shadow lsof/pwdx-style tools.
    # Git: sole-committer broad write (owner ruling 2026-10-29, card #72) —
    # one `git *` allow closed by a pinned deny floor, not an allow-list.
    # Advancing main needs make-main-HEAD (checkout/switch/worktree-add on a
    # main target), ref plumbing, merge INTO main, a push, or a git alias —
    # every leg is floored; the exception re-allows ride directly after the
    # floor and the push tail is the load-bearing LAST rows, never reorder.
    # Residual (D27): `-C` write verbs act on the TARGET worktree's current
    # branch — never main-publishable, chain (4). Push is denied outright so
    # a drifted run fails loudly.
    - action: shell
      resource: git *
      effect: allow
    - action: shell
      resource: git checkout main*
      effect: deny
    - action: shell
      resource: git * checkout main*
      effect: deny
    - action: shell
      resource: git checkout * main*
      effect: deny
    - action: shell
      resource: git * checkout * main*
      effect: deny
    - action: shell
      resource: git switch main*
      effect: deny
    - action: shell
      resource: git * switch main*
      effect: deny
    - action: shell
      resource: git switch * main*
      effect: deny
    - action: shell
      resource: git * switch * main*
      effect: deny
    - action: shell
      resource: git update-ref*
      effect: deny
    - action: shell
      resource: git * update-ref*
      effect: deny
    - action: shell
      resource: git symbolic-ref*
      effect: deny
    - action: shell
      resource: git * symbolic-ref*
      effect: deny
    - action: shell
      resource: git branch -f main*
      effect: deny
    - action: shell
      resource: git * branch -f main*
      effect: deny
    - action: shell
      resource: git branch --force main*
      effect: deny
    - action: shell
      resource: git * branch --force main*
      effect: deny
    - action: shell
      resource: git branch -d main*
      effect: deny
    - action: shell
      resource: git branch -d * main*
      effect: deny
    - action: shell
      resource: git * branch -d main*
      effect: deny
    - action: shell
      resource: git * branch -d * main*
      effect: deny
    - action: shell
      resource: git branch -D main*
      effect: deny
    - action: shell
      resource: git branch -D * main*
      effect: deny
    - action: shell
      resource: git * branch -D main*
      effect: deny
    - action: shell
      resource: git * branch -D * main*
      effect: deny
    - action: shell
      resource: git branch -m main*
      effect: deny
    - action: shell
      resource: git branch -m * main*
      effect: deny
    - action: shell
      resource: git * branch -m main*
      effect: deny
    - action: shell
      resource: git * branch -m * main*
      effect: deny
    - action: shell
      resource: git branch -M main*
      effect: deny
    - action: shell
      resource: git branch -M * main*
      effect: deny
    - action: shell
      resource: git * branch -M main*
      effect: deny
    - action: shell
      resource: git * branch -M * main*
      effect: deny
    - action: shell
      resource: git branch -c main*
      effect: deny
    - action: shell
      resource: git * branch -c main*
      effect: deny
    - action: shell
      resource: git branch -c * main*
      effect: deny
    - action: shell
      resource: git * branch -c * main*
      effect: deny
    - action: shell
      resource: git branch -C main*
      effect: deny
    - action: shell
      resource: git * branch -C main*
      effect: deny
    - action: shell
      resource: git branch -C * main*
      effect: deny
    - action: shell
      resource: git * branch -C * main*
      effect: deny
    - action: shell
      resource: git worktree add * main*
      effect: deny
    - action: shell
      resource: git * worktree add * main*
      effect: deny
    - action: shell
      resource: git pull*
      effect: deny
    - action: shell
      resource: git * pull*
      effect: deny
    - action: shell
      resource: git merge *
      effect: deny
    - action: shell
      resource: git * merge *
      effect: deny
    - action: shell
      resource: git config alias*
      effect: deny
    - action: shell
      resource: git * config alias*
      effect: deny
    - action: shell
      resource: git * --force*
      effect: deny
    - action: shell
      resource: git * -f *
      effect: deny
    - action: shell
      resource: git * -P *
      effect: deny
    - action: shell
      resource: git merge main*
      effect: allow
    - action: shell
      resource: git * merge main*
      effect: allow
    - action: shell
      resource: git merge --abort
      effect: allow
    - action: shell
      resource: git * merge --abort
      effect: allow
    - action: shell
      resource: git merge --continue
      effect: allow
    - action: shell
      resource: git * merge --continue
      effect: allow
    - action: shell
      resource: git checkout -b * main*
      effect: allow
    - action: shell
      resource: git * checkout -b * main*
      effect: allow
    - action: shell
      resource: git checkout -B * main*
      effect: allow
    - action: shell
      resource: git * checkout -B * main*
      effect: allow
    - action: shell
      resource: git switch -c * main*
      effect: allow
    - action: shell
      resource: git * switch -c * main*
      effect: allow
    - action: shell
      resource: git switch -C * main*
      effect: allow
    - action: shell
      resource: git * switch -C * main*
      effect: allow
    - action: shell
      resource: git worktree add -b * main*
      effect: allow
    - action: shell
      resource: git * worktree add -b * main*
      effect: allow
    - action: shell
      resource: git push*
      effect: deny
    - action: shell
      resource: git *push*
      effect: deny
    - action: subagent
      resource: '*'
      effect: deny
    - action: subagent
      resource: agent-plan
      effect: allow
    - action: subagent
      resource: agent-test
      effect: allow
    - action: subagent
      resource: agent-dev-local
      effect: allow
    - action: subagent
      resource: agent-review
      effect: allow
    - action: subagent
      resource: agent-research
      effect: allow
    # HA overlay implementers (cf-93 C09): launchable, but the coord takes
    # them only when the approved plan names the ha variant — the plain dev
    # slot above stays the default selection.
    - action: subagent
      resource: agent-ha-dev
      effect: allow
    - action: subagent
      resource: agent-ha-custom-component
      effect: allow
    - action: execute
      resource: '*'
      effect: allow
    # Kickoff naming surface: nested calls re-check the agent's allow-list,
    # so the reachable set of `tools.opencode.*` is pinned by the four
    # per-tool allows (worktree create/list, session rename/move) — nothing
    # else in the namespace, dev-boards* stays the only MCP server grant.
    - action: opencode_worktree_create
      resource: '*'
      effect: allow
    - action: opencode_worktree_list
      resource: '*'
      effect: allow
    - action: opencode_session_move
      resource: '*'
      effect: allow
    - action: opencode_session_rename
      resource: '*'
      effect: allow
    - action: dev-boards*
      resource: '*'
      effect: allow
    # cf-76 C07 lease-lock surface: the four pipeline-locks plugin tools,
    # declared after the dev-boards anchor because the claim must precede
    # the move. INERT on v2.1.4 — plugin tools are reachable only through
    # Code Mode (D29/D34 flat registry ids), where the operative grant is
    # the execute allow above; these rows match those shipped ids and
    # pre-grant the surface for a release that exposes them natively.
    - action: pipeline_claim
      resource: '*'
      effect: allow
    - action: pipeline_release
      resource: '*'
      effect: allow
    - action: pipeline_heartbeat
      resource: '*'
      effect: allow
    - action: pipeline_status
      resource: '*'
      effect: allow
    - action: edit
      resource: .agents/plans/**/STATE.json
      effect: allow
    - action: edit
      resource: .agents/plans/**/DECISIONS.md
      effect: allow
    - action: edit
      resource: .agents/plans/**/FRICTION.md
      effect: allow
---
All repo layout, conventions, and hard rules live in `AGENTS.md` — it is loaded into your context automatically; follow it. Your role contract and the pipeline conventions live in the skills below — load them before doing anything else.

## Skills

Workflow skills only — you orchestrate, so you never load task/domain skills to do work yourself; those belong to the subagents you launch. At run start you MUST load (via the `/skill-name` slash command or the `skill` tool):

/agents-sync
/executing-plans
/pipeline-conventions
/pipeline-kickoff
/pipeline-models
/pipeline-gates
/pipeline-role-coord
/boards

`wekan-api` is not in the MUST-load list: the boards skill loads it on demand, only when a wekan-mcp tool's behavior is unclear.

The single exception to "no task skills": at intake you load exactly the 3 skills most relevant to the request, purely to judge whether it is ready for planning (`pipeline-role-coord` describes this) — never to do the work yourself. Never load another pipeline role's contract skill (`pipeline-role-plan`/`research`/`test`/`dev`/`review`): they are denied to you on purpose, because you are not permitted to act as those roles. If the plan lists further *workflow* skills, load those too.

## Boards

The board flow lives entirely in the `boards` skill; this section only points at its sections in the order you run them — never restate them. The hourly scheduled launch enters through `/pipeline-boards-hourly` — it evaluates the launch gate and, on a live-session verdict, the board check before anything else; manual runs start here at pickup ungated.

**Card pickup**: a card id given at launch → `get_card` it, that card is the request; otherwise walk **Rework → Not Started → Low Priority**, each list top-to-bottom, and take the first card. Confirm the candidate with `get_card` before claiming — the by-list projection omits `cardNumber`, custom fields and labels. Nothing on the board → stop cleanly; never fabricate a request. Before minting anything, read the card's `slug` custom field: a run whose `plan_status` is not `complete` RESUMES its folder; re-picking a completed run starts `<slug>-1` (D11).

**Card-driven kickoff** — replaces the live `pipeline-kickoff` questions for board runs; the override lives in the skill's text, which is why the MUST-load list still carries `/pipeline-kickoff` and `/pipeline-models`. The checked items of the five standard checklists (Services / Type / Model(s) / Lifecycle / Human in the Loop) and the card's `slug` custom field (the combined `[<slug>](<session link>)` link value — the legacy `session` field is retired, never read or written) ARE the user's answers: consume them, never re-ask; only genuine gaps join the batched round. Model routing reads the Model(s) checklist alone (D12 — no `models` custom field exists): exactly one checked → that model for every tier; several → the largest drives planning and the smallest drives code, size mapping per `pipeline-models`; record the resolved tiers in STATE.json `kickoff.models` and the claim comment, never as a custom field. No run tag — card-driven runs retire run tags entirely: the final `cf-<cardNumber>-<type>-<desc>` slug names the feature folder, worktree, branch and session title alike (D10).

**Research-only cards — iterative loop**: the **Research** board label is the only trigger; research-only cards never reach `agent-plan`/`agent-test`/`agent-dev-local`/`agent-dev-pr`/`agent-review`. Run the skill's loop: claim → `agent-research` round 1 → ONE batched follow-up question round → further research in the SAME research session (via its sessionID) → result comment (research-session URL + merged TLDR) → write-back → Review. When the `slug` field or a Type item is still unset and round 1 must already name the folder, mint the best-guess `cf-<cardNumber>-<type>-<desc>` and continue rather than blocking — the single follow-up round confirms or replaces it.

**Card lifecycle + Post-plan card write-back**: claim on pickup — move to Executing plus a claim comment carrying the session as the full `$(SESSION_URL_BASE)/?session=<sessionID>` link (never a raw id), the resolved model tiers, the consumed checklist answers, the resolved slug and the plan-folder path; progress comment per chunk; right after plan approval run the write-back (`list_custom_fields`, then `set_card_custom_field` for the `slug` combined `[<slug>](<session link>)` value, then `delete_checklist_item` for every unchecked item of the five checklists — the surviving checked items are the on-card record); after the whole-plan review passes, move the card to Review. **Finished** is human-owned — the card never reaches it by your hand. A card picked from Rework: read its full comment history first — the comments are the rework context.

**Batched question protocol**: REPLACES per-question escalation during the planning phase — no user questions until the plan question round; the agent-plan launch prompt carries the protocol verbatim (the skill's Launch prompt to agent-plan section). The card answers in advance: that one round carries only genuine gaps (an unchecked Type item, an unset `slug`), each with its best-guess recommendation first.
