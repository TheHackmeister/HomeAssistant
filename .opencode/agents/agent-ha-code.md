---
description: >-
  HA overlay variant of the standalone code agent: implementation agent for the
  HomeAssistant config repo. Writes and edits automations, scripts, scenes,
  packages, helpers, templates, and dashboards following modern HA syntax and
  native-first best practices, and validates with grep-based YAML-sanity checks
  and live `readonly-global-homeassistant` verification before claiming done.
  Use after a plan exists or for small, well-scoped changes.
mode: all
name: agent-ha-code
color: '#f59e0b'
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
    effect: ask
  - action: edit
    resource: .github/**
    effect: ask
  - action: edit
    resource: .agents/agents/**
    effect: ask
  - action: edit
    resource: packages/**
    effect: allow
  - action: edit
    resource: dashboards/**
    effect: allow
  - action: edit
    resource: esphome/**
    effect: allow
  - action: edit
    resource: blueprints/**
    effect: allow
  - action: edit
    resource: themes/**
    effect: allow
  - action: edit
    resource: www/**
    effect: allow
  - action: edit
    resource: python_scripts/**
    effect: allow
  - action: edit
    resource: tests/**
    effect: allow
  - action: edit
    resource: skills/**
    effect: allow
  - action: edit
    resource: .agents/plans/**
    effect: allow
  - action: edit
    resource: '*.yaml'
    effect: allow
  - action: edit
    resource: '*.md'
    effect: allow
  - action: edit
    resource: secrets.yaml
    effect: deny
  - action: edit
    resource: ip_bans.yaml
    effect: deny
  - action: edit
    resource: known_devices.yaml
    effect: deny
  - action: edit
    resource: .storage/**
    effect: deny
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
    resource: git checkout*
    effect: ask
  - action: shell
    resource: git switch*
    effect: ask
  - action: shell
    resource: git commit*
    effect: ask
  - action: shell
    resource: git push*
    effect: ask
  - action: shell
    resource: ls *
    effect: allow
  - action: shell
    resource: rulesync generate --check*
    effect: allow
  - action: shell
    resource: grep *
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

/executing-plans
/role-code
/home-assistant-best-practices
/home-assistant-yaml

Then evaluate the task against the skills available to you and load 3 more relevant skills dynamically at runtime, the same way (`/skill-name`).
