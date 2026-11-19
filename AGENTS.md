# Comments and code quality

- Comments explain **why** (constraints, invariants, trade-offs, links to issues). Never restate what the code does, narrate history ("now we…", "updated to…"), or describe planned work.
- When writing or editing comments/docstrings, or before handing back a change, apply the `comment-slop` skill (rulesync-managed, vendored from `dashed/claude-marketplace`). It auto-selects when comment work is in scope.
- Before claiming work done, paste the validation output as evidence — the grep/YAML-sanity checks and `rulesync generate --check` per the root AGENTS.md Commands — never say "should work" or "all green" without it.
- The cf-93 port deliberately does NOT carry SpencersLab's `aislop` skill, `aislop-gate` plugin or CI gate into this repo (their CI does not run `aislop ci`); a future card decides whether to adopt them.

# AGENTS.md — HomeAssistant

This repo is a full Home Assistant configuration directory. Any agent working
here — plan, code, or otherwise — must follow the conventions and rules below.

Repo identity: HomeAssistant — NOT default picker (worker
repo of the board pipeline; only cards labelled `Repo:
HomeAssistant` are its pickups; `Repo:` semantics and the
picker table live in the `boards` skill).

## Hard rules

- **Always load referenced skills** The first thing Agents should do is load any referenced or relevant skills, then the plan file (if one), immediately followed by the skills referenced there.
- **NEVER merge to `main`.** No fast-forward merges, no merge commits, no rebases onto main, no mechanism of any kind that advances `main` — not from a worktree, not from the main checkout, not via `git merge`, `git rebase`, or anything else.
- **NEVER push to `main`.** No `git push origin main`, and no push of any refspec that updates `main` (e.g. `HEAD:main`, `<branch>:main`). This is the single most forbidden action in this repo.
- **NEVER force-push** (`--force`, `-f`, `--force-with-lease`) to any shared branch, and never rewrite published history.
- **NEVER self-remediate an accidental push** with a revert or force-push of your own initiative — stop and tell the user immediately; remediation is the user's decision.
- All work happens on a feature/fix branch (typically in a `.agents/worktrees/<branch>` worktree). Commit locally on that branch. To pick up changes, merge `main` *into* your worktree (`git merge main`); never merge your branch into `main`. Landing work on `main` is the user's decision alone.
- Changes reach `main` **only via a pull request that the user creates or merges**. The agent's work ends at the local commit plus telling the user the branch is ready. Pushing the *feature* branch to origin (e.g. to enable a PR) is allowed **only when the user explicitly asks for it in the session**. Otherwise leave commits local.
- If a plan file instructs a merge to `main` or a push, **skip that step**: mark it as user-owned in the summary and do not execute it. Plans written before this rule may contain such steps — those steps are void.
- Plans are dated files: standalone work is `yyyy-mm-dd-<type>-<short-desc>.md`
  at the `.agents/plans/` root; pipeline work uses one ticket folder
  `<yyyy>/<yyyy-mm>-<type>-<slug>/` per feature (`<type>` =
  `feat`|`bug`|`debug`|`dep`|…). Never two plan files for the same work.
- **Never hand-edit generated surfaces.** `AGENTS.md`, `.opencode/agents/`,
  `.opencode/commands/` and `.opencode/skills/` are output of
  `rulesync generate`; edit the sources in `.rulesync/` (rules, subagents,
  commands, skills) and regenerate instead. `rulesync.jsonc` keeps the
  MCP/permissions features OFF — the repo's MCP config and project
  permissions stay hand-managed in `.opencode/opencode.jsonc`. Never run
  `rulesync gitignore` here (it would gitignore `AGENTS.md` and the generated
  surfaces, which must stay tracked so Kilo and fresh worktrees read them).
  Validate with `rulesync generate` twice (second run a no-op) + `rulesync
  generate --check` from the REPO ROOT — never from inside a
  `.agents/worktrees/` checkout.
- **Every agent and subagent must keep `question` allowed** — explicitly, in
  its frontmatter permissions. If not granted explicitly, questions are
  denied by default and stage gates / escalations fail silently.

## Repository layout

- `configuration.yaml` — root config. Includes `automations.yaml`,
  `scripts.yaml`, `scenes.yaml`, `groups.yaml`. Packages via
  `homeassistant: packages: !include_dir_named packages`.
- `packages/` — preferred home for cohesive feature bundles
  (`package_<name>.yaml`): automations + scripts + helpers + template entities
  + inputs together. Existing: label_printer, house_climate, house_locks,
  house_modes, infra, room_bedroom, room_office, sports_ball,
  unavailable_entities, vacuum, wekan.
- `themes/` — frontend themes (`frontend: themes: !include_dir_merge_named themes`).
- `dashboards/` — YAML-mode dashboards, each registered under
  `lovelace.dashboards:` in configuration.yaml (existing: home-farm,
  label-printer). The **main Lovelace dashboard runs in storage mode** —
  resources and cards there are managed via UI/API, never by writing files.
- `blueprints/`, `custom_components/` (incl. `labeled_features`),
  `python_scripts/`, `esphome/`, `www/`.
- `.agents/plans/` — plan documents: standalone (non-pipeline) work is dated
  files `yyyy-mm-dd-<type>-<short-description>.md` at the plans root (date
  prefix, never unix epoch; `<type>` = `feat`|`bug`|`debug`|`dep`|…); pipeline
  work lives one ticket folder
  `.agents/plans/<yyyy>/<yyyy-mm>-<type>-<slug>/` per feature.
- `.agents/plans/templates/` — blank pipeline boilerplate (PLAN.md,
  STATE.json, DECISIONS.md, FRICTION.md, chunks/) that `agent-plan` copies
  into each new ticket folder.
- `.agents/agents` / `.agents/commands` — symlinks into the generated
  `.opencode/agents|commands` dirs (never hand-edit; edit `.rulesync/`
  sources and regenerate).
- `.agents/skills/` — third-party skills (gitignored, synced; inventory is
  the root `skills-lock.json` — registry-managed, READ-ONLY to agents).
- `.agents/loops/pipeline-worker.md` — scheduled board-worker loop (ships
  `enabled: false` — enablement is human-owned).
- `.agents/worktrees/` — gitignored pipeline worktrees (leave alone).
- `.kilo` — tracked symlink to `.agents/`, so kilo loads the same agents,
  plans, and skills.
- `.rulesync/` — single source of truth for AI-tool config: rules/ (→
  AGENTS.md), subagents/ (→ .opencode/agents/), commands/ (→
  .opencode/commands/), skills/ (→ .opencode/skills/). Edit here, then
  `rulesync generate` from the REPO ROOT.
- `.opencode/` — real tracked dir: generated `agents/`, `commands/`,
  `skills/` (rulesync output — never hand-edit) plus hand-managed `plugin/`
  (the three pipeline plugins and the owner's `cost-title.ts`),
  `extensions/` (owner content), and `opencode.jsonc` (project config:
  dev-cluster MCP servers + gpu-ai provider + permissions).
- `scripts/` — repo-machinery scripts launched by pipeline surfaces (board
  gate, kickoff branch mint, session origin, probes).
- Secrets live in `secrets.yaml` (gitignored) and are referenced with
  `!secret`. Never write real credentials anywhere else.

## Repo-specific systems

- Root `configuration.yaml` uses heavily commented YAML with section-divider
  comment blocks. Preserve and extend that comment style when editing it.

## Live instance (homeassistant MCP)

The `homeassistant_*` MCP tools reach the running HA instance. Since the cf-93
port these servers are tier-named: read-only inspection (states, references,
template rendering, config validation, traces) goes through
`readonly-global-homeassistant` freely; anything that mutates the live
instance runs only through `admin-global-homeassistant` and needs the user's
explicit confirmation first (see MCP servers below). Use them to
verify entities, states, references, and to validate config instead of
guessing:

- `homeassistant_get_system_info` — HA version (determines valid syntax).
- `homeassistant_get_state`, `homeassistant_query_entities`,
  `homeassistant_get_registry` — verify entity_ids before wiring them.
- `homeassistant_analyze_entity`, `homeassistant_find_references` — impact
  analysis before renaming/replacing/restructuring anything existing.
- `homeassistant_render_template` — test Jinja2 before committing it.
- `homeassistant_validate_config` — validate after YAML edits.
- `homeassistant_manage_trace`, `homeassistant_get_logbook` — verify behavior.

### Where to get logs

- **Home Assistant logs and traces**: use the homeassistant MCP server —
  `homeassistant_manage_system_log` (action=list) for HA WARN/ERROR log
  entries, `homeassistant_manage_trace` for automation/script execution
  traces, `homeassistant_get_logbook` for the event history.
- **MCP server logs** (the homeassistant MCP server itself, or any other MCP
  server running in the cluster): use the `readonly-home-kubernetes` MCP
  server (servers are named `readonly|admin-<cluster>-<service>`). The ha-mcp
  workload is pod `homeassistant-0` in namespace `default` (proxy deployment
  `homeassistant`); fetch logs with `readonly-home-kubernetes_pods_log`.

**Troubleshooting MCP auth:** ha-mcp gets its HA long-lived access token
either from the client request (`Authorization: Bearer <token>` header in the
kilo.jsonc MCP entry) or from `HA_TOKEN`/`HA_URL` in the `homeassistant-mcp`
secret feeding the pod env (secret changes need a pod restart — envFrom is
only read at container start). Symptom of a missing token: every tool call
fails with `authorization header with Bearer token required` and pod logs show
`Failed to get HA client`. If MCP is ever unavailable, fall back to reading
repo YAML and state explicitly in plans/summaries that live verification was
skipped. (Resolved 2026-09-05 after server update; HA 2026.7.4 confirmed.)

## Hard syntax rules (modern HA)

- `action:` not `service:` (renamed HA 2024.8); NEVER `service_template` or
  `data_template`.
- Plural automation keys: `triggers:`, `conditions:`, `actions:` (HA 2024.10);
  inside a trigger use `trigger: state`, not `platform: state`.
- `entity_id` belongs under `target:`, not inside `data:`.
- Quote string states (`to: "on"`); numeric comparisons use `| int` / `| float`.
- Template entities use the `template:` integration — legacy
  `platform: template` was REMOVED in HA 2026.6 and will not load.
- `color_temp_kelvin`, never `color_temp` (removed 2026.3).
- Presence: `state` trigger `to: home` / `to: not_home` — `entered_home` /
  `left_home` device triggers were removed in 2026.5.
- Purpose-specific triggers/conditions are the default since 2026.7; use
  current key names (`battery.became_low`, `behavior: each`/`all`) — old
  Labs-era keys no longer load.
- Automations need `id:` (UI compatibility) and a descriptive `alias:`;
  multi-trigger automations need a per-trigger `id:`.
- Templates: filter `states` by domain (`states.sensor`, not bare `states`),
  add `| default(...)` for entities that may be unavailable.
- **Package merges drop empty dicts** — HA's packages merge
  (`_recursive_merge` in `homeassistant/config.py`) silently skips any
  `key: {}` value while still creating the parent key. Inside `packages/`,
  `selector:` + `text: {}` reaches HA as `selector: {}` → "Only one type can
  be specified" → **the whole script is disabled** (bit all 9 Label Based
  Features scripts on 2026-09-26 after the move from `scripts.yaml` into
  packages). In package files write config-less selectors in null form
  (`selector:` + `text:` / `boolean:` / `entity:` / `object:` — null is
  accepted by every selector CONFIG_SCHEMA), never `<type>: {}`.
  `scripts.yaml` is a direct include, so `{}` is fine there. Empty
  `data: {}` / `metadata: {}` / `default: {}` are dropped too, but
  harmlessly (templates must guard with `| default({})`).

## Hard design rules (native first)

- Prefer purpose-specific triggers/conditions → generic native
  triggers/conditions → templates, in that order. `numeric_state` over
  `float >` templates; `condition: time` over `now().hour` templates;
  `wait_for_trigger` over `wait_template`.
- Prefer helpers over template sensors: `min_max` (sum/mean/min/max), `group`
  (any/all), `derivative`, `threshold`, `utility_meter`, `counter`, `timer`.
  Prefer Template Helpers created via config flow/UI
  (`homeassistant_manage_helper`) over `template:` YAML; trigger-based
  template YAML inside packages is acceptable for complex sensors (this repo
  does both).
- Choose automation `mode:` deliberately: `restart` for motion/timeout
  patterns, `queued` for sequential hardware actions, `parallel` for
  independent per-entity work, `single` for one-shots.
- Target by `entity_id`, not `device_id` (device_id breaks on re-add).
  Exceptions: Z2M autodiscovered device triggers; ZHA remotes use `event`
  trigger with `device_ieee`.
- Never edit `.storage/` files. Never hand-patch UI-configured integrations —
  use the HA API/MCP tools or direct the user to the UI.
- **Safe-refactoring gate:** before renaming an entity, replacing a template
  sensor with a helper, or restructuring triggers, read
  `.agents/skills/home-assistant-best-practices/references/safe-refactoring.md`
  and run impact analysis (`homeassistant_analyze_entity` /
  `homeassistant_find_references`). Renames silently break dashboards, scenes,
  Config-Entry data, and storage dashboards.

## Dashboard rules

- Default to `type: masonry` views — safe on all HA versions. Only use
  `type: sections` when explicitly requested (HA 2024.6+, blank-page risk
  otherwise).
- New YAML dashboards: create `dashboards/<name>.yaml` AND register it under
  `lovelace.dashboards:` in configuration.yaml. Main-dashboard changes are
  storage-mode (UI/API via `homeassistant_manage_dashboard`).
- Styled cards need HACS dependencies (card-mod, button-card,
  mini-graph-card, mushroom) — list them. Nine ready-made styles live in
  `.agents/skills/ha-dashboard-design/references/` (glassmorphism,
  dark-minimal, material-you, nordic, neon-cyberpunk, warm-home, soft-pastel,
  luxury-gold, retro-terminal).

## Attribution for new files

Add attribution to every NEW file created (not when editing existing ones):

```yaml
# Generated by aurora@aurora-smart-home (home-assistant skill)
# https://github.com/tonylofgren/aurora-smart-home
```

For Markdown, directly under the H1:
`> *Generated by [aurora@aurora-smart-home (home-assistant skill)](https://github.com/tonylofgren/aurora-smart-home)*`

## Deep-dive skill references (read on demand, not upfront)

- `.agents/skills/home-assistant-yaml/references/` — official 2026
  triggers/conditions/actions references first (`*-2026-official.md`), plus
  automations, blueprints, Jinja2, template sensors, helpers, scenes,
  packages, presence, notifications, integrations (ZHA, Z2M, MQTT, ESPHome,
  Matter, Shelly, Tuya, Frigate, Node-RED...).
- `.agents/skills/home-assistant-best-practices/references/` —
  automation-patterns, helper-selection, template-guidelines, device-control,
  safe-refactoring, dashboard-guide, dashboard-cards, blueprint-guide, scenes,
  appdaemon, examples.yaml.
- `.agents/skills/ha-dashboard-design/references/` — the nine style files and
  image-prompts.

## Agents

Agent definitions are GENERATED: edit the sources in `.rulesync/subagents/` then
run `rulesync generate` (targets/features per `rulesync.jsonc`) — never
hand-edit `.opencode/agents/` or its `.agents/agents` symlink target.

- `planner` (`.agents/agents/planner.md`) — writes implementation-ready
  plans to `.agents/plans/`. Use before any non-trivial change. (Named
  `planner`, not `plan`, to stay clear of the built-in plan mode; it replaces
  the pre-port `plan` agent.)
- `code` (`.agents/agents/code.md`) — executes plans. Runs in fresh sessions:
  the plan file tells it which skills and MCP servers to load. Explicitly no
  pipeline context: a ticket folder or chunk id is redirected to the `dev`
  family.
- `dev` family (`.agents/agents/dev.md`, `dev-local.md`, `dev-pr.md`) —
  standalone one-session-sized implementers carrying the pipeline's
  discipline: `dev-local` commits, never pushes; `dev-pr` additionally
  pushes the branch for remote build/test under `pipeline-push-pr`; plain
  `dev` is a commit-only alias of `dev-local` — an edit to one lands on both
  in the same commit. Handed a ticket folder + chunk id they run pipeline
  work; the `role-dev` skill is their contract.
- `ask` (`.agents/agents/ask.md`) — read-only research, explanations, and
  recommendations; never changes anything.
- `debug` (`.agents/agents/debug.md`) — systematic diagnosis and minimal
  targeted fixes.
- `review` (`.agents/agents/review.md`) — advisory code review; never edits.
- `agent-*` (`.agents/agents/agent-{coord,coord-local,coord-pr,plan,research,test,dev-local,dev-pr,review,fuser,board-coord,board-coord-local,board-coord-pr,board}.md`;
  the implementer ships as `agent-dev-local`/`agent-dev-pr` — no commits (the
  coordinator commits each approved chunk; the pr variant additionally pushes
  the ticket branch); coords launch their matching dev) —
  chunk-based pipeline: `agent-coord` (primary) runs an approved plan through
  fresh `agent-plan`/`agent-test`/`agent-dev-local`/`agent-review` subagents
  (plus `agent-research` on demand), one chunk at a time, with files as the
  only shared memory; when all chunks are done it runs a final whole-plan
  review before marking the plan complete, then offers to plan fixes for the
  open friction items. The coord agents come in three names each: `agent-coord`
  and `agent-board-coord` are commit-only aliases of `agent-coord-local` and
  `agent-board-coord-local` (kept for command/gate/saved-approval continuity —
  an edit to a twin must land on both in one commit), while
  `agent-coord-pr`/`agent-board-coord-pr` additionally push the ticket branch
  for remote build/test under `pipeline-push-pr`. `agent-fuser` (user-launched,
  on demand) compares parallel runs of the same ticket across branches and
  writes a user-confirmed fusion plan back into the chosen base branch for that
  session to execute. `agent-board-coord` is the board-driven family (alias +
  `-local`/`-pr`): card intake from the WeKan AI-Dev board via the `dev-boards`
  MCP server replaces the live kickoff; launch with `/pipeline-boards` (or
  `/pipeline-boards-pr`); the hourly scheduled entry is
  `/pipeline-boards-hourly` behind `scripts/agent-board-coord-gate.sh`.
  `agent-board` is the WeKan board-MCP worker (card ops + board reads, its
  only MCP grant `dev-boards`; not a coordinator — launches nothing, writes
  no files). Artifacts live in `.agents/plans/<yyyy>/<yyyy-mm>-<type>-<slug>/`.
  Launch with the `/pipeline` commands (`/pipeline-pr` for push-for-remote-
  build/test runs). HA overlay agents (`agent-ha-*`) are a planned follow-up —
  see the cf-93 port notes.

## Skills

**Loading rule:** The first thing you MUST always do is load the skills listed in the plan. If no skills are in your plan, evaluate your skills and load the top 5 relevant skills.

Load with the `skill` tool. Everything here is task-triggered. Skills an agent loads unconditionally live in that agent's file (`.agents/agents/`), not here.

| Skill | Load when | Notes |
|---|---|---|
| `home-assistant-yaml` | General HA YAML work — automations, scripts, scenes, templates, packages, helpers, Lovelace | most common skill; has the 2026 official syntax references |
| `home-assistant-best-practices` | Automation/helper choices, safe refactoring of existing config, dashboards, blueprints | load before restructuring anything existing |
| `ha-dashboard-design` | Dashboard styling — card-mod CSS, button-card templates, visual themes | nine ready-made styles |
| `ha-integration-dev` | Custom integration development in Python (`custom_components/`) | |
| `esphome` | ESPHome device configs and firmware (`esphome/`) | |
| `node-red` | Node-RED flows and visual automation | |
| `api-catalog` | Connecting external APIs (energy, weather, transport, cloud services) to HA | reference with working examples |
| `aurora` | Routing layer when a task spans multiple skills | rarely needed directly |
| `wekan-api` | WeKan REST API or kanban automation work | ported bundle (`.rulesync/skills/wekan-api`) |
| `wekan-home-assistant` | HomeAssistant-specific WeKan package/inbox automations work | self-managed (`skills/`) |

## MCP servers

Named `readonly|admin-<cluster>-<service>`. The regular fleet is
machine-global (`~/.config/opencode/opencode.json`, NOT version-controlled —
visible to every project on this machine), and this repo's project config
`.opencode/opencode.jsonc` (version-controlled) adds the dev-cluster servers
behind `mcp.dev.scifi.farm` — `dev-boards` (the WeKan AI-Dev MCP the board
pipeline needs), `dev-playwright`, `dev-renovate`, `dev-searxng` — plus the
`gpu-ai` provider, merged over the global config (project entries win).
`~/.config/kilo/kilo.jsonc` keeps its own older fleet copy, unmanaged.

| Server | Use when |
|---|---|
| `readonly-global-homeassistant` / `admin-global-homeassistant` | Nearly always — every live-instance check, validation, trace, and entity verification goes through it (readonly tier for inspection; `admin-*` mutations need explicit user confirmation) |
| `readonly\|admin-<cluster>-kubernetes` | MCP server / cluster pod logs (e.g. ha-mcp in pod `homeassistant-0`) |
| `global-searxng` | Web search: HA docs, integration docs, card references |
| `global-playwright` | JS-heavy doc sites, UI verification |

**Keep these lists current:** when a task uses a skill or MCP server not listed
above, add a line to this file (or the relevant agent file) as part of your
change.

**Agent privilege rules:** planning agents (planner, research and the
read-only pipeline stages) may use `readonly-*` servers only — never
`admin-*`. The code/dev family may use `readonly-*` freely but must ask the
user for explicit confirmation before using any `admin-*` server (mutations:
service calls, registry writes, restarts). No tier grants pod exec. The board
pipeline's MCP surface is `dev-boards` — board card reads/writes for intake
and exit, granted by the agent permission blocks.

## Plans

Plans are dated files under `.agents/plans/`: standalone (non-pipeline) work is
`yyyy-mm-dd-<type>-<short-description>.md` at the plans root — a date prefix
(use today's date, **never a unix epoch timestamp**) followed by a one-word
type token so the goal is visible at a glance: `feat` (new
feature/service), `bug` (bug fix), `debug` (troubleshooting/diagnosis), `dep`
(dependency update), or another short type (`refactor`, `docs`, …) when none
fit. Pipeline work lives one folder per ticket:
`.agents/plans/<yyyy>/<yyyy-mm>-<type>-<slug>/` carrying its plan of record
(the same dated-plan naming, inside the folder), `STATE.json`, `DECISIONS.md`,
`FRICTION.md`, `chunks/<id>.md` — boilerplate copied from
`.agents/plans/templates/` — plus `RESEARCH.md` when deep research was
commissioned. **One plan file per piece of work**; the only sanctioned second
plan file is a `<plan-file>-fusion.md` written by `agent-fuser`.
Every plan has a section that names the skills and MCP servers the Code agent must load.

Working mode of the ported machinery (cf-93): the cf-93 port left these files
uncommitted on main by owner ruling; nothing else about this repo's pipeline
flow is exempt from commit discipline. Future runs work the normal flow —
feature/fix branch, worktree under `.agents/worktrees/`, the coordinator
committing each approved chunk — until the owner commits this port and lands
its own PR.

## Feature pipeline (agent-*)

A chunk-based pipeline for multi-step work, complementary to the standalone
`planner`/`code` agents (single-shot planning/implementation). `agent-coord`
runs an approved plan chunk by chunk through fresh `agent-plan`/`agent-test`/
`agent-dev-local`/`agent-review` subagents (`agent-dev-pr` on the `-pr`
variants); files are the only shared memory. Launch with `/pipeline` (plan if
needed, then run) or `/pipeline-resume` (feature folder as argument) — the
plain aliases, commit-only; use `/pipeline-pr`/`/pipeline-resume-pr` when the
branch gets pushed for remote build/test.

The operational contract — plan-folder layout, read order, the RESULT handoff
schema, the role processes, kickoff, model routing, gates — lives in the
hidden `pipeline-*` skills (`pipeline-conventions` + one `pipeline-role-<role>`
per agent, plus `pipeline-kickoff`/`pipeline-models`/`pipeline-gates` for the
coordinator) that every pipeline agent MUST-loads at run start; the agent
files themselves are thin frontmatter + skill-call skeletons. The role ×
permission matrix is in the `agents-sync` skill references
(`permissions.md`). Edit those, not this summary.

### Pipeline specifics in this repo

- For the pipeline, "Commands" and "tests" mean the repo's own validation:
  `rulesync generate --check` when `.rulesync/` machinery is in scope;
  grep-based contract checks; YAML sanity by pure greps — `yamllint` is not
  installed in the agent environment (probed 2026-11-01) and there is no
  pytest harness here; plus live-instance checks through
  `readonly-global-homeassistant` (read-only posture; `admin-*` needs the
  user's explicit confirmation per the privilege rule above). `agent-plan`
  records these in the plan file's "Commands"; `agent-test` writes every
  chunk's test files in one session after planning (before any dev), the
  chunk's dev variant runs them while implementing and `agent-review` re-runs
  them as the first step of every review; `agent-coord` gates a chunk done
  only when they pass. A test judged faulty is never fixed by the reviewer —
  coord routes a mechanical repair silently back to the test session; only a
  fix that session flags `NEEDS_INFO` as functionality-changing becomes a
  user question.
- HA config law applies to pipeline work unchanged: the modern-syntax and
  native-first rules above, `!secret` for credentials, `.storage/` never
  hand-edited, and the safe-refactoring gate before touching existing config.
- Deep research is commissioned, never ad hoc: any agent that needs it
  reports the need via RESULT, `agent-coord` launches `agent-research`
  (storm skill + `global-searxng`), and the summary lands in the feature
  folder as `RESEARCH.md` (next to the plan file — the coordinator passes
  the folder's absolute path in the launch) for every later agent to read.
- Parallel runs of one ticket can be fused: `agent-fuser` compares the runs
  (planning quality, branch code diffs, research findings, friction), the
  user confirms the base branch and every conflicted sourcing choice (always
  with a follow-up confirmation — a single answer is never trusted), and the
  fuser writes `FUSION-REPORT.md` plus `<plan-file>-fusion.md` into the base
  branch's ticket folder and hands the confirmed plan back to that branch's
  pipeline session (its `coord_session` in `STATE.json`) for execution.
- `agent-board-coord` (the commit-only alias of `agent-board-coord-local`,
  with `agent-board-coord-pr` pushing for remote build/test) is the board-driven
  family: card intake from the WeKan AI-Dev board replaces the live kickoff —
  pickup walks `Rework → Not Started → Low Priority` (top card first), the
  Services/Type/Model(s)/Lifecycle/Human in the Loop checklists plus the
  `slug` custom field's combined `[<slug>](<session link>)` value supply the
  kickoff answers — the checked Lifecycle items are the stages the run
  executes (checked-stages-only; nothing checked = the standard
  Plan+Test+Code+Review loop), the Model(s) checklist alone routes models,
  `cf-<card-number>-<type>-<desc>` slugs name the feature folder, worktree,
  branch and session alike; card-driven runs carry no run tag (`agent-coord`
  keeps run tags); the hourly gate counts all three board-coord names alike;
  `Research`-labeled cards run the iterative research-only loop and end at
  Review — see the `boards` skill.
- All Hard rules above (git safety, MCP privilege tiers, generated-surface
  law, question-always-allowed) apply to every pipeline agent unchanged.

The agent files themselves are repo-agnostic on purpose (the same machinery
runs in SpencersLab/HomeAssistant/brother-ptouch-automation); repo grounding
lives in this file, which is loaded into every session automatically.

## Pipeline worker iterations

The `pipeline-locks` plugin (`.opencode/plugin/pipeline-locks/`, hand-
managed) serializes board work per pipeline: a card's `Pipeline:<name>`
board labels name the locks it takes — no such label means the single
`default` pipeline, and several labels block all of those pipelines
all-or-nothing. Cards with disjoint sets run as parallel
`agent-board-coord` iterations; the hourly entry point is the OpenChamber
loop `.agents/loops/pipeline-worker.md`, which SHIPS `enabled: false` in this
repo — scheduler enablement per project is human-owned (cf-76 ruling); until
the owner enables it, `/pipeline-boards-hourly` + `scripts/
agent-board-coord-gate.sh` stay the documented manual fallback. The
top-level "finished" push reaches the phone unless the coord marked the
session no-work AND the launch was of the scheduled kind — the `boards`
skill's no-op marker, read by `question-notify`; manual no-ops always push.
Rules for worker sessions — the `boards` skill owns the detail:

- Repo identity: HomeAssistant — this repo picks up only cards labelled
  `Repo: HomeAssistant`; unlabelled cards belong to the default picker repo.
  `Repo:` semantics live in the boards skill.
- One card per session; never pick or restart a card already in **Executing**
  — pickup walks `Rework → Not Started → Low Priority`.
- `pipeline_claim` BEFORE any board move or code edit (the whole derived
  `Pipeline:` set or nothing — a contended claim names the holder);
  validations green → card to Review → `pipeline_release(outcome:"done")`.
  Finished stays human-owned.
  Blocked → comment + `outcome:"abandoned"`, or let the lock go stale per the
  boards skill.
- The `pipeline_*` tools are Code-Mode only (`execute` → `tools.pipeline_claim`
  etc., flat names) — on v2.1.4 they never appear in the native tool snapshot.
- `PIPELINE LOCK LOST` = stop immediately: no commit, no card move — only a
  fresh run re-claims. The plugin owns `.pipeline/` files; agents never
  read, write, or delete them.
- Stale locks (no heartbeat for 2 h) are reaped: the card moves to the
  **Timeout** list (or queues in `.pipeline/timeouts.jsonl` until that list
  exists) with a Home Assistant alert; Timeout triage is human-owned, like
  Review.
