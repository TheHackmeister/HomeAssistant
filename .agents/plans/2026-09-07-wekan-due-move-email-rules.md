# WeKan due-move automations: make board email rules fire (3-step move workaround)

Date: 2026-09-07
Source: SpencersLab GitOps repo agent (wekan-mcp-server-skill-v2 worktree session)
Status: handoff — implement in this repo's `packages/` wekan package

## TL;DR

Three email rules now live on the WeKan Projects board: when the **bot user
moves** a card into the Today / This Week & Weekend / Next Week swimlane, WeKan
emails tms@spencerslab.com. The rules are verified working end-to-end. BUT:
WeKan v9.99's REST API **does not log any `moveCard` activity for moves that
keep the same list** (e.g. a payload of only `{"swimlaneId": ...}`), and rules
only run off activities. Any HA automation that moves cards between swimlanes
within the same list therefore triggers **zero** rules. This document specifies
a 3-step "bounce" move that reliably produces exactly one rule-firing activity,
and exactly how to wire it into the due-date-move package.

## What already exists on the WeKan side (do not recreate)

Instance: `https://wekan.spencerslab.com` (bot-enabled, WeKan v9.99).
Board: Projects `TrfngHQf8PWj9mnqC`.

Rules (created + e2e-tested 2026-09-07 via the wekan-admin MCP server):

| Rule | ID | Trigger | Email subject |
|---|---|---|---|
| Email Today | `KaFPq7sgAmwwyEGGK` | `moveCard`, swimlaneName `Today`, userId `w6BkHXEovmFHsH5NN` | `Due Today: {cardtitle}` |
| Email This Week | `awiusyKqkQLEinjoh` | `moveCard`, swimlaneName `This Week & Weekend`, userId `w6BkHXEovmFHsH5NN` | `Due This Week: {cardtitle}` |
| Email Next Week | `YeLdvL8wZCdKQ22L3` | `moveCard`, swimlaneName `Next Week`, userId `w6BkHXEovmFHsH5NN` | `Due Next Week: {cardtitle}` |

All send to `tms@spencerslab.com`; body includes board link, card name,
swimlane, list, `{duedate}`, moved-by + `{datetime}`, `{description}`.
Delivery verified 3x in the home cluster's `smtp-relay-mail-0` logs
(`status=sent`, relayed via mail.spencerslab.com).

**Identity requirement:** the trigger `userId` is `w6BkHXEovmFHsH5NN` — the
MCP/bot service user. HA's moves only match if `!secret wekan_api_token`
belongs to that same user. Verify once: `GET /api/user` with the HA token must
return `_id: w6BkHXEovmFHsH5NN`. (The token strings may differ; the user must
not.) If it's a different user, the rules need their userId added or the HA
token swapped — escalate to the user before changing anything.

## The WeKan v9.99 bug (root cause, verified in source + live)

`PUT /api/boards/:boardId/lists/:listId/cards/:cardId` (server/models/cards.js):

- The **swimlane-only branch** (`moveParams.swimlaneId` set, no list change)
  writes via `Cards.direct.updateAsync` — skips all collection hooks and never
  calls `cardMove()`. **No activity is created.**
- The **list branch** calls `cardMove(req.userId, card, ['listId'], paramListId)`.
  `cardMove()` (models/cards.js) only inserts a `moveCard` activity when
  `doc.listId !== oldListId` (or a swimlane change is in `fieldNames` — which
  the REST route never passes). So a PUT whose destination list equals the
  card's current list also creates **no activity**.

Consequence: **a REST move produces a `moveCard` activity only when the list
actually changes.** Swimlane-only and same-list moves are silent. Rules
therefore never fire for them. Verified live: same-list move → no email;
list-changing moves → emails delivered (3/3).

UI drag-and-drop is unaffected (goes through collection hooks) — only REST is.

## The 3-step bounce workaround

Goal: move a card from (list `L`, swimlane `S`) to (list `L`, swimlane `T`)
such that exactly ONE `moveCard` activity with `swimlaneName: T` is logged.

Fixed IDs (board `TrfngHQf8PWj9mnqC`, verified 2026-09-07):

- Neutral swimlane: **Default** `44anFDcaRYyswRToE` — no rule targets it.
- Bounce lists (two existing board-level lists; pick whichever is NOT the
  card's current list — no new list needed):
  - Inbox/Reset `F6zDGrwYv6mT9dHPB`
  - Spencers Lab `aW9JT3t6xffTuvHRe`

Sequence (each PUT's URL list segment must be the card's CURRENT list — the
route matches its update selector on it; the destination goes in the body):

1. `PUT .../lists/{L}/cards/{card}` body `{"swimlaneId": NEUTRAL}`
   → silent (no activity — that's the bug, used deliberately). Card: (L, NEUTRAL).
2. `PUT .../lists/{L}/cards/{card}` body `{"listId": BOUNCE, "swimlaneId": NEUTRAL}`
   → list changes → activity with `swimlaneName: NEUTRAL` → matches no rule,
   no email. Card: (BOUNCE, NEUTRAL).
3. `PUT .../lists/{BOUNCE}/cards/{card}` body `{"listId": L, "swimlaneId": T}`
   → list changes → activity with `swimlaneName: T` by the bot → the matching
   rule fires **exactly once** → one email. Card: (L, T). ✓

Edge cases:

- Card already in `T`: skip entirely (the automation's target-vs-current
  condition already guarantees this).
- Card's current list is bounce A: use bounce B (that's what the pick is for).
- Moving between two rule swimlanes (e.g. Today → Next Week): step 2's activity
  carries `NEUTRAL`, so only the destination rule fires. Correct.

Side effects (accepted): two extra "moved" entries in the card's history; the
card sits in the bounce list for milliseconds between steps 2 and 3.

## Implementation in the due-date-move package

The due-move package (automation `WeKan: Move Cards by Due Date` + template
sensor `wekan_due_move`, rest_commands `wekan_get_card` / `wekan_get_swimlanes`
/ `wekan_get_lists` / `wekan_move_card`) is a draft that was never committed —
it exists only in the user's editor/session as of 2026-09-07. Land it together
with these changes. Keep it in `packages/package_wekan.yaml` ONLY if the
nightly org package is being relocated; otherwise give it its own package file
(e.g. `packages/package_wekan_due_moves.yaml`) so it coexists with the nightly
automation.

### 1. New rest_command (alongside the existing `wekan_move_card`)

```yaml
  # Move a card to another LIST (and optionally swimlane) in one PUT.
  # The URL's list_id must be the card's CURRENT list (WeKan matches the
  # update selector on it); the destination list goes in the payload.
  wekan_move_card_to_list:
    url: "http://home-wekan.default.svc.cluster.local:8080/api/boards/{{ board_id }}/lists/{{ list_id }}/cards/{{ card_id }}"
    method: PUT
    headers:
      Authorization: "Bearer {{ token }}"
      Content-Type: "application/json"
    verify_ssl: false
    timeout: 30
    payload: >-
      {
        "listId": "{{ dest_list_id }}",
        "swimlaneId": "{{ swimlane_id }}"
      }
```

### 2. New script: the 3-step bounce

```yaml
script:
  wekan_move_card_to_swimlane:
    alias: "WeKan: Move card to swimlane (fires board email rules)"
    description: >-
      Three-step move so WeKan logs a moveCard activity for the final
      swimlane change. WeKan v9.99 REST logs NO activity for moves that
      keep the same list, so board rules never fire on a direct
      swimlane-only PUT. Steps: park in the neutral swimlane (silent),
      bounce to another list (activity in the neutral swimlane, matches no
      rule), final move into the original list + target swimlane (activity
      in the target swimlane, rule fires exactly once).
    mode: queued
    max: 10
    fields:
      board_id:
        required: true
      list_id:
        required: true
        description: The card's CURRENT list.
      card_id:
        required: true
      target_swimlane_id:
        required: true
    sequence:
      - variables:
          neutral_swimlane_id: "44anFDcaRYyswRToE"  # Default — no rule targets it
          bounce_list_a: "F6zDGrwYv6mT9dHPB"        # Inbox/Reset
          bounce_list_b: "aW9JT3t6xffTuvHRe"        # Spencers Lab
          bounce_list_id: >-
            {% if list_id == bounce_list_a %}
              {{ bounce_list_b }}
            {% else %}
              {{ bounce_list_a }}
            {% endif %}
      # Step 1: park in the neutral swimlane. Swimlane-only PUT — WeKan logs
      # no activity (the very bug this workaround exists for).
      - service: rest_command.wekan_move_card
        data:
          token: !secret wekan_token
          board_id: "{{ board_id }}"
          list_id: "{{ list_id }}"
          card_id: "{{ card_id }}"
          swimlane_id: "{{ neutral_swimlane_id }}"
      # Step 2: bounce to a different list. WeKan logs a moveCard activity,
      # but swimlaneName is the neutral swimlane, so no board rule matches.
      - service: rest_command.wekan_move_card_to_list
        data:
          token: !secret wekan_token
          board_id: "{{ board_id }}"
          list_id: "{{ list_id }}"
          card_id: "{{ card_id }}"
          dest_list_id: "{{ bounce_list_id }}"
          swimlane_id: "{{ neutral_swimlane_id }}"
      # Step 3: into the original list + target swimlane. The list change
      # makes WeKan log a moveCard activity with swimlaneName = target, so
      # the board's email rule fires exactly once.
      - service: rest_command.wekan_move_card_to_list
        data:
          token: !secret wekan_token
          board_id: "{{ board_id }}"
          list_id: "{{ bounce_list_id }}"
          card_id: "{{ card_id }}"
          dest_list_id: "{{ list_id }}"
          swimlane_id: "{{ target_swimlane_id }}"
```

### 3. Repoint the automation's move action

Replace the direct `rest_command.wekan_move_card` call in
`automation_wekan_due_move`'s repeat sequence with:

```yaml
        - service: script.wekan_move_card_to_swimlane
          data:
            board_id: "{{ board_id }}"
            list_id: "{{ list_id }}"
            card_id: "{{ card_id }}"
            target_swimlane_id: "{{ target_swimlane_id }}"
```

### 4. Sensor: keep its corrective move swimlane-only (do NOT use the script there)

`sensor.wekan_due_move`'s corrective move should stay a single swimlane-only
PUT (`wekan_move_card`): it stays synchronous with the sensor's immediate
re-fetch/verify step, and sensor corrections then remain email-silent. Do NOT
call the 3-step script from inside the sensor's state template — the script is
async, so the verify re-fetch would race the three steps (it could observe the
NEUTRAL or BOUNCE swimlane mid-sequence and wrongly "restore" the card).

Consequence to note in the package header comment: sensor drift-corrections
move cards without emails; the time-triggered automation is what emails.

## Known caveats / accepted risks

- **Double-move race:** the automation (every 10 min) and the sensor (every
  10 min) can both observe the same mismatched card before either finishes →
  the card gets bounced twice → two emails. Rare; accept for now. Mitigation
  if it bites: have the sensor skip cards whose `dateLastActivity` is < 2 min
  old, or phase-offset the schedules.
- **WeKan template limits (rules side, informational):** no variables exist
  for card link, start/end dates, labels, or checklists; `{duedate}` renders
  literally when the card has no due date. Don't try to fix these from HA.
- **Long-term fix:** the proper repair is upstream in WeKan (the swimlane
  branch of the PUT route should call `cardMove()` with `['swimlaneId']` and
  the previous swimlane id). If that ever ships in a release the lab bumps to,
  the bounce can be retired and direct swimlane-only PUTs used again.

## Verification after implementing

1. `token identity`: `GET /api/user` with `!secret wekan_api_token` returns
   `_id: w6BkHXEovmFHsH5NN` (see Identity requirement above).
2. Create/choose a test card with a due date today; run the automation (or
   wait for its 10-minute tick). Expect: card lands in the Today swimlane and
   exactly ONE email arrives at tms@spencerslab.com ("Due Today: <title>").
3. Confirm delivery if needed: home cluster pod `smtp-relay-mail-0` logs show
   `connect from ... home-wekan ...` and `status=sent` for the message.
4. Check the card's activity/history in the WeKan UI: two bounce moves + the
   final move are expected.
