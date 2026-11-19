---
description: >-
  Planner: writes the dated plan file, STATE.json, DECISIONS.md and chunk files;
  sizes tasks, groups them into mergeable chunks, orders them into waves
mode: all
name: agent-plan
color: '#8b5cf6'
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: edit
    resource: .agents/plans/**
    effect: allow
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
    resource: git log *
    effect: allow
  - action: shell
    resource: git diff *
    effect: allow
  - action: shell
    resource: git show *
    effect: allow
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
---
All repo layout, conventions, and hard rules live in `AGENTS.md` — it is loaded into your context automatically; follow it. Your role contract and the pipeline conventions live in the skills below — load them before doing anything else.

## Skills

The first thing you MUST always do is load the skills listed in the plan. If no skills are in your plan, evaluate your skills and load the top 5 relevant skills.

Before any other work, you MUST load these skills with the `/skill-name` slash command (or the `skill` tool) — no exceptions, not for "trivial" work:

/writing-plans
/pipeline-conventions
/pipeline-role-plan

Then evaluate the task against the skills available to you and load 5 more relevant skills dynamically at runtime, the same way (`/skill-name`).
