---
name: agents-sync
description: Build, extend, install, and repair the plan-first agent pipeline (coord/plan/research/test/dev/review roles x variants, per-ticket plan folders, friction log, RESULT handoffs) and sync it between repos with rulesync. Use whenever setting up the /pipeline agent workflow in a new repo, adding or changing agent roles/variants/permissions/skills, editing .rulesync/subagents sources or regenerating agent files, auditing permission drift, or debugging why a pipeline subagent could or could not write a file. Also covers the hard-won operational lessons (permission drift is silent, verify syncs/deploys landed, one branch one concern).
targets: ["*"]
---

# Agents sync

The plan-first chunk pipeline: a coordinator runs an approved plan through a one-shot test writer (agent-test drafts every chunk's tests in one session, before implementation), then chunk by chunk through fresh dev → review subagents (review runs the validations first, then reviews; plus a final whole-plan review before handoff), and commissions deep research on demand via agent-research — with all living state in per-ticket plan folders and a friction log that stops every run from rediscovering known problems.

## Architecture in one picture

```
.rulesync/                                  canonical sources (single source of truth)
  rules/*.md                                repo rules -> generated AGENTS.md
  subagents/agent-<role><suffix>.md         6 roles x N variants (thin
                                            frontmatter + /skill call skeletons)
  commands/pipeline*.md                     /pipeline + /pipeline-resume per variant
  skills/pipeline-*/                        hidden contract skills the agents
                                            MUST-load (conventions, role
                                            processes, kickoff, models, gates)
  skills/agents-sync/                   this skill (the methodology)
        |  rulesync generate                (targets/features per rulesync.jsonc)
        v
.opencode/agents/, .opencode/commands/,     generated per tool — NEVER hand-edit;
AGENTS.md, .opencode/skills/                edit the sources above and regenerate
.agents/plans/templates/                    blank PLAN/STATE/DECISIONS/friction/chunks
```

Roles: `coord` (primary, orchestrates), `plan` (planner), `research` (deep research via storm + searxng, commissioned by coord on demand, writes `RESEARCH.md`), `test` (writes every chunk's tests in one session, after planning and before dev), `dev` (implementer; tests are read-only to it), `review` (runs the chunk's validation commands and full suite, then fresh-eyes reviewer; never edits tests), `fuser` (on demand, user-launched; compares parallel runs of a ticket and writes a user-confirmed fusion plan into the chosen base branch). Every domain or workflow overlay is an explicit variant suffix so domains match agent names — this repo ships only the plain set (its `-bmad` overlay was removed 2026-10-18); other repos may add overlays. When they exist, overlay names lead with the overlay marker (`-bmad`, not `-<domain>-bmad`) so a plain name is never a prefix of its overlay's agent names (`agent-dev` does not prefix-match `agent-dev-bmad`) — subagent permission matching is whole-value/exact on OpenCode v2 (verified 2026-10-14 on v2.0.24: cross-variant launches denied, coords see only their own four subagents), and the prefix-free scheme stays correct under any prefix-like behavior. An overlay coordinator launches only its overlay's subagents. The bare `/pipeline` + `/pipeline-resume` commands target the repo's base variant. Never hand-edit generated files — edit the `.rulesync/` sources and regenerate; verify with `git diff` that only the intended files changed.

**Skill assignment is per agent, in its `## Skills` section** (every agent is also told to load extra task-relevant skills as it goes):
1. **Plan-driven first** — load the skills the plan lists; if the plan lists none, evaluate the task against the skills available to the agent and load the most relevant set.
2. **Role pins** — a MUST-load list per role where the repo pins one (this repo: dev → `helm-bjw-s-chart`, `gitops-workflows`, `helm-chart-creation`, `executing-plans`; coord roles carry no task skills and instead get an explicit roster of the four agents they may launch). Overlay variants (other repos) pin their overlay's role skills the same way.
3. **Runtime picks** — each agent loads further relevant skills dynamically, referenced with the `/skill-name` prefix.

**Per-ticket plan layout** (one folder holds everything for a ticket):

```
.agents/plans/
  templates/                        blanks copied into every new ticket folder
  <yyyy>/<yyyy-mm>-<type>-<slug>/   ONE folder per ticket, forever (the
                                    earliest month it started in; <type> =
                                    feat|bug|debug|dep|refactor|chore|docs)
    <yyyy-mm-dd>-<type>-<slug>.md   plan of record (renamed templates/PLAN.md);
                                    runbooks/scripts share its prefix
    STATE.json  DECISIONS.md  FRICTION.md  [RESEARCH.md on demand]  chunks/C01.md...
```

**Files are the bus.** Subagents share nothing but files: every hand-back ends in a RESULT block (schema in `references/plan-and-result.md`), coord writes it verbatim into `STATE.json` before anything else, and appends reported friction to `FRICTION.md`. Read that reference when touching handoff parsing, chunk lifecycle (gates, retry caps, escalation), or the friction lifecycle (`open` → `fixed`/`ignored`, never deleted).

## Editing the pipeline

1. Edit the sources: `.rulesync/subagents/agent-*.md` (role prompts, permission blocks), `.rulesync/commands/pipeline*.md`, `.rulesync/rules/*.md` (repo context → AGENTS.md), `.agents/plans/templates/`.
2. Regenerate: `rulesync generate` (targets/features from `rulesync.jsonc`). Commit the generated surfaces alongside the sources — they are tracked files that other tools (Kilo, fresh worktrees) read directly.
3. Diff: `git status` should show only the generated files your change implies (e.g. a permission change touches every generated agent of the affected role — one file per role in this repo's plain set). Renaming a role or suffix orphans old generated files — delete the old sources and regenerate; `generate --delete` sweeps orphans.
4. Re-run the generator twice; the second run must be a no-op (idempotence check).

Permission rules are ordered and **last match wins** — broad allows early, specific denies after. Full role × permission matrix, the audit checklist, and the drift incidents already hit in production are in `references/permissions.md`. Read it before changing any permission block or when investigating "a subagent wrote something it shouldn't have."

## Syncing into another repo

The sources in `.rulesync/` are portable: another repo pulls this skill (and, if wanted, the subagents/commands) via `rulesync fetch` or declarative `sources:` entries, or this repo's setup is copied over and re-targeted. Domain adaptation (rules source = the target's AGENTS.md, MCP permission naming, skill availability), and the post-install checklist live in `references/syncing-to-other-repos.md`.

## Hard-won lessons (read before shipping anything new)

- **Permission drift is silent.** Paths evolve (plans moved root → per-ticket; MCP servers get renamed; generated surfaces move) while permission rules stay literal. Run the audit in `references/permissions.md` whenever files move or servers are renamed — the failure mode is a subagent quietly unable to write, or writing context files it shouldn't (dev's context-file rules: repo-context sources allow-with-deviation-report, agent machinery ask, plans + generated surfaces + registry-managed skills deny).
- **Global `permissions` arrays must lead with the universal default.** The hand-managed machine + project arrays are last-match-wins: a trailing `* *` rule silently turns every allow above it into an ask — invisible on the generated agents (their own rules append after and mask it) but noisy on built-in and hand-authored profiles ("every new agent asks for skill permissions"), and `read *.env` asks die whenever a `read * allow` is placed after them. Shape and verification checklist: `references/permissions.md` § Hand-managed global policy arrays.
- **Verify syncs/deploys landed.** In GitOps, a sync can reject individual items without failing overall, and the next reconcile can write old live state back over the repo work. After any sync, check the items you shipped (readonly cluster MCP / `kubectl get`) before walking away. Same for generation: diff after `rulesync generate` — a rewrite you didn't expect means a source you didn't know about.
- **One branch, one concern, verified facts.** Plan files record verified facts with evidence (counts, timestamps, hashes) and append-only decision logs — when fusing or resuming work, re-verify from live state rather than trusting any summary.

## Related

- Repo conventions home: `AGENTS.md` (generated from `.rulesync/rules/`).
- `references/pipeline-overview.md` — how the pipeline runs, permissions summary, known OpenCode v2 issues.
- `references/plan-and-result.md` — plan folders, STATE.json, RESULT block, friction lifecycle.
- `references/permissions.md` — permission model, role matrix, audit checklist, drift history.
- `references/syncing-to-other-repos.md` — taking the pipeline to another repo with rulesync.
