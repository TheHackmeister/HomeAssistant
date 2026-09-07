# Plan: WeKan package extraction + Inbox/Reset ("Done") reset behavior

## Goal

Consolidate every WeKan-related piece of this HA config into a single
`packages/package_wekan.yaml` (8 rest_commands + 5 automations + 5 scripts)
for AI context isolation, and add one new behavior to the nightly board
organization: when evaluating the **Inbox/Reset list in the Today swimlane**
(the list the user calls "Done"):

1. Cards labeled **"Events & Waiting"** whose `dueAt` is in the past →
   **hard-delete** the card (WeKan `DELETE`, irreversible).
2. Every **non-event** card → **uncheck all checklist items** on all of the
   card's checklists, unconditionally (no check-state or due-date gate).

Cards that are events but not past due are left untouched. After live
verification, document the whole HA↔WeKan integration in a new repo skill.

## Skills

- `home-assistant-best-practices` — automation/script patterns, safe refactoring gate
- `Home Assistant YAML` — packages, scripts, modern syntax references
- External reference (read-only): `/home/coder/SpencersLab/skills/wekan-api/`
  (REST endpoint tables) and `/home/coder/SpencersLab/containers/wekan-mcp/`
  (client patterns) — consulted already; key facts are inlined below.

## MCP Servers

- `homeassistant` — entity verification, config validation, script execution,
  traces, system log, logbook
- `kubernetes` — fallback: HA pod logs (`homeassistant-0`, ns `default`) if
  MCP misbehaves

## Verified context

- HA version: **2026.7.4** (live, RUNNING), timezone America/Denver
- Live verification: **performed** (entities, states, reference scan)
- Entities involved (all confirmed live via `homeassistant_query_entities`):
  - `automation.boards_daily_task_organization` — **on** (only enabled one)
  - `automation.boards_move_cards_to_tomorrow` / `.boards_move_next_week_s_cards`
    / `.boards_move_this_weeks_cards` / `.boards_move_today_s_cards` — **off**
    (disabled state lives in the entity registry keyed by entity_id, which is
    derived from alias — keeping aliases byte-identical preserves it)
  - `script.boards_archive_past_unlabeled_tasks`, `.boards_move_future_cards_to_default`,
    `.boards_next_week_s_tasks`, `.boards_organize_by_labels`,
    `.boards_update_recurring_tasks` — all off (scripts idle)
- Config locations (worktree):
  - `configuration.yaml` lines 891–947: 8 WeKan `rest_command` entries
    (`get_board_swimlanes`, `get_card`, `update_card_due_date`, `get_board`,
    `archive_card`, `get_cards_from_swimlane`, `get_board_lists`,
    `move_card_to_swimlane`), all using `!secret wekan_api_token`
  - `automations.yaml`: 5 automation blocks — ids `1739773495929`,
    `1739829986815`, `1739830023654`, `1739830178317` (lines ~804–867) and
    `1770269885853` (lines ~2034–2092)
  - `scripts.yaml` lines 226–1072: the 5 `boards_*` script blocks
- Reference scan: no other file (dashboards/, packages/, scenes.yaml,
  groups.yaml) references any `boards_*` script or WeKan rest_command —
  the move is self-contained. `homeassistant_find_references` could not scan
  `automation` (UI scanner limitation) but the grep of automations.yaml
  covers it.
- Packages support: `rest_command:`, `automation:`, `script:` all merge from
  packages; `!secret` resolves inside packages. Existing packages confirm the
  pattern (`package_infra.yaml` has `automation:` etc.).
- WeKan API facts (from skill + MCP server code):
  - Delete card: `DELETE /api/boards/:boardId/lists/:listId/cards/:cardId`
  - List checklists: `GET /api/boards/:boardId/cards/:cardId/checklists` —
    WeKan checklist documents embed their `items` array
    (`{_id, title, isFinished}`); verify on first live run (fallback below)
  - Toggle item: `PUT /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId`
    body `{"isFinished": false}`
  - WeKan returns HTTP 200 with embedded error objects on some routes —
    rest_command can't detect those; rely on trace/log inspection.
- Board facts (from config; names for swimlane IDs partly inferred):
  board `TrfngHQf8PWj9mnqC`; swimlanes `44anFDcaRYyswRToE` (Next Week) →
  `M4ep8PQ4ooQzxrMAy` (This Week) → `mi4eKny3uXdGWWmYr` (Tomorrow) →
  `8M8Py44KDk8A7mcj4` (Today) → `diPoL2ZNgbaPj9xAh` (name unverified —
  confirm via `get_board_swimlanes` during testing and record in the skill).
  Recurring labels handled by existing script: weekly, bi-weekly, monthly,
  bi-monthly, quarterly, bi-quarterly, yearly, bi-yearly, annually.

## Design decisions

1. **`packages/package_wekan.yaml`** (new file) holds everything WeKan.
   Packages merge `rest_command:` fine — answers the user's open question.
   Entity IDs are unchanged because script YAML keys and automation aliases
   are moved byte-identical; disabled-state of the 4 move automations
   survives via the entity registry.
2. **New companion script** `boards_reset_inbox_cards` instead of folding
   branches into `boards_archive_past_unlabeled_tasks` — single purpose,
   zero risk to existing behavior, testable in isolation (user-confirmed).
3. **Event detection by label, not dates**: board label name matched
   case-insensitively against `event_label_name` (default `Events & Waiting`,
   user-confirmed), resolved via `GET /api/boards/:id` labels exactly like
   `boards_update_recurring_tasks` resolves recurring labels.
4. **Past due = `dueAt < now()`** for event cards (user-confirmed). Events
   without `dueAt` are skipped.
5. **Uncheck is unconditional** for non-event cards in the target list —
   every checklist item currently checked gets `isFinished: false`
   (user-confirmed: "I basically always want you to process it"). Items
   already unchecked are skipped (no wasted PUTs).
6. **Step position in daily org: 3rd** — after `boards_update_recurring_tasks`
   (so a card carrying both a recurring label and "Events & Waiting" gets its
   due date bumped first and is NOT deleted — recurring wins) and after
   `boards_archive_past_unlabeled_tasks` (no overlap: that one only touches
   unlabeled cards), before `boards_move_future_cards_to_default` (so a
   bumped recurring card's checklist is reset before it possibly moves to the
   Default swimlane).
7. **Hard delete is literal** (`DELETE` endpoint, not archive) —
   user-confirmed wording; flagged as irreversible in Risks.
8. Existing 5 scripts move **unchanged** (no syntax modernization in this
   pass — keeps the diff reviewable and behavior identical; modernization can
   be a follow-up).

## Changes

### Step 1 — CREATE `packages/package_wekan.yaml`

Attribution header (required for new files), then three sections:

**1a. `rest_command:`** — the 8 existing entries copied **byte-for-byte**
from `configuration.yaml` lines 891–947, plus these 3 new ones:

```yaml
  # Permanently delete a card (no archive, no undo in WeKan).
  delete_card:
    url: https://wekan.spencerslab.com/api/boards/{{ boardId }}/lists/{{ listId }}/cards/{{ cardId }}
    method: DELETE
    headers:
      Authorization: !secret wekan_api_token

  # All checklists on a card; each checklist document embeds its items
  # array ({_id, title, isFinished}). Verify embedding on first live run.
  get_card_checklists:
    url: https://wekan.spencerslab.com/api/boards/{{ boardId }}/cards/{{ cardId }}/checklists
    method: GET
    headers:
      Authorization: !secret wekan_api_token

  # Set a checklist item's finished state.
  update_checklist_item:
    url: https://wekan.spencerslab.com/api/boards/{{ boardId }}/cards/{{ cardId }}/checklists/{{ checklistId }}/items/{{ itemId }}
    method: PUT
    payload: >
      {"isFinished": {{ 'true' if isFinished | bool else 'false' }}}
    headers:
      Accept: application/json
      Content-Type: application/json
      Authorization: !secret wekan_api_token
```

**1b. `automation:`** — the 5 automation blocks copied **byte-for-byte**
(including `id:`, `alias`, `mode:`, empty `conditions: []`, `metadata: {}`)
from `automations.yaml`, with ONE modification: in
`Boards: Daily Task Organization` (id `1770269885853`) insert this action as
the **3rd** entry (after `boards_archive_past_unlabeled_tasks`, before
`boards_move_future_cards_to_default`):

```yaml
  - action: script.boards_reset_inbox_cards
    metadata: {}
    data:
      boardId: TrfngHQf8PWj9mnqC
      swimlane_name: Today
      list_name: Inbox/Reset
      event_label_name: Events & Waiting
```

**1c. `script:`** — the 5 `boards_*` blocks copied **byte-for-byte** from
`scripts.yaml` lines 226–1072, plus the new script:

```yaml
boards_reset_inbox_cards:
  alias: 'Boards: Reset Inbox Cards'
  description: >-
    Nightly cleanup of the Inbox/Reset list (the "Done" list). Past-due cards
    labeled as events are permanently deleted; every other card's checklist
    items are all unchecked so recurring work starts fresh.
  fields:
    boardId:
      selector:
        text:
      name: boardId
      description: Board ID
      default: TrfngHQf8PWj9mnqC
      required: false
    swimlane_name:
      selector:
        text:
      name: Swimlane Name
      description: Swimlane containing the list to process
      default: Today
      required: true
    list_name:
      selector:
        text:
      name: List Name
      description: List to process (the "Done" list)
      default: Inbox/Reset
      required: true
    event_label_name:
      selector:
        text:
      name: Event Label Name
      description: Board label that marks a card as an event
      default: Events & Waiting
      required: true
  sequence:
  - action: rest_command.get_board_swimlanes
    metadata: {}
    data:
      boardId: '{{ boardId }}'
    response_variable: all_swimlanes
  - variables:
      swimlane_match: '{{ all_swimlanes.content | selectattr(''title'', ''eq'',
        swimlane_name) | list }}'
      swimlaneId: '{{ swimlane_match[0]._id if swimlane_match | length > 0 else '''' }}'
  - if:
    - condition: template
      value_template: '{{ swimlaneId == "" }}'
    then:
    - action: system_log.write
      metadata: {}
      data:
        level: error
        message: 'Could not find swimlane: {{ swimlane_name }}'
    - stop: 'Swimlane not found'
  - action: rest_command.get_board_lists
    metadata: {}
    data:
      boardId: '{{ boardId }}'
    response_variable: all_lists
  - action: rest_command.get_board
    metadata: {}
    data:
      boardId: '{{ boardId }}'
    response_variable: board_data
  - variables:
      all_labels: '{{ board_data.content.labels if board_data.content.labels is defined
        else [] }}'
  - action: rest_command.get_cards_from_swimlane
    metadata: {}
    data:
      swimlaneId: '{{ swimlaneId }}'
      boardId: '{{ boardId }}'
    response_variable: swimlane_cards
  - if:
    - condition: template
      value_template: '{{ swimlane_cards.content | count == 0 }}'
    then:
    - action: persistent_notification.create
      metadata: {}
      data:
        message: No cards found in {{ swimlane_name }} swimlane
    - stop: 'No cards in swimlane'
  - repeat:
      sequence:
      - variables:
          card_list_match: '{{ all_lists.content | selectattr(''_id'', ''eq'', repeat.item.listId)
            | list }}'
          card_list_title: '{{ card_list_match[0].title if card_list_match | length
            > 0 else '''' }}'
      - if:
        - condition: template
          value_template: '{{ card_list_title == list_name }}'
        then:
        - action: rest_command.get_card
          metadata: {}
          data:
            boardId: '{{ boardId }}'
            listId: '{{ repeat.item.listId }}'
            cardId: '{{ repeat.item._id }}'
          response_variable: full_card_details
        - variables:
            card_label_ids: '{{ full_card_details.content.get(''labelIds'', []) if
              full_card_details.content.get(''labelIds'') is not none else [] }}'
            card_label_names: "{% set names = namespace(items=[]) %} {% for label_id
              in card_label_ids %}\n  {% set matching = all_labels | selectattr('_id',
              'eq', label_id) | list %}\n  {% if matching | length > 0 %}\n    {%
              set names.items = names.items + [matching[0].name | lower] %}\n  {%
              endif %}\n{% endfor %} {{ names.items }}"
            is_event: '{{ event_label_name | lower in card_label_names }}'
            is_past_due: '{{ full_card_details.content.dueAt is defined and full_card_details.content.dueAt
              != None and as_datetime(full_card_details.content.dueAt) < now() }}'
        - if:
          - condition: template
            value_template: '{{ is_event and is_past_due }}'
          then:
          - action: system_log.write
            metadata: {}
            data:
              level: info
              message: 'Deleting past-due event card "{{ repeat.item.title }}" (due
                {{ full_card_details.content.dueAt }})'
          - action: rest_command.delete_card
            metadata: {}
            data:
              boardId: '{{ boardId }}'
              listId: '{{ full_card_details.content.listId }}'
              cardId: '{{ repeat.item._id }}'
            response_variable: delete_result
          - action: system_log.write
            metadata: {}
            data:
              level: info
              message: 'Delete result for "{{ repeat.item.title }}": {{ delete_result }}'
          else:
          - if:
            - condition: template
              value_template: '{{ not is_event }}'
            then:
            - action: rest_command.get_card_checklists
              metadata: {}
              data:
                boardId: '{{ boardId }}'
                cardId: '{{ repeat.item._id }}'
              response_variable: card_checklists
            - repeat:
                sequence:
                - variables:
                    checklist_id: '{{ repeat.item._id }}'
                    checked_items: '{{ repeat.item.items | default([]) | selectattr(''isFinished'',
                      ''eq'', true) | list }}'
                - repeat:
                    sequence:
                    - action: system_log.write
                      metadata: {}
                      data:
                        level: debug
                        message: 'Unchecking item "{{ repeat.item.title }}" on card
                          "{{ full_card_details.content.title }}"'
                    - action: rest_command.update_checklist_item
                      metadata: {}
                      data:
                        boardId: '{{ boardId }}'
                        cardId: '{{ full_card_details.content._id }}'
                        checklistId: '{{ checklist_id }}'
                        itemId: '{{ repeat.item._id }}'
                        isFinished: false
                    for_each: '{{ checked_items }}'
                for_each: '{{ card_checklists.content }}'
      for_each: '{{ swimlane_cards.content }}'
```

Notes for the implementer:
- Inner `repeat.item` shadows outer ones — `checklist_id` is captured in a
  `variables:` step before the nested repeat; the card id comes from
  `full_card_details` (script-scope variable), never from a shadowed
  `repeat.item`.
- If the live probe (Verification step 4) shows `get_card_checklists`
  responses do NOT embed `items`, add a `get_checklist` rest_command
  (`GET /api/boards/{{ boardId }}/cards/{{ cardId }}/checklists/{{ checklistId }}`)
  and fetch each checklist inside the outer checklist repeat instead.

### Step 2 — MODIFY `configuration.yaml`

Remove the 8 WeKan `rest_command` entries (lines ~891–947, from
`get_board_swimlanes:` through `move_card_to_swimlane:`). Keep `print_label`,
`render_label`, `label_printer_health`, `label_printer_status`,
`label_print_batch`, `label_render_batch`, `healthchecksio`. Leave a pointer
comment where the WeKan block was:

```yaml
  # WeKan board REST commands live in packages/package_wekan.yaml
```

### Step 3 — MODIFY `automations.yaml`

Remove the 5 WeKan automation blocks (ids `1739773495929`, `1739829986815`,
`1739830023654`, `1739830178317` at ~lines 804–867 and `1770269885853` at
~lines 2034–2092). Nothing else changes.

### Step 4 — MODIFY `scripts.yaml`

Remove the 5 `boards_*` script blocks (lines 226–1072:
`boards_move_future_cards_to_default`, `boards_archive_past_unlabeled_tasks`,
`boards_next_week_s_tasks`, `boards_organize_by_labels`,
`boards_update_recurring_tasks`). Nothing else changes.

### Step 5 — Validate + restart

1. `homeassistant_validate_config` — must pass before restart.
2. Restart HA (`homeassistant_call_service` → `homeassistant.restart`) —
   required: packages load at startup; removed entries unload at restart.
3. Post-restart checks:
   - `homeassistant_query_entities name_contains=boards_` → expect 5
     automations + **6** scripts; the 4 move automations still **off**.
   - `homeassistant_list_services domain=rest_command` → confirm
     `delete_card`, `get_card_checklists`, `update_checklist_item` exist
     alongside the moved 8.

### Step 6 — Live verification of the new script

1. **Probe first**: execute `script.boards_reset_inbox_cards` with
   `list_name: "___probe___"` (matches nothing) — confirms swimlane
   resolution and the no-op path without touching real cards. Inspect the
   trace (`homeassistant_manage_trace`) and system log.
2. **Label check**: from the probe/real run's `get_board` response logged in
   traces, confirm a label named exactly `Events & Waiting` exists on board
   `TrfngHQf8PWj9mnqC`; also record the name of swimlane `diPoL2ZNgbaPj9xAh`
   for the skill.
3. **Real run**: execute with defaults (`Today` / `Inbox/Reset` /
   `Events & Waiting`). ⚠️ Warn the user first: past-due event cards will be
   permanently deleted and checked checklist items reset. Then verify:
   - Trace shows correct branch per card (delete vs uncheck vs skip).
   - `homeassistant_manage_system_log` shows the expected delete/uncheck lines.
   - Spot-check the board in WeKan (user confirms).
4. If checklist `items` were missing from `get_card_checklists` responses,
   apply the fallback from Step 1 notes and re-run.

### Step 7 — CREATE the skill

Create `.agents/skills/wekan-home-assistant/SKILL.md` (`.kilo/skills/` is a
symlink to `.agents/skills/`), with attribution line under the H1. Front
matter `name: wekan-home-assistant`; description triggers on WeKan + Home
Assistant board automation. Content:

- What lives in `packages/package_wekan.yaml` and why (context isolation)
- REST command inventory with endpoint + method per command (the moved 8 +
  the new 3) and the `!secret wekan_api_token` convention
- Board topology: board id, swimlane id↔name map (fill in
  `diPoL2ZNgbaPj9xAh` from Step 6), list naming convention (per-swimlane
  `Inbox/Reset`), label semantics (`Events & Waiting` = event; recurring
  labels list)
- Nightly flow: ordered steps of `Boards: Daily Task Organization` with the
  new step 3 and why the order matters (recurring-bump before delete; reset
  before future-move)
- WeKan API gotchas that bit this repo: 200-with-embedded-error, checklist
  items embedding, `WITH_API=true`, long-lived bearer token, no pagination
- How to extend: add a rest_command to the package, add a script field,
  test loop (probe with fake list_name → trace → system_log → real run),
  response_variable pattern
- Pointers: `/home/coder/SpencersLab/skills/wekan-api/` (full API reference)
  and `/home/coder/SpencersLab/containers/wekan-mcp/` (MCP server; delete is
  intentionally outside its surface, which is why HA rest_command does it)

### Step 8 — Optional housekeeping

Update the package list sentence in `AGENTS.md` ("Existing: label_printer,
…") to include `wekan`.

## Verification

Covered in Steps 5–6. Summary of success criteria:
- Config valid; HA restarts clean (no package/load errors in system log).
- 11 entities unchanged in id; disabled automations still disabled.
- 11 rest_command services registered.
- Probe run: clean no-op trace.
- Real run: every Inbox/Reset card in Today swimlane handled per the two
  branches; deletions and unchecks visible in WeKan.

## Risks & open questions

- **Hard delete is irreversible.** WeKan has no undo/archive for DELETEd
  cards. Mitigation: probe run first + user warning before the real run.
- **Checklist `items` embedding** in the list-checklists response is
  believed true (WeKan checklist documents embed items; the MCP server's
  `get_checklist` relies on it) but unverified on this server version —
  Step 6 probes it; fallback is a per-checklist GET rest_command.
- **Label name drift**: `Events & Waiting` must exist exactly on the board
  (match is case-insensitive, so casing is safe). Step 6.2 confirms; the
  `event_label_name` field makes runtime correction possible without YAML
  edits.
- Non-event cards in Inbox/Reset get unchecked **every night even if the
  user is mid-task** — explicitly requested behavior, documented in the
  skill so future readers understand it.
- The 4 disabled move automations are moved as-is and stay disabled; their
  overlap with the daily org automation (which repeats the same 4 moves) is
  pre-existing and out of scope.
- `secrets.yaml` is not in the repo (gitignored) — the package keeps the
  existing `!secret wekan_api_token` reference; nothing to migrate.
