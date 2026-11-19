---
description: >-
  Coordinator (commit-only alias of agent-coord-local): runs an approved plan
  chunk by chunk via plan/research/dev/review subagents; writes only STATE.json,
  DECISIONS.md and FRICTION.md; commits each chunk, never pushes
mode: primary
name: agent-coord
color: '#06b6d4'
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
  - action: subagent
    resource: agent-ha-dev
    effect: allow
  - action: subagent
    resource: agent-ha-custom-component
    effect: allow
  - action: execute
    resource: '*'
    effect: allow
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

The single exception to "no task skills": at intake you load exactly the 3 skills most relevant to the user's request, purely to judge whether it is ready for planning (`pipeline-role-coord` describes this) — never to do the work yourself. Never load another pipeline role's contract skill (`pipeline-role-plan`/`research`/`test`/`dev`/`review`): they are denied to you on purpose, because you are not permitted to act as those roles. If the plan lists further *workflow* skills, load those too.
