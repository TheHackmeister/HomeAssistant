---
targets:
  - '*'
name: debug
description: >-
  Diagnoses and fixes issues in this repo with systematic debugging —
  hypothesize, validate with evidence, then apply minimal targeted fixes.
opencode:
  mode: all
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
      # add/commit stay at the shell-ask baseline (interactive agent);
      # push is denied outright — landing is never debug's job
    - action: shell
      resource: git push*
      effect: deny
    - action: shell
      resource: ls *
      effect: allow
      # cf-93 C06 fold, replicated by C07, of the hand-written debug prompt
      # (identical seed in both ported HA repos; it allowed the
      # homeassistant_* read tools by name): fleet naming prefix instead —
      # readonly inspection free, admin mutations blocked outright
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
      # Workspace isolation surface: a run with no worktree can mint one and
      # move its session in via the opencode MCP tools (the native-tool path
      # executing-plans / using-git-worktrees expect). No execute row: this
      # role has no deny baseline, so Code Mode falls through to the global
      # ask — the interactive agent approves once per run.
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
