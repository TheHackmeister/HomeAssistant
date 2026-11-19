---
description: >-
  Implementer (HA overlay variant of agent-dev-local): implements one chunk
  against its acceptance criteria; tests are read-only to it (written up-front
  by agent-test); no commits — the coordinator commits each approved chunk;
  never pushes
mode: all
name: agent-ha-dev
color: '#f59e0b'
permissions:
  - action: edit
    resource: '*'
    effect: allow
  - action: edit
    resource: tests/**
    effect: deny
  - action: edit
    resource: .agents/plans/**
    effect: deny
  - action: edit
    resource: skills/**
    effect: allow
  - action: edit
    resource: .rulesync/**
    effect: ask
  - action: edit
    resource: .opencode/opencode.jsonc
    effect: ask
  - action: edit
    resource: skills-lock.json
    effect: ask
  - action: edit
    resource: rulesync.jsonc
    effect: ask
  - action: edit
    resource: .rulesync/rules/**
    effect: allow
  - action: edit
    resource: .rulesync/skills/**
    effect: allow
  - action: edit
    resource: AGENTS.md
    effect: deny
  - action: edit
    resource: .opencode/agents/**
    effect: deny
  - action: edit
    resource: .opencode/commands/**
    effect: deny
  - action: edit
    resource: .opencode/skills/**
    effect: deny
  - action: edit
    resource: .kilo/**
    effect: deny
  - action: edit
    resource: .agents/skills/**
    effect: deny
  - action: edit
    resource: .agents/agents/**
    effect: deny
  - action: edit
    resource: .agents/commands/**
    effect: deny
  - action: read
    resource: '*'
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
  - action: glob
    resource: '*'
    effect: allow
  - action: grep
    resource: '*'
    effect: allow
  - action: skill
    resource: '*'
    effect: allow
  - action: question
    resource: '*'
    effect: allow
  - action: subagent
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: ask
  - action: shell
    resource: git status *
    effect: allow
  - action: shell
    resource: git diff *
    effect: allow
  - action: shell
    resource: git log *
    effect: allow
  - action: shell
    resource: git add *
    effect: deny
  - action: shell
    resource: git commit *
    effect: deny
  - action: shell
    resource: git push*
    effect: deny
  - action: shell
    resource: ls *
    effect: allow
  - action: shell
    resource: rulesync generate --check*
    effect: allow
  - action: shell
    resource: grep *
    effect: allow
  - action: admin*
    resource: '*'
    effect: deny
  - action: readonly*
    resource: '*'
    effect: allow
  - action: global*
    resource: '*'
    effect: allow
  - action: dev*
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
---
All repo layout, conventions, and hard rules live in `AGENTS.md` — it is loaded into your context automatically; follow it. Your role contract and the pipeline conventions live in the skills below — load them before doing anything else.

## Skills

The first thing you MUST always do is load the skills listed in the plan. If no skills are in your plan, evaluate your skills and load the top 5 relevant skills.

Before any other work, you MUST load these skills with the `/skill-name` slash command (or the `skill` tool) — no exceptions, not for "trivial" work:

/executing-plans
/pipeline-role-dev
/pipeline-conventions
/ha-integration-dev
/home-assistant-best-practices

Then evaluate the task against the skills available to you and load 3 more relevant skills dynamically at runtime, the same way (`/skill-name`).
