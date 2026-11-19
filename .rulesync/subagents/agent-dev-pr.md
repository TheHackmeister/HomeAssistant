---
targets:
  - '*'
name: agent-dev-pr
description: 'Implementer: implements one chunk against its acceptance criteria; tests are read-only to it (written up-front by agent-test); no commits — the coordinator commits each approved chunk; pushes the ticket branch for remote build/test per pipeline-push-pr'
opencode:
  mode: all
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
      # Context files dev may update when a chunk needs it — report under deviations
    - action: edit
      resource: skills/**
      effect: allow
      # Agent machinery (rulesync sources/config, fleet config, registry lock):
      # explicit user approval (unattended runs treat ask as blocked)
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
      # Repo context sources dev may update (they generate AGENTS.md / skills)
    - action: edit
      resource: .rulesync/rules/**
      effect: allow
    - action: edit
      resource: .rulesync/skills/**
      effect: allow
      # Generated surfaces: never hand-edit — `rulesync generate` owns them
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
      # Agent machinery (ticket plans, the synced third-party skills
      # registry, generated agent/command definitions) stays closed — order:
      # these denies are last. .kilo is denied wholesale: it symlinks into
      # .agents. (cf-93 C06 port: the source repo's .agents/notes/** allow
      # is dropped — this repo has no notes surface.)
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
      # Git writes: add/commit denied — the coordinator commits the chunk
      # once review approves (cf-76 D7, loud-denial parity with the push
      # denies below); push stays allowed for remote build/test, main/force
      # still never
    - action: shell
      resource: git add *
      effect: deny
    - action: shell
      resource: git commit *
      effect: deny
    - action: shell
      resource: git push*
      effect: allow
    - action: shell
      resource: git push*main*
      effect: deny
    - action: shell
      resource: 'git push --force*'
      effect: deny
    - action: shell
      resource: 'git push -f*'
      effect: deny
    - action: shell
      resource: 'git push * --force*'
      effect: deny
    - action: shell
      resource: 'git push * -f*'
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
      # Workspace isolation surface: a run with no worktree can mint one and
      # move its session in via the opencode MCP tools (the native-tool path
      # executing-plans / using-git-worktrees expect). No execute row: these
      # roles have no deny baseline, so Code Mode falls through to the global
      # ask — an interactive standalone run gets one prompt, while unattended
      # pipeline devs stay structurally blocked from minting surfaces their
      # coordinator owns.
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
/pipeline-conventions
/pipeline-role-dev
/pipeline-push-pr

Then evaluate the task against the skills available to you and load 3 more relevant skills dynamically at runtime, the same way (`/skill-name`).
