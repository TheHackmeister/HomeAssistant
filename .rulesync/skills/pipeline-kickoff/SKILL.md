---
name: pipeline-kickoff
description: New-ticket kickoff for the agent-* coordinator — the questions to ask the user (slug, models, run tag) and how to name the worktree/branch/session from the answers. MUST-loaded by agent-coord; never auto-selected.
targets: ["*"]
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Pipeline kickoff (new ticket)

Run this before resolving or creating a feature folder for a NEW ticket; skip all of it when resuming an existing folder.

## Questions (ask with the `question` tool)

1. **Project slug** — suggest 2–3 short kebab-case slugs derived from the request, each carrying your inferred `<type>` (`feat|bug|debug|dep|refactor|chore|docs`, e.g. `feat-llama-cache-ttl`); the user picks one or types their own.
2. **Models for this run** — ONE multi-select question (`multiple: true`) with exactly these four options:
   - `Qwen Large` — `openrouter/qwen/qwen3.8-2.4t-a95b`
   - `Qwen 27b` — `openrouter/qwen/qwen3.8-27b`
   - `Qwen Flash` — `openrouter/qwen/qwen3.8-flash`
   - `Local (gpu-ai)` — run the checked models on the self-hosted `gpu-ai` provider (quants per the `pipeline-models` local mapping)

   Derive the routing with the size order and local mapping defined in the `pipeline-models` skill:
   - Exactly one model option checked → that model for BOTH tiers (planning and the other agents).
   - Several model options checked → the LARGEST checked model is the planning tier (`agent-plan`, `agent-research`, and the final whole-plan review); the SMALLEST checked model is the code tier (`agent-test`, `agent-dev-local`/`agent-dev-pr`, chunk `agent-review`). Options in between are unused.
   - `Local` unchecked → provider `openrouter` for all chosen models; `Local` checked → provider `gpu-ai` with the quants defined by the `pipeline-models` local mapping (never restate its table here): 27b+Local → `gpu-ai/qwen3.8-27b-q4` unless another quant is explicitly requested; Flash+Local → assume Qwen Flash Next, `gpu-ai/qwen3.8-flash-next-strata` (combination rule — there is no plain-flash local route); Large+Local keeps its assumed-q6 row.
   - Only `Local (gpu-ai)` checked, no model → default `gpu-ai/qwen3.8-27b-q4` for every role (follows the 27b local default).
3. **Run tag** — compose `<provider>-<model>` from the planning-tier model with the model sanitized (`.` and `/` → `-`), then offer: the bare tag, tag + run number (count of existing runs with the same prefix, +1), tag + variant (if the chosen model uses one), or a user-provided string.

## Name the run's surfaces from the answers

- **Worktree + branch**: `opencode` tool `worktree_create` with name `<slug>-<run tag>` (flat, no slashes) — the tool takes only the name: the worktree arrives on **detached HEAD** and the branch is never created (no branch parameter exists on it). Mint the branch immediately after creation and before `session_move`: `bash scripts/kickoff-mint-branch.sh <directory-as-returned> <worktree-name>` — the branch must equal the worktree basename (the script rejects otherwise; scoped shell grant, see `pipeline-role-coord`). Verdicts: `MINTED <branch> <sha>` — detached commits made before the mint are carried onto the branch — or `EXISTS <branch> <sha>` — nothing checked out; both exit 0. `REJECT <reason>` (exit 1) means fix the call, never improvise git commands. The mint is idempotent: on a resume whose worktree exists but whose branch is absent, run the same command (and if `worktree_create` ever gains native branch minting, this step degrades to a no-op). `STATE.json` `kickoff.branch` is only true after this step. Single authority: this bullet holds the mint mechanics — `boards` cites it, never restates it; the grant's containment rule lives in `pipeline-role-coord`.
- **Session**: `session_rename` to the slug. The call returns YOUR OWN sessionID — keep it: the planner records it under `coord_session` in `STATE.json`, and `agent-fuser` uses it to hand fusion plans back to this session.
- **In-work mark** — on the sessionID the rename returned, mark the session in-work in OpenChamber. Single authority for the coordinator work-state contract: `pipeline-role-coord` and `boards` cite this bullet, never restate it.
  - Read-merge-write ONLY: `opencode api get /api/session/<sessionID>` → keep ALL current metadata (notably `openchamber.kind`; the get returns the record under a `{"data": ...}` envelope — unwrap it before reading metadata, because a top-level `.metadata` read silently returns nothing) → set `metadata.openchamber.work = {state:"open", openedAt:<epoch-ms>, openedBy:"auto"}` (compute the epoch-ms inline in the command string — `$(date +%s%3N)`, covered by the family's `date *` shell allow; no separate `jq` call is granted) → `opencode api patch /api/session/<sessionID> -d '{"metadata": <full merged object>}'`. PATCH replaces `metadata` whole — a partial write deletes the siblings (proven 2026-10-26) — so only the fully merged object may go back.
  - Idempotent: skip the write when the read already shows `work.state == "open"` — chat-launched runs are auto-opened by their first message, so the mark is a no-op there; scheduled runs are the real target.
  - Values are fixed to what OpenChamber accepts (its zod schema): `state open|done`; `openedBy auto|jev|user`, and the coord writes `auto`; `doneAt` is the ms timestamp on the done write; never write `suggestDoneAt` or `reviewOffer` (Jev-owned fields).
  - Why: OpenChamber auto-opens chat-launched sessions on a sent message but EXCLUDES scheduled runs — this mark is what puts a coordinator session in the sidebar's In-work block. Purely UI: nothing in the pipeline reads it.
- **Move in**: warm the destination FIRST — `bash scripts/kickoff-warm-location.sh <directory-as-returned>` (scoped shell grant, same family as the mint script). Verdicts: `WARMED <dir>` (exit 0) — proceed; `REJECT <reason>` (exit 1) — do NOT `session_move`: the run leaves the card via the blocked/abandon exit with the reason, never moves on an unwarmed destination and never improvises (a run that stays put would commit ticket files into the main tree). THEN `session_move` the session to the worktree directory so every subagent of this run works there. Why (verified 2026-10-31, OpenCode v2.1.4): `session_move` does not boot the destination's location services, and a session moved into a directory whose services are not loaded never resolves the location's custom agents again (`Agent not found: …` on every drain) — the run is bricked permanently. Single authority: this bullet holds the warm mechanics — `boards` cites it, never restates it; the grant's containment rule lives in `pipeline-role-coord`.

## Hand off to planning

Pass slug, type, both tier models (+ `local` flag), run tag, worktree name, and your own sessionID to `agent-plan` (feature folder becomes `.agents/plans/<yyyy>/<yyyy-mm>-<type>-<slug>/`); the planner records them in `STATE.json` under `kickoff` (slug, run tag, worktree, `models: {plan, code}`, `local`) and `coord_session` when it creates the folder. The kickoff model choices override the `pipeline-models` defaults for this run.