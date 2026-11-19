---
name: boards
description: >-
  WeKan AI-Dev board flow for the agent-board-coord pipeline variant — card
  pickup (a given card id, else the top card walking Rework → Not Started → Low
  Priority), card-driven kickoff where the five standard checklists
  (Services/Type/Model(s)/Lifecycle/Human in the Loop) and the single slug
  custom field (combined `[<slug>](<session link>)` value) supply the answers
  pipeline-kickoff would ask live, the checked-stages-only Lifecycle stage gate
  with its single-authority Stage map, run-tag-free cf-<cardNumber>- slugs
  naming every surface, the iterative research-only loop for Research-labelled
  cards (ending at Review), the card lifecycle with post-plan write-back
  (Finished stays human-owned), and the batched question protocol. MUST-loaded
  by agent-board-coord at run start; load it anywhere else when working the
  WeKan AI-Dev board card flow.
---
# Boards

Board-driven intake and exit for `agent-board-coord`. The pipeline machinery (plan folders, chunks, gates, RESULT handoffs) is unchanged from `pipeline-conventions` and `pipeline-role-coord`; this skill defines only the board surface — where work comes from, what the card already answers, how a card moves, and how questions reach the user.

## Board facts

- Instance: `https://wekan.spencerslab.com`; board **AI-Dev**; swimlane **In Process**.
- Lists (six today, seven once the D22 follow-up card lands): **Not Started**, **Executing**, **Review**, **Rework**, **Finished**, **Low Priority** (deprioritised work — picked up last), **Timeout** (reaper destination, created via the D22 follow-up card — never a pickup source; its triage is human-owned like **Review**'s).
- Board label **Research** marks a research-only card; matched case-insensitively by name. The agent never creates or mutates labels (human-owned). Labels whose name starts with `Pipeline:` mark the pipelines a card blocks on the lease-lock surface (Parallel pipeline loops): the TRIMMED remainder of the label name is one pipeline/lock name, ONE card may carry several, and a card with no such label runs on the single `default` pipeline. `Pipeline:` labels are human-created in the WeKan UI and never agent-created or agent-mutated — the same posture as **Research** (D17/D19). Labels whose name starts with `Repo:` name the owning repo of a card for PICKUP filtering (Card pickup): the TRIMMED remainder of the label name is the owning repo's name, matched case-sensitively on the exact `Repo:` prefix, and a card may carry AT MOST ONE `Repo:` label — one carrying more is claimed by none of its conflicting repos, so the walk skips it and the run records the conflict in its RESULT. A card with NO `Repo:` label at all belongs to the DEFAULT PICKER repo (Repo identity below). `Repo:` labels are human-created in the WeKan UI and never agent-created or agent-mutated — the same posture as `Pipeline:` and **Research** (OQ-A1 COEXIST). `Repo:` is a pickup filter, not a lock: it NEVER contributes to the claim set (Parallel pipeline loops, derivation bullet), while `Pipeline:` keeps its lock meaning unchanged — the two prefixes coexist on one card.
- Custom fields: exactly ONE board-level text field — `slug`, carrying the combined `[<slug>](<session link>)` link value — resolved by name with `list_custom_fields`; the legacy `session` field may linger on the live board but is retired: never read, never written (its board-level removal is human-owned). There is no `models` custom field (D12) — model routing rides the Model(s) checklist, never a field. Nor a `pipeline` field — that route was retired with D19: pipeline identity is LABELS, never a third field.
- The five standard checklists on every card (future cards via the multi-action createCard rule — imported per the upgrade-ticket runbook — existing cards via backfill; the runbook owns their maintenance):
  - **Services** — the nine HomeAssistant config-repo work targets: `packages` (feature-bundle YAML under `packages/`), `automations` (root `automations.yaml`), `scripts-scenes` (root `scripts.yaml`/`scenes.yaml`/`groups.yaml`), `dashboards` (YAML-mode dashboards + their `lovelace.dashboards:` registration), `dwains-dashboard` (Dwains dashboard config), `esphome` (ESPHome device configs), `blueprints` (blueprint YAML), plus the two shared targets `home-assistant` (the HA instance itself) and `agent context` (the agent/pipeline machinery). Re-derive the set live from the repo layout; the surface test regenerates it from the repo, so drift here fails loudly (D9). (cf-93 C07 port, replicating the C06 recipe: the source repo's 13 `services/` folder list is SpencersLab-specific — each worker repo ships its own work-target set, OQ-D1.)
  - **Type** — `feat` | `bug` | `debug` | `dep` | `refactor` | `chore` | `docs`.
  - **Model(s)** — `Qwen Large` | `Qwen 27b` | `Qwen Flash` | `Local` (gpu-ai). Default selection: `Qwen Flash`. How the check lands: agents creating cards pass `default_checked` to `create_card` (race-free by construction); the board's multi-action createCard rule carries the checkItem extras, but they are DORMANT until WeKan fixes the broken checkItem rule action upstream (`checkListId` field typo, present v12.64→main — details in the wekan-v12-upgrade ticket). A card that arrives with the default unchecked routes from the default selection WITHOUT mutating the card (see kickoff).
  - **Lifecycle** — `Pre Research` | `Plan` | `Post Research` | `Test` | `Code` | `Review` | `Deploy` | `Single Session`: the stages THIS card runs — only the checked items execute, and the Stage map section below is the single stage→pipeline mapping (coords cite it, never restate it). Default when nothing is checked: the full standard loop — `Plan` + `Test` + `Code` + `Review`, research stages and Deploy off — a card picked up for work cannot mean "run no stages". An unchecked Lifecycle checklist is a valid answer, not a gap: it runs that default WITHOUT mutating the card (the createCard rule's checklist extras stay DORMANT until the upstream WeKan fix — see the Model(s) note).
  - **Human in the Loop** — `Research` | `Plan` | `PR` | `Deployment`: the stages AFTER which the agent must STOP and wait for human input on that card; the checked items are the active stop points. Default: `Plan` — every run pauses for human approval after planning regardless of the checked state (that pause is a pipeline gate, not a card bit); the visible check follows the same situation as Model(s).
- Access: the `dev-boards` MCP server — the wekan-mcp tool set (`get_card`, `list_cards_in_list`, `move_card`, `add_comment`, `list_comments`, `list_checklists`, `get_checklist`, `list_custom_fields`, `set_card_custom_field`, `delete_checklist_item`, …), write-capable; it is the agent's single MCP permission (narrow `dev-boards*`, D21 — server-name spelling: MCP tool ids keep the hyphen).
- `dev-boards` authenticates SERVER-SIDE via login-mint: `WEKAN_USERNAME` + `WEKAN_PASSWORD` arrive from the `wekan-mcp` Bitwarden LOGIN item and the instance URL rides that item's URI field (data, not values-config). The agent never handles credentials.
- Tool behavior unclear → load the `wekan-api` skill for WeKan API semantics (on demand, never at run start).
- The board structure (board, swimlane, lists, label, custom fields, checklist rules, bot membership) is a user-owned prerequisite; if it is missing the flow sees an empty board and stops cleanly per Card pickup.

## Stage map — what each checked Lifecycle item runs

The single authority for the Lifecycle consumption; `pipeline-role-coord` and the board-coord bodies cite this table, never restate it. Checked-stages-only: unchecked stages are skipped end to end; nothing checked runs the full standard loop (the checklist default above).

| Stage | What runs |
|---|---|
| `Pre Research` | `agent-research` round BEFORE planning — findings land in `RESEARCH.md` next to the plan file |
| `Plan` | `agent-plan` + the plan-approval gate (the default pause always applies regardless of checks) |
| `Post Research` | `agent-research` AFTER planning — findings that change the plan go back for a replan |
| `Test` | the ONE `agent-test` session writing every chunk's tests before implementation |
| `Code` | the chunk loop: the coord's `agent-dev-local`/`agent-dev-pr` variant implements, `agent-review` reviews, one chunk at a time |
| `Review` | the final whole-plan review — one fresh `agent-review` session over all chunks |
| `Deploy` | the `-pr` variants: push the ticket branch + open the PR per `pipeline-push-pr` (the explicit-user-request rule still governs); the `-local` variants incl. the alias: report "ready — commits local" and stop; merge and release stay human-owned either way |
| `Single Session` | replaces the Test/Code fan-out: ONE session of the coord's `agent-dev-local`/`agent-dev-pr` variant implements the whole approved plan (running the plan's Commands itself — no chunk loop, no separate test session), then ONE final `agent-review`; `Plan` still runs when checked |

### Transition — cards still carrying the legacy Research checklist

Until the cutover below lands, the live board still ships the old **Research** checklist (`None` | `Before Planning` | `After Planning` | `Agent Decides`). A card carrying only that legacy checklist is consumed with today's semantics: its checked items only time the research around planning and cancel it (`None`) — they never gate the other stages, and the Lifecycle stage gate does not apply to such a card. A card carrying BOTH the legacy checklist and Lifecycle: Lifecycle wins — the stage list comes from the Lifecycle checks alone. The Research board LABEL is untouched by all of this — it stays the only research-only trigger.

### Board-side cutover — human-owned, documented, never agent-executed

Renaming the checklist on the live AI-Dev board is runbook work: (1) rename the **Research** checklist to **Lifecycle**, (2) replace its items with the eight stages above, in card order, (3) update the multi-action createCard rule's checklist extras to match. Agents never mutate board checklists, labels, or rules — the existing labels-are-human-owned posture extends to checklists. Until a human lands steps 1–3, the transition rule above keeps old-shaped cards consumable, and no agent may rename anything on the board.

## Config constants

The values the flow writes onto the board. They are a written-onto-the-board contract: copy verbatim, never re-derive or "correct" them — with one exception. `SESSION_URL_BASE` is the single RUNTIME value: D18/D22 (cf-50 round 2) supersede intake-D20's copy-verbatim rule for that constant alone, and the literal intake-D20 shipped has since been proven a dead host (coderd answers it `400` — malformed app-host grammar), so no reader may treat it as valid. Every other constant below — `RESEARCH_LABEL` in particular — keeps the copy-verbatim/never-re-derive posture byte-exact.

- `SESSION_URL_BASE` — THIS run's OpenChamber origin, defined as the launch command's `Session origin:` line value, copied verbatim. That line was produced at command expansion from the running workspace's Coder app-origin env `$VSCODE_PROXY_URI` (`{{port}}` → the `openchamber` app-slug label; host labels lowercased; the agent label KEPT — coderd parses it away for app slugs). coderd renders the env per deployment, so no label-order assumption survives and nothing is re-derived agent-side. Never a remembered, guessed or historically-observed host.
- Two-leg resolution of this run's `Session origin:` slot (D10/D13, ticket 2026-10-bug-session-origin-no-line): **leg 1** — a launch whose board command expanded takes that command's `Session origin:` line, copy-verbatim, canonical. **leg 2** — a launch with no board command expansion (a raw-chat kickoff, or a restart-reinjected leg that carried no line) runs `bash scripts/session-origin.sh` ONCE at claim and treats its emitted line exactly like the command's line: same vocabulary, same recognition set, same lowercased canonical host; the script executes the block's own derivation and probe fragments byte-equivalently (D12). The free-hand ban holds for both legs — block-or-script are the only sanctioned channels, never an ad-hoc env read or hand-run probe. If the script itself cannot run (grant absent or denied, file missing): the slot takes `Session origin: UNRESOLVED (session resolver unavailable)` — a terminal reason. Leg 2's line carries the block's three reason branches plus that token, and every UNRESOLVED — block-emitted, script-emitted, or resolver-unavailable — routes to the raw-id fallback below unchanged (D23 r2).
- Claim-once record (OQ2/D14): at claim the run writes the slot's line value verbatim — resolved base or the UNRESOLVED line — to STATE.json `kickoff.session_origin`; every later leg of the run RE-USES the recorded value instead of re-resolving, including a post-restart re-supplied launch, and only a run that has established none resolves. A no-line launch is never a stall: the sanctioned manual entry is `/pipeline-boards` (its expansion emits the line, leg 1) and a command-less launch runs the identical flow through the script leg (leg 2).
- The block self-probes its derived host before emitting — one `curl -m 5` at expansion; recognized answers `200`/`30x`/`401`/`403`. `Session origin: UNRESOLVED` is defined precisely, three branches: the app-origin env absent (the launch is not Coder-hosted), the template shape unexpected (`{{port}}` missing), or the derived host answered a code outside the recognition set (`400` malformed, `000` = DNS/connect/timeout — e.g. a brand-new gpu workspace whose exact split-horizon DNS record has not landed; the probe degrades that to the fallback below instead of shipping a broken link). Honest limit: the probe proves coderd recognizes the host from the workspace's own DNS view — not the human LAN view, not the authenticated leg (landing observations cover those).
- On `UNRESOLVED` the run PROCEEDS (user ruling 2026-10-25, D23 r2): every would-be link slot gets the RAW session id — claim-comment session line, the `slug` field's link half (`[<slug>](<raw session id>)`), research-only result comment — and the RESULT records the fallback (open_questions/friction). Never silently re-guess a host, and never write a raw id when an origin DOES resolve.
- Session links are exactly `$(SESSION_URL_BASE)/?session=<sessionID>` whenever this run's origin resolves — the `/?session=` form is OpenChamber's own router format (its integrations build the identical URL). Never a raw session id (D13) — that rule governs the resolved branch; the UNRESOLVED branch writes the raw id BY RULE, not by drift.
- Consistency check (the drift check reworded, D23 r2): every link this run writes must equal this run's `Session origin:` value (or the raw-id fallback when it says UNRESOLVED); a mismatch → RESULT flag, never silently re-guess. Historical links are frozen history — card #50's old comments carry the retired literal and its `session` field was re-pointed 2026-10-25 — compare only THIS run's writes. Whichever leg supplied the slot, the comparison baseline is the recorded `kickoff.session_origin` — a later leg re-uses it rather than re-resolving, so cross-leg drift is impossible by construction.
- `RESEARCH_LABEL = Research` — matched case-insensitively.

## Repo identity

The run's repo name decides which `Repo:` labels this worker picks up. It is the BASENAME of the session's canonical project root — resolved through the sanctioned channel, the PARENT of `git rev-parse --path-format=absolute --git-common-dir` (a main checkout's common dir is its own `<root>/.git`, so the same derivation holds there), never the worktree's own basename — the same `project.canonical` the lock engine anchors on, so every worktree of one repo resolves to the root's name — cross-checked against the repo's own generated `AGENTS.md`, which carries a `Repo identity:` line supplied by that repo's rules source (`.rulesync/rules/overview.md`). Both must agree: no `Repo identity:` line, or a line that does not match the basename → STOP the board-read side and return RESULT `status: NEEDS_INFO` naming the mismatch — never guess a repo name or host (OQ-A2, DECISIONS 2026-10-31). The table keeps all four worker repos in every copy; the default picker is named exactly once, in its row — a ported worker repo copies this body verbatim and flips only the `Repo identity:` line in its own rules source.

`Repo:` label spellings are exact, case-sensitive project directory names (OQ-B2). The owner creates the labels in the WeKan UI — human-owned like `Pipeline:`. The four worker repos:

| `Repo:` label spelling (exact dir name) | Default picker |
|---|---|
| `SpencersLab` | yes — it claims the no-`Repo:`-label cards |
| `HomeAssistant` | no |
| `Home-Assistant-Label-based-Features` | no |
| `brother-ptouch-automation` | no |

Spelling history: card #93's text writes `Home-Assistant-Label-Based-Features` — that capital-B is a mis-cased historical spelling of the LBF directory; the label spelling is the exact lowercase-b dir name in the table above.

## Card pickup

1. Card id given in the launch → `get_card` it; that card is the request.
2. Otherwise walk the lists in order **Rework → Not Started → Low Priority**,
   each list top-to-bottom (`list_cards_in_list` response order IS board
   order) and take the first card found — the highest-sorted card of the
   first non-empty list.
3. Confirm the candidate with `get_card` — the by-list projection omits
   `cardNumber`, custom fields and labels, so pickup facts always come from
   the single-card read.
4. Repo filter (cf-93, OQ-A1 COEXIST) — the candidate is ELIGIBLE for this
   run only when its labels include `Repo:<this run's repo>` (the run's
   repo resolves per Repo identity above), or it carries NO `Repo:` label
   at all AND this repo is the default picker. An ineligible candidate is
   SKIPPED like a contended lock — the walk continues to the next card —
   and repo-mismatch skips consume the same at-most-3 attempts and count
   toward the `no-claimable-cards` no-op reason (no third reason token —
   DECISIONS 2026-10-31). A card carrying more than one `Repo:` label is
   claimed by none of its conflicting repos: skip it the same way and
   record the conflict in the run's RESULT.
5. Nothing anywhere → write the no-op marker with reason `no-cards` (the
   No-op marker subsection; a failed write never delays the end), then
   report no work and stop cleanly: RESULT
   `status: NEEDS_INFO`, `open_questions: no cards on the AI-Dev board`.
   Never fabricate a request.

The card description is the request. Claim the card per the Card lifecycle before kickoff.

The walk never visits **Executing** — a card there is owned by the run holding its pipeline lock set, and one session runs one card — nor **Timeout** (reaper destination; its triage is human-owned). On parallel-pipeline runs the candidate is additionally filtered by lock-set availability per Parallel pipeline loops below. The step-4 `Repo:` eligibility test is part of the walk itself: it runs after the `get_card` confirm and BEFORE the lock-availability check and any claim.

Resume vs new run (D11) — before minting anything, read the card's `slug` custom field (parse: a combined `[<slug>](<session link>)` value yields the slug as its bracketed link text; a legacy bare value yields the slug whole):

- It names an existing feature folder whose `STATE.json` `plan_status` is not
  `complete` → RESUME that run: no kickoff minting, no new slug — continue
  the chunk loop where it stopped.
- The run it names is `complete` (card re-picked, e.g. sent back to Rework)
  → start a new sequential run `<slug>-1`; each further completed re-pick
  continues the sequence `<slug>-2`, ….
- Unset, or no matching folder → fresh kickoff.

## Parallel pipeline loops

The worker iteration one hourly tick drives — C06's tick prompt names exactly this section: run exactly one Parallel pipeline loops iteration, first `pipeline_status`, then follow the skill. One session, one card, one iteration; the card-driven kickoff, Stage map and RESULT machinery all run unchanged underneath it.

- **Transport (D29/D34).** The four lock tools — `pipeline_claim`, `pipeline_release`, `pipeline_heartbeat`, `pipeline_status` — are plugin tools. On v2.1.4 they are reachable ONLY through Code Mode: call `tools.pipeline_claim` etc. from inside `execute` (flat registry ids). They never appear in the native provider tool snapshot, so nothing here relies on the family's per-tool permission rows — those rows are inert future-proofing and the operative grant is the `execute` allow. The `.pipeline/` runtime dir is plugin-owned: agents never read, write, or delete its files — the four tools are the only surface.
- **Derive the pipeline set from the card's labels (D17).** `get_card` the candidate → its `label_ids`; resolve names through `get_board`'s labels (the by-list projection strips labels — the single-card read is the source). Every label whose name starts with `Pipeline:` contributes its TRIMMED remainder as one lock name (matching is case-sensitive on the exact `Pipeline:` prefix; an empty remainder is ignored; duplicates dedupe). NO matching label ⇒ the single `default` pipeline. The claim input is (cardId + derived set) — never a typed pipeline id, never a hand-typed set. Cards carrying `Pipeline:<track>` labels derive that track; unlabelled cards derive `default`. A `Repo:` label NEVER contributes to this set: the claim input derives from `Pipeline:` labels only — `Repo:` is a pickup filter, not a lock (OQ-A1 COEXIST; DECISIONS 2026-10-31 — the locks are already per-repo by each canonical root's `.pipeline/locks/`, so no cross-repo lock name is needed).
- **Pick per lock availability.** Call `pipeline_status` first — cheap, and it proves the plugin is alive in this session. Then run the existing pickup walk (Rework → Not Started → Low Priority, top first; the step-4 `Repo:` eligibility is already applied in the walk) but SKIP a candidate whose ENTIRE derived set is not free: any locked member ⇒ skip the card, its set overlaps a live run. Never pick or restart a card in **Executing**; never pick from **Timeout**.
- **Claim before anything else.** `pipeline_claim(cardId, pipelines, cardTitle)` is all-or-nothing over the derived set and MUST precede the `move_card` to **Executing** and the claim comment — no board move and no code edit happens on an unclaimed card. An `ok:false reason:"locked"` answer names the holder: move to the next candidate, at most 3 claim attempts per session, then write the no-op marker with reason `no-claimable-cards` (No-op marker — a failed write never delays the end), report "no eligible work" and end the session cleanly. The claim comment records the DERIVED PIPELINE SET alongside the session line — a typo'd label silently falls back to `default`, so the set rides on the card to keep label drift visible (plan Risks). The comment names this run's repo the same way, and every repo-mismatch skip is recorded in the run's RESULT — a card parked by a typo'd or missing `Repo:` label stays as visible as a drifted lock set (cf-93).
- **Heartbeats are automatic.** The engine beats the claimed set on root and subagent activity; `pipeline_heartbeat` only force-beats every lock file of the calling session's root claim — not a routine duty.
- **Human stops (D20/D21).** The stale clock (2 h) keeps ticking through every stop point — the plan-approval pause is no exception. An answer inside the window resumes ordinary heartbeats and the lock is fine; past it the reaper reaps the set — the card moves to **Timeout** with a Home Assistant alert, or, until the D22 follow-up card lands a deterministic list-creation tool, queues `.pipeline/timeouts.jsonl` plus a card comment: that degrade is the shipped interim, never a failure. The run then stops at its next PIPELINE LOCK LOST signal. No release-at-stop, no re-claim dance — a re-picked card is a fresh claim under the normal Resume-vs-new-run rule.
- **Exit.** Card to **Review** + summary comment → `pipeline_release(outcome:"done")` — the Review hand-off IS the release point (D6); **Finished** is human-owned and never touches the lock. A blocked card: `add_comment` with the reason, then `pipeline_release(outcome:"abandoned")` — or keep the lock and let it go stale (prefer abandon-release when the card should stay re-pickable for another run, keep-and-stale when THIS run may resume). **PIPELINE LOCK LOST** from any tool answer or hook: stop immediately — no commit, no card move; only a fresh run re-claims.
- **Board-side prerequisites — human-owned, never agent-executed (cf-76).** (1) `Pipeline:<name>` labels are created in the WeKan UI as parallel tracks are wanted; until then every card runs the single `default` pipeline. (2) The **Timeout** list lands via the coordinator-created follow-up card requesting a `create_list` tool for the wekan-mcp surface; until it does, the reaper degrades as above and nothing else is needed. Lists, checklists, labels and rules stay human-owned: this flow only READS labels (`get_card` + `get_board` are the sole board calls the lock surface adds) and mutates nothing — the custom-field roster stays the single `slug` field above.

### No-op marker (alert suppression)

A run that ends without ever claiming marks its OWN session record so the
finished push can stay quiet on scheduled ticks: top-level `metadata.pipelineNoop =
{ at: <epoch-ms>, reason: "no-cards" | "no-claimable-cards" }` — never nested
under `openchamber.*` (the app owns that namespace; the run only reads
`openchamber.kind` there). Writer predicate, conjunctive, observable from the
session's own tool calls: ZERO successful `pipeline_claim` (a `locked`/`ok:false`
answer is not a claim; a held lock means work — never mark, the alert stays)
AND zero board writes. Mark ONLY at the two exits citing this subsection —
the gate's SKIP/LIVE replies stay unmarked (OQ5) — and regardless of launcher:
suppression is the READER's conjunction (question-notify), which additionally
requires the record's OpenChamber launch kind to be the scheduled one, so a
marked manual run keeps alerting — there the marker is forensic evidence, not
a mute button (OQ4). Well-formedness for the reader is a non-empty string
`reason`; `at` is the audit stamp, never a gate (OQ2).

Recipe — the whole-metadata mandate of the `pipeline-kickoff` in-work mark
applies verbatim (citation only: PATCH replaces `metadata` whole, so
read-merge-write or the siblings the reader and OpenChamber depend on die);
self-identify with the sessionID your `session_rename` returns — a no-op exit
renamed nothing yet, so rename to `no-op <yyyy-mm-ddThh:mm>`: the
current-session form answers the id and the title is the human breadcrumb
(OQ3). Then `opencode api get /api/session/<id>` → unwrap the `{"data": …}`
envelope → merge the marker into the CURRENT FULL metadata →
`opencode api patch /api/session/<id> -d '{"metadata": <merged>}'`, epoch
inline via `$(date +%s%3N)`. Any leg failing → end cleanly anyway: no marker
means the alert stands (fail-loud), never a retry loop, never a stall. RESULT
posture is unchanged — no-op ends still report `status: NEEDS_INFO` and stop
cleanly; the marker write or its failure rides in `commands_run`.

## Card-driven kickoff — replaces pipeline-kickoff Q1–Q3 for board runs

For card-driven runs this section REPLACES the live `pipeline-kickoff` questions (type, models, slug + run tag) and feeds `pipeline-models` routing from the card instead of a live question. `pipeline-kickoff` and `pipeline-models` stay byte-identical and authoritative for `agent-coord`; the override lives here, not in their files (D1).

Checked checklist items and set custom fields ARE the user's answers: consume them, do not re-ask what the card answers; only genuine gaps join the batched round.

- **type** — the checked Type item; none checked → the question joins the
  batched round.
- **models** — the sole routing input is the checked Model(s) items (D12).
  Default first: if NO item is checked (a card created outside the
  multi-action rule's reach), route from the standard default selection —
  `Qwen Flash` — WITHOUT mutating the card. Then: exactly one checked →
  that model for every tier; several checked →
  the largest drives planning (plan / research / final review), the smallest
  drives code (test / dev / chunk review). The combos are routes, not
  options: `Qwen Flash` + `Local` checked together → assume it's Qwen Flash
  Next, `gpu-ai/qwen3.8-flash-next-strata` (Strata default; other flash-next quants
  only on explicit request); `Qwen 27b` + `Local` → `gpu-ai/qwen3.8-27b-q4`
  unless another quant is explicitly requested; only **Local** checked →
  `gpu-ai/qwen3.8-27b-q4` for every role. The size order and the local
  mapping authority stay in `pipeline-models` — reference it, never
  duplicate its table. Record the resolved tiers in STATE.json
  `kickoff.models` and in the claim comment — never as a custom field.
- **human-in-the-loop** — the checked Human in the Loop items are THIS
  run's stop stages: after each checked stage the agent pauses and waits
  for human input before continuing. `Plan` (the default) = pause for plan
  approval; `Research` = pause with the research findings before planning;
  `PR` / `Deployment` = pause before those actions. Nothing checked =
  route from the default (`Plan`) WITHOUT mutating the card — the
  plan-approval pause still happens.
- **lifecycle** — the checked Lifecycle items are THIS run's stage list;
  what each stage runs is the Stage map's table alone (cite it, never
  restate). Nothing checked = the full standard loop. A card still
  carrying the legacy Research checklist follows the transition rule
  instead — its items time research only, they never gate stages.
- **slug** — the `slug` custom field if already set; otherwise mint 2–3
  suggestions and put them in the batched round. The final slug is
  `cf-<cardNumber>-<type>-<desc>` (`cardNumber` comes from `get_card`).
  EVERY surface is named from the full slug (D10): feature folder
  `2026-10-<cf-slug>`, worktree `<cf-slug>`, branch `<cf-slug>`, and
  `session_rename` to `<cf-slug>`. The branch named there is minted by
  kickoff's `kickoff-mint-branch.sh` step — citation only; the mechanics
  live in `pipeline-kickoff`, never here.
- **In-work mark** — after the `session_rename` returns the sessionID, mark
  the session in-work per `pipeline-kickoff` (citation only — the contract,
  its values and its commands live there, never here).
- **No run tag** — card-driven runs retire the run tag entirely: STATE.json
  `kickoff` carries `card` (the id) + `slug` + `session_origin` (the claim-once
  slot record — Config constants) and omits/nulls `run_tag`.

## Board context block (consumer side)

A launch prompt may carry a pre-collected Board context block — structural ids resolved on the live board before the run started. Its producer is the `/wekan-board-context` collector command; the format's single normative home is the `wekan-mcp` skill's schema section — cite it, never restate it here. Consumer rule, for the whole run:

- Block present → use its ids for the whole run without re-running the resolution calls: the first six board round-trips are already spent.
- At claim the coordinator records the block as STATE.json `kickoff.board_context` (alongside `card`, `slug`, `session_origin`).
- Block absent → normal, not a gap: resolve ids top-down exactly as before.
- Any id-shaped call error (404, not-found, or an empty projection where the block's ids promised data) → re-resolve the block against the live board before retrying, and note the drift in RESULT. The board structure is human-owned and drifts, so the block is a starting context, never a freeze — the schema's own re-resolve footer binds here too.

## Research-only cards — iterative loop

Trigger: the card's labels include the **Research** board label — read board labels via `get_board` and the card's label ids via `get_card`, matched case-insensitively. The label is the ONLY trigger (D14); the Lifecycle checklist never fires this flow — its Pre/Post Research items are stages of normal cards (a legacy-Research card per the transition rule behaves the same: its checklist only times research, it never marks a card research-only).

Research-only cards never go to `agent-plan`/`agent-test`/`agent-dev-local`/`agent-dev-pr`/`agent-review`. The run:

1. Claim per the Card lifecycle (`move_card` to **Executing** + claim
   comment), then resolve the feature folder exactly as in Card-driven
   kickoff: `cf-<cardNumber>-<type>-<desc>`. No `feat` default for an unset
   Type — it joins the round-2 questions.
2. `agent-research` ROUND 1 — launch with the card request, the checked
   Lifecycle research items (`Pre Research` / `Post Research`), and the
   absolute feature-folder path; the summary lands in `RESEARCH.md` there.
3. ONE batched `question` round for the user: refine/direct further
   research — carry every open question from RESEARCH.md plus the slug
   suggestion when the `slug` custom field is unset.
4. Further research on the answers — continue the SAME `agent-research`
   session via its sessionID so the round-1 context carries.
5. Terminate: the default is at most one follow-up round, then wrap.
   Residual unknowns ride along in the final comment for the human's
   Finished-vs-Rework call — do not spin a second round.
6. Write-back exactly as in Post-plan card write-back (D19):
   `set_card_custom_field` for the `slug` combined `[<slug>](<session link>)`
   value, then
   `delete_checklist_item` for every unchecked item of the five checklists.
7. `add_comment` on the card: the research session link — this run's
   `Session origin:` URL, or the RAW session id on UNRESOLVED with the
   fallback recorded in RESULT — plus the merged TLDR
   from RESEARCH.md → `move_card` to **Review** — the agent's
   final destination for research-only runs too; **Finished** stays
   human-owned.

## Card lifecycle

**Review** is the agent's final destination; **Finished** is human-owned.

- **Pickup** → `move_card` to **Executing** + `add_comment` claiming the card: the session line — this run's `Session origin:` link, or the RAW session id when it says UNRESOLVED (fallback recorded in RESULT) — the resolved model tiers (from the Model(s) checklist), the consumed checklist answers, the resolved slug, and the plan folder path.
- **Lock set before the move** — every entry path (a tick, a manual `/pipeline-boards` with a card id, or one without) calls `pipeline_claim` for the card's derived pipeline set BEFORE that `move_card` to **Executing** and the claim comment (Parallel pipeline loops). A manually-addressed card whose set is not fully free is reported and left — never forced.
- **Plan approved** (after the question round) → `add_comment` that the plan is approved (plan path, worktree/branch), then the Post-plan card write-back below.
- **Each chunk done** → `add_comment` with the chunk status (chunk id, dev/review verdict, commit).
- **All chunks done + final whole-plan review passed** → `move_card` to **Review** + summary comment: branch, commit range, validation results, plan path; once the comment lands, `pipeline_release(outcome:"done")` hands the lock set back (D6 — **Review** is the release point, **Finished** never touches the lock).
- **Never** `move_card` to **Finished** — a human moves Review → **Finished** (accept) or → **Rework** (send back).
- Card picked from **Rework**: read its full comment history (`list_comments`) first; the comments are the rework context.
- **Resume vs new run**: apply the D11 rule from Card pickup; a resumed run re-claims without re-minting the slug or re-running kickoff.

## Post-plan card write-back

Right after plan approval (research-only cards do the same immediately before their Ready-for-Review move, D19):

1. `list_custom_fields` on the AI-Dev board → the id of the `slug` field.
2. `set_card_custom_field` (upsert): `slug` = the combined value
   `[<slug>](<session link>)` — the final `cf-<cardNumber>-<type>-<desc>` as
   the link text, and the `<session link>` half exactly as the Config
   constants define it: `$(SESSION_URL_BASE)/?session=<sessionID>` when this
   run's `Session origin:` resolved, or the RAW session id when it said
   UNRESOLVED (fallback recorded in RESULT) — never a raw id when an origin
   resolves, never a remembered host. This first write-back performs the
   Config constants consistency check.
3. `delete_checklist_item` for EVERY unchecked item of the Services / Type /
   Model(s) / Lifecycle / Human in the Loop checklists (checklist ids from
   `list_checklists`, item ids from `get_checklist`). The surviving checked
   items are the on-card decision record — the checked Model(s) options ARE
   the routing record (D12), the surviving Lifecycle items the stage record
   this run executes, the surviving Human in the Loop items the stop-point
   record.

## Friction follow-up (board override)

On `agent-board-coord` family runs, the coordinator's `pipeline-role-coord` step 10 is overridden: each checked friction item becomes a card landing in **Review**, never an in-session `agent-plan` ticket. Create one card per item with `create_card` into **Review** (title stating the fix, description quoting the full `FRICTION.md` line plus its ticket/chunk context). Review is the destination by design: these cards are records awaiting the owner's call, NOT auto-pickup intake — the pickup walk never visits Review, so a card can only re-enter the pipeline when the owner moves it to Rework (and if the closing session already shipped the fix, the card simply documents it for acceptance). The board's createCard rule adds the five standard checklists automatically — do NOT `add_checklist` (it duplicates them; proven on cards #64–67, 2026-10-28); the rule's checkItem extras stay dormant, so check the answers the friction context already knows via `toggle_checklist_item` (typically Services `agent context`, Type `chore`, Model(s) `Qwen Flash`). This is not a run: the closing session claims nothing, moves nothing out of Review, and sets no fields beyond the card's own — Review → Finished or → Rework is the owner's alone.

## Batched question protocol

Until the plan is finalized, no one in this flow calls the `question` tool on the user:

- `agent-board-coord` AND every agent it launches for research/planning work MUST NOT ask the user questions.
- Every question is recorded in the plan file's **Open questions** section — the question, the best-guess answer taken, and its impact — and work continues on the best guess.
- When the plan is about to be written/finalized, `agent-plan` returns the accumulated questions: RESULT `open_questions` plus the plan's Open questions section.
- `agent-board-coord` then asks the user the ENTIRE built-up list in ONE `question` call — multiple questions, each with the recommended (best-guess) answer first — and re-launches the plan session with the answers to rework the plan before final approval.

This REPLACES per-question escalation during the planning phase: questions accumulate, they do not block. (`question` stays allowed in every agent's permissions — the protocol decides when the one batched round happens, it does not revoke the tool.)

The card answers in advance: the planner MUST NOT record a question whose answer the five checklists or the `slug` custom field already gives. The batched round carries only genuine gaps (an unchecked Type item, an unset `slug`), each with its best-guess recommendation first. Research-only cards run the same accumulation rule inside their own single follow-up round (Research-only cards, step 3).

## Launch prompt to agent-plan

When launching `agent-plan`, agent-board-coord MUST include this extra prompt text (in addition to the standard launch prompt):

> Card context: <card title, card description, and card comments> — the card description is the request; the feature folder is <path>.
> Checklist answers — already provided by the user, do not re-ask: for each of Services / Type / Model(s) / Lifecycle / Human in the Loop the CHECKED items, plus the card's `slug` custom-field value (the combined `[<slug>](<session link>)` link) and its `cardNumber`.
> No-questions rule: until this plan is finalized you must NOT call the `question` tool. Record every question you would ask — question, the best-guess answer you take, and its impact — in the plan's Open questions section, and continue the work on the best guess.
> Question return: when the plan is about to be written/finalized, return ALL accumulated questions — in RESULT `open_questions` and in the plan's Open questions section. They go to the user in one batched question round, and the plan session is re-launched with the answers before final approval.
