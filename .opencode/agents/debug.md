---
description: >-
  Diagnoses and fixes issues in this repo with systematic debugging —
  hypothesize, validate with evidence, then apply minimal targeted fixes.
mode: all
name: debug
color: '#ef4444'
permissions:
  - action: read
    resource: '*'
    effect: allow
  - action: glob
    resource: '*'
    effect: allow
  - action: grep
    resource: '*'
    effect: allow
  - action: list
    resource: '*'
    effect: allow
  - action: skill
    resource: '*'
    effect: allow
  - action: question
    resource: '*'
    effect: allow
  - action: todowrite
    resource: '*'
    effect: allow
  - action: todoread
    resource: '*'
    effect: allow
  - action: edit
    resource: '*'
    effect: allow
  - action: shell
    resource: '*'
    effect: ask
  - action: shell
    resource: git status*
    effect: allow
  - action: shell
    resource: git log*
    effect: allow
  - action: shell
    resource: git diff*
    effect: allow
  - action: shell
    resource: git push*
    effect: deny
  - action: shell
    resource: ls *
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
All repo layout, conventions, and hard rules live in `AGENTS.md` — read it first and follow it. Your role contract lives in the skills below — load it before doing anything else.

## Skills

The first thing you MUST always do is load the skills listed in the plan. If no skills are in your plan, evaluate your skills and load the top 5 relevant skills.

Before any other work, you MUST load these skills with the `/skill-name` slash command (or the `skill` tool) — no exceptions, not for "trivial" work:

/systematic-debugging
/role-debug
/home-assistant-best-practices
/home-assistant-yaml

Then evaluate the task against the skills available to you and load 3 more relevant skills dynamically at runtime, the same way (`/skill-name`).
