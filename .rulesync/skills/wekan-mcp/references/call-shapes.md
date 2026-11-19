# wekan-mcp tool call shapes — the full table

Tool → args → response shape for all 31 tools registered by
`containers/wekan-mcp/wekan_mcp/server.py`. Rows are anchored on the server's
**function names**, never line numbers — lines drift with every build, names
survive. One row per registered tool, one evidence stamp per row:

- `live probe 2026-10-27` — the tool was exercised read-only through
  `dev-boards` that day: `list_boards`, `get_board`, `list_swimlanes`,
  `list_lists`, `list_custom_fields`.
- `source-only` — the row reads the current source signature and docstring
  only; it was not exercised by that probe. Facts earlier runs observed live
  are noted inline with their date.

The deployed build can lag the repo source (observed 2026-10-26: the
`default_checked` parameter was rejected on a v4.1.3 deployment while the repo
implemented it). Re-check `tools/list` before trusting any optional
parameter; the direct-probe recipe is in
`skills/wekan-api/references/wekan-mcp-ops.md`.

## Read tools — registered by `mcp.tool`, present on every tier

| tool | required args | optional args | response shape and gotchas | evidence |
|---|---|---|---|---|
| `list_boards` | — | — | `[{id, title}]` — boards the service user is a member of; membership scopes every other call. | live probe 2026-10-27 |
| `get_board` | `board_id` | — | `{id, title, permission, color, archived, labels: [{id, name, color}]}` — the only read that carries the board's label list. | live probe 2026-10-27 |
| `list_lists` | `board_id` | — | `[{id, title, swimlane_id}]` — the `swimlane_id` is hydrated per list from the single-list route (WeKan's collection route projects lists to `{_id, title}` only, see `list_lists`); no sort field; titles repeat across swimlanes. | live probe 2026-10-27 |
| `list_swimlanes` | `board_id` | — | `[{id, title}]` — every board has at least one. | live probe 2026-10-27 |
| `list_cards_in_list` | `board_id`, `list_id` | — | cards in board order, top first; the by-list projection strips `card_number` (null), `custom_fields` and `label_ids` (empty) — `get_card` per candidate for those. Both ids are required together (observed live 2026-10-26). | source-only |
| `get_card` | `board_id`, `card_id` | — | the full slim card: only source of `card_number`, `custom_fields` `[{id, value}]` and `label_ids`. `board_id` is interface-consistency only — the route is `/api/cards/{card_id}` and WeKan enforces board access via the card's own board. Returns archived cards too; check `archived`. | source-only |
| `list_comments` | `board_id`, `card_id` | — | `[{id, comment, author_id, created_at}]` — the body key is `comment`; live runs observed `created_at: null` (2026-10-26), so treat listing order as time order. | source-only |
| `list_checklists` | `board_id`, `card_id` | — | `[{id, title}]` only — card-scoped, so checklist ids cannot be pre-collected board-wide; item ids come from `get_checklist`. | source-only |
| `get_checklist` | `board_id`, `card_id`, `checklist_id` | — | `{id, title, items: [{id, title, finished}]}` — `finished` is the read-side name of the REST `isFinished` flag; the item ids are what `toggle_checklist_item` and `delete_checklist_item` require. | source-only |
| `list_rules` | `board_id` | — | `[{id, title, trigger, action}]` — trigger and action embed inline; rule ids feed `get_rule`, `update_rule`, `remove_rule`. Key vocabulary and recipes: `skills/wekan-api/references/wekan-mcp-ops.md`. | source-only |
| `get_rule` | `board_id`, `rule_id` | — | one rule document, same shape as a `list_rules` item. | source-only |
| `list_custom_fields` | `board_id` | — | `[{id, name, type}]` — the name key is `name`, not `title` (the board-level list route projects to these three; verified on the deployed v9.99 API). | live probe 2026-10-27 |
| `get_custom_field` | `board_id`, `custom_field_id` | — | `{id, name, type, settings, show_on_card, automatically_on_card, always_on_card}` — dropdown options live in `settings.dropdownItems`; `always_on_card` is read-only through this server (see `create_custom_field`). | source-only |
| `list_board_members` | `board_id` | — | `{board_id, title, members: [{user_id, username, is_admin, is_active, is_no_comments, is_comment_only, is_worker, is_normal_assigned_only, is_comment_assigned_only, is_read_only, is_read_assigned_only}], username_resolution}` — nine normalized booleans (present⇒true, absent⇒false); `username` is always null because usernames ride only site-admin-gated REST routes, and the `username_resolution` note says so; ownership is the entry with `is_admin=true`; `grantedBy` provenance is omitted. | source-only (v12.65 source-check 2026-10-30; live tools/list probe post-merge, user-owned) |

## Write tools — registered by `_write_tool`, absent from the readonly tier

| tool | required args | optional args | response shape and gotchas | evidence |
|---|---|---|---|---|
| `create_card` | `board_id`, `list_id`, `swimlane_id`, `title` | `description`, `default_checked` | `{id, title}`; with `default_checked` (checklist title → item titles to arrive checked) the response gains per-checklist `{checked, missing, failed}`. Board rules create the standard checklists asynchronously after the create response, so the tool bounded-polls for them; a malformed map is rejected before the card exists, but nothing rolls back a missed check — read the buckets instead of assuming. | source-only |
| `update_card` | `board_id`, `list_id`, `card_id` | `title`, `description`, `due_at`, `start_at`, `end_at` | `{updated, card_id, fields}` — an omitted argument stays unchanged; dates are ISO 8601 strings. `list_id` must be the card's current list or WeKan 404s (playbook: fresh `get_card`). Covers title/description/dates only — no label or custom-field parameters exist here. | source-only |
| `move_card` | `board_id`, `from_list_id`, `card_id`, `to_list_id` | `to_swimlane_id` | `{moved, card_id, to_list_id}` — `from_list_id` is where the card lives NOW (a stale one 404s "Card not found", observed 2026-10-26); there is no bare `swimlane_id` parameter. The card re-inserts at the TOP of the destination list — round-trip order effects: `skills/wekan-api/references/wekan-mcp-ops.md`. | source-only |
| `create_list` | `board_id`, `title` | `swimlane_id`, `position` | `{id, title, swimlane_id, sort, positioned, position_error}` — the create POST APPENDS (WeKan sets `sort` from the board-wide live-list count, so on multi-swimlane boards the new column is not necessarily last inside the swimlane); an omitted `swimlane_id` binds the board's default (first) swimlane and the read-back returns which one was bound; `position` (0-based from the left, among the board's live lists) is a second, non-atomic same-board move POST — a failed reposition reports `positioned: false` + `position_error` and leaves the appended list live, never fails the create; a failed read-back nulls the echoed `swimlane_id`/`sort`. | source-only (v12.64 source-check 2026-10-29; live `tools/list` probe post-merge, user-owned) |
| `add_comment` | `board_id`, `card_id`, `comment` | — | `{id, comment}` — the body argument is `comment`, not `text`; authored by the service user. | source-only |
| `add_checklist` | `board_id`, `card_id`, `title` | `items` (list of titles) | `{id, title, items_added}` — the manual way to add a checklist when the board rules did not (rules are never retroactive). | source-only |
| `add_checklist_item` | `board_id`, `card_id`, `checklist_id`, `title` | — | `{id, checklist_id, title}` — appends one UNCHECKED item (extend option sets on older cards; toggle it to check); WeKan 404s when the checklist does not belong to the card. | source-only |
| `toggle_checklist_item` | `board_id`, `card_id`, `checklist_id`, `item_id`, `done` | — | `{item_id, done}` — the boolean argument is `done`; the read-side `finished` is not an accepted input name. | source-only |
| `delete_checklist_item` | `board_id`, `card_id`, `checklist_id`, `item_id` | — | `{deleted, item_id}` — DESTRUCTIVE, no undo, bounded to one item; WeKan 404s when the item does not belong to that card/checklist. | source-only |
| `create_rule` | `board_id`, `title`, `trigger`, `action` | — | `{id, title}` — trigger/action are dicts; only the presence of their kind key is validated server-side (no whitelist), omitted matchers wildcard to any value, and execution order is unspecified. Do not author rules from this row — the vocabulary and proven recipes are owned by `skills/wekan-api/references/wekan-mcp-ops.md`. | source-only |
| `update_rule` | `board_id`, `rule_id` | `title`, `trigger`, `action` | `{updated, rule_id, fields}` — a supplied trigger or action REPLACES the stored document wholesale; include every field the rule must keep matching. | source-only |
| `remove_rule` | `board_id`, `rule_id` | — | `{removed, rule_id}` — DESTRUCTIVE, no undo; recreation only via `create_rule`. | source-only |
| `create_custom_field` | `board_id`, `name`, `type` | `settings`, `show_on_card`, `automatically_on_card`, `show_label_on_minicard`, `show_sum_at_top_of_list` | `{id}` — `type` is text/number/date/dropdown/checkbox/currency/stringtemplate; `settings` must be a JSON object (`{"dropdownItems": [...]}` for dropdowns), never the dumped-string form. Server-side, create ignores the always-on-card flag and does not backfill existing cards — `automatically_on_card=true` covers future cards, `set_card_custom_field` attaches existing ones. | source-only |
| `set_card_custom_field` | `board_id`, `card_id`, `custom_field_id`, `value` | — | `{card_id, custom_field_id, value, attached}` — upsert: the dedicated value route silently no-ops on an unattached field, so the tool attaches-if-missing with a whole-array write (documented read-modify-write race; both legs skip archived cards). `value` is stored verbatim — text/date as strings, dropdown as an option id; number/checkbox coercion is not expressible through this typed schema (raw REST via `/wekan-api`). | source-only |
| `update_board` | `board_id`, `title` | — | `{id, title, key, color, permission, archived, renamed}` — title-only rename via the dedicated title route (bare whole-board PUT is 405 upstream: never rebuild it from POST+DELETE); the board id and the cardNumber sequence survive by construction; gate `checkBoardAdmin` at v12.65 (plain member ⇒ 403, title unchanged; 404 board not found); a failed read-back nulls the echo fields without failing the rename. | source-only (v12.65 source-check 2026-10-30; live tools/list probe post-merge, user-owned) |
| `create_swimlane` | `board_id`, `title` | `sort` | `{id, title, sort}` — an explicit `sort` is honored (the key is gated on `sort is not None` so the legal `sort=0` survives), omitted appends at max(live sibling sort)+1; `sort` is read back from the single-swimlane route because the collection route projects it away; a POST answer without `_id` is a failure regardless of status. | source-only (v12.65 source-check 2026-10-30; live tools/list probe post-merge, user-owned) |
| `create_label` | `board_id`, `name` | `color` (default `green`) | `{label_id, name, color}` — (name, color) is the idempotency key: an existing pair returns its id, the same name with a different color creates a SECOND label (no rename-by-name); `color` must be one of the 25 named colors (white included) and hex is rejected client-side with the allowed list before any request; gate is board-admin-or-site-admin, and the handler's answer is the bare label-id string. | source-only (v12.65 source-check 2026-10-30; live tools/list probe post-merge, user-owned) |

## Surface deliberately absent

`delete_board`, `delete_card`, `delete_list`, `remove_member`, attachments,
webhooks, imports/exports, member/user administration — by design (server.py
module docstring). Use raw REST through the `wekan-api` skill for those.
