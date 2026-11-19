---
name: wekan-mcp
description: Use when an agent calls the lab's wekan-mcp board servers through MCP — dev-boards (AI-Dev board card access for pipeline runs), admin-global-wekan, or readonly-global-wekan — for card create/move/comment/checklist/custom-field work, or when such a call fails on argument shape, a stale list id, a tools/call timeout, a rejected parameter, or a missing server in the session catalog. Raw REST semantics and server internals live in the wekan-api skill.
---

# WeKan MCP board skill

The one surface guide for the lab's wekan-mcp servers: what they are, every
tool's call shape, the projection gotchas, the failure modes with their
recoveries, and the board-context block schema. Load it before trial-and-error
— every rule here was mined from recorded agent friction (the cf-70, cf-52,
cf-58, cf-49, lidarr and dev-boards-allow runs), so those round-trips do not
get rediscovered through validation errors.

Evidence posture: the rules below and the full table were source-checked
2026-10-27 against `containers/wekan-mcp/wekan_mcp/server.py` — anchored on
function names, never line numbers, which drift with every build — and
live-probed read-only on `dev-boards` the same day. The deployed build can lag
the repo source, so docs are claims and the live `tools/list` is fact.

## Servers and tiers

| Server id | Deployment | Write surface | Credential |
|---|---|---|---|
| `dev-boards` | dev cluster `mcp.dev.scifi.farm/boards` — the pipeline board-intake endpoint | full, 31 tools | login-minted server-side: `WEKAN_USERNAME` + `WEKAN_PASSWORD` from a Bitwarden LOGIN item (the base URL rides that item's URI field) — the agent never handles credentials |
| `admin-global-wekan` | gpu `wekan-admin` deployment | full, 31 tools | one long-lived service-user bearer in the pod env |
| `readonly-global-wekan` | gpu `wekan-readonly` deployment | none — with `WEKAN_MCP_READ_ONLY=true` write tools are never registered, so they are absent from `tools/list` and uncallable even by accident | same bearer story as the admin tier |

All three run the image built from `containers/wekan-mcp`, and every read or
write is scoped to the service user's board membership. Deployment wiring and
the raw-REST fallback are the `wekan-api` skill's ground.

## Call-shape rules

1. Resolve ids top-down — board → swimlane/list → card → checklist → item.
   Child calls require the parent ids; never guess a shape, never
   trial-and-error an id.
2. `board_id` is required on nearly every call — only `list_boards` takes
   none. Every card-scoped tool also takes `card_id`.
3. The comment body argument is `comment`, not `text`. `add_comment` takes
   it; `list_comments` items echo the same key.
4. Checklist item state reads as `finished` (`get_checklist` items) and
   writes as `done` (`toggle_checklist_item` argument and response). Both
   name the one REST `isFinished` flag from their two sides — they are not
   interchangeable argument names.
5. `move_card` takes a fresh `from_list_id` (where the card lives **now**)
   plus `to_list_id`; cross-swimlane moves use `to_swimlane_id` — there is no
   bare `swimlane_id` parameter and passing one is rejected. A moved card
   re-inserts at the TOP of the destination list: round-tripping a list
   reverses it, and a card moved into a pickup list outranks the cards
   already there.
6. `get_card` is the only source of `card_number`, custom fields and label
   ids — `list_cards_in_list` returns `card_number: null` with empty
   `custom_fields` and `label_ids` because the by-list projection strips
   them. Pickup facts always come from the single-card read.
7. `list_cards_in_list` response order IS board order, top first.
   `list_lists` carries no sort field — order cannot be read or set through
   it.
8. Responses normalize Mongo `_id` to `id`; a script reading `_id` gets
   undefined, silently.
9. `list_comments` items carry `created_at: null` (observed live on
   dev-boards 2026-10-26) — treat listing order as time order, and null
   timestamps as absent data, not as "no comments".
10. `list_checklists` is card-scoped and returns `{id, title}` only, so
    checklist ids can never be pre-collected board-wide — per card it is
    `list_checklists`, then `get_checklist` for item ids. When a session
    catalog or these docs disagree with a call, probe `tools/list`
    (playbook below).

Full per-tool argument tables, each row stamped live probe or source-only:
[references/call-shapes.md](references/call-shapes.md).

## Board context block schema

The single normative home of this format. Producers — the
`/wekan-board-context` collector command and the board-coord prefetch plugin —
emit it exactly as written here; consumers (the `boards` flow) treat it as a
resolved id map instead of re-running the resolution calls:

```text
Board context (collected <ISO-8601>, <server-id>)
board_id: <id>
swimlane_id: <id>
lists:
  <list title>=<id>
custom_fields:
  <field name>=<id>
labels:
  <label name>=<id>
Card and checklist ids are not included — they are live per-card data,
resolved at use time. On any id-shaped call error, re-resolve this block
against the live board before retrying.
```

`lists:` carries only the lists inside the named swimlane — `list_lists`
items expose `swimlane_id` and titles repeat across swimlanes. Labels come
from `get_board`, custom fields from `list_custom_fields` (items carry
`{id, name, type}` — the key is `name`, not `title`). Board structure is
human-owned and drifts (a non-pipeline list appeared in the AI-Dev
"In Process" swimlane during 2026-10), so the block is a snapshot with its
collection stamp, never a freeze — the re-resolve footer is part of the
schema.

## Failure-mode playbook

| Symptom | Likely cause | Recovery |
|---|---|---|
| `tools/call` times out or drops mid-request while `initialize` still works | Server alive but slow (cold Mongo/lock, observed 2026-10-27), or a stale MCP session id silently dropped the write | Do not repost blindly — verify the board state first (`get_card` / `list_comments` on a fresh session), then perform the action once. Retries have both duplicated comments and lost them. |
| 404 "Card not found" from `move_card` / `update_card` | Stale `from_list_id` / `list_id` — a human or a board rule relocated the card mid-run | Fresh `get_card`, read the current `list_id`, retry from there. Not a permission problem (seen on `admin-global-wekan`, 2026-10-26). |
| A parameter you documented is rejected as unexpected (`default_checked`, cf-49) | The deployed build lags the repo source (rejected on a v4.1.3 deploy 2026-10-26 while the repo implemented it) | Probe `tools/list` directly instead of trusting docs — MCP-over-HTTP recipe in `skills/wekan-api/references/wekan-mcp-ops.md`. Degrade to the shape the live catalog accepts, recover the effect with follow-up calls, and stamp evidence dates on anything you write down. |
| Argument shape unknown, or the rejection text is truncated (lidarr run) | Shape guessing under a non-self-documenting error | pydantic errors name the exact missing/unexpected snake_case argument — read them and retry rather than probing more shapes; the tables here are pre-mined. |
| The server id is absent from the session's MCP catalog, or the catalog shows an old tool list | Session catalogs cache per connection and go stale after image swaps; a scheduled launch can also start the session under the wrong agent (user-side schedule check — cf-75 plan notes it is not repo-fixable) | Reload/refresh the harness catalog; if it stays absent, run `initialize` → `tools/call` via the same MCP-over-HTTP recipe — the server itself is usually alive. |

## Pointers — where the rest lives

- Raw REST semantics, server internals, the rules-engine vocabulary and
  proven rule recipes, and the MCP-over-HTTP direct-verification recipe —
  the `wekan-api` skill, especially
  `skills/wekan-api/references/wekan-mcp-ops.md`. This skill references
  those; it does not copy them.
- Board flow — pickup walk, card lifecycle, kickoff consumption — the
  `boards` skill.
- Per-tool arguments and response shapes with evidence stamps —
  `references/call-shapes.md`.
- Intentionally omitted from every tier's surface: attachments, webhooks,
  member/user administration, imports/exports, and entity-level deletion
  (`delete_board`, `delete_card`, `delete_list`, `remove_member`). Only two
  destructive ops are exposed, each bounded to one object: `remove_rule`
  and `delete_checklist_item`.
