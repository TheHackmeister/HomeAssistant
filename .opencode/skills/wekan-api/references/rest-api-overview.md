# WeKan REST API Overview

Endpoint reference for the current WeKan REST API, distilled from the wiki (`REST-API-*` pages), the repo's `docs/API/*.md`, the generated Redoc HTML, and `api.py`. **Version pinning (re-stamped 2026-10-30):** the lab's server is chart-pinned wekan 12.65.0 = upstream **v12.65**; the Boards, Board members and roles, Swimlanes, and Labels sections were re-verified against the registered handlers at that tag (v9.88 checked as the documented low bound — no drift on those routes). The remaining sections stay **version-lagged**: for anything critical, verify against `models/*.js` and `api.py` for your pinned WeKan version.

## Table of contents

1. [Base conventions](#base-conventions)
2. [Login and users](#login-and-users)
3. [Boards](#boards)
4. [Board members and roles](#board-members-and-roles)
5. [Lists](#lists)
6. [Swimlanes](#swimlanes)
7. [Cards](#cards)
8. [Checklists and checklist items](#checklists-and-checklist-items)
9. [Card comments](#card-comments)
10. [Automation rules](#automation-rules)
11. [Custom fields](#custom-fields)
12. [Labels](#labels)
13. [Integrations (webhooks)](#integrations-webhooks)
14. [Attachments](#attachments)
15. [Admin and global settings](#admin-and-global-settings)
16. [Error handling patterns](#error-handling-patterns)

## Base conventions

- **Base URL**: your WeKan root, e.g. `https://boards.example.com`. Endpoints below are relative to that.
- **All authenticated requests** send `Authorization: Bearer <token>`.
- **All write requests** send `Content-Type: application/json` and a JSON body.
- **Server-side flag**: WeKan must be started with `WITH_API=true`, or every REST call returns an authentication error.
- **No pagination**. List endpoints return the full array.
- **No documented rate limiting**. Add client-side backoff yourself if hitting a slow board.
- **HTTP 200 does not mean success.** Many routes return 200 with an embedded error object. Parse the body.

## Login and users

### `POST /users/login` — obtain a bearer token (one-time)

This skill assumes the caller has already done this once and exported the resulting token as `WEKAN_TOKEN`. Documented here so you can help them do it if they haven't.

No auth on the endpoint itself. Use JSON — **form data is documented as broken** ("DOES NOT WORK! Please use As JSON example below!").

```bash
curl -X POST https://boards.example.com/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"s3cret"}'
```

Response:

```json
{
  "id": "wA8Ekjr5c9pDfSjaG",
  "token": "yA7l6vJ2...",
  "tokenExpires": "2026-10-17T12:34:56.789Z"
}
```

Notes:
- `username` and `password` are **case-sensitive**.
- `email` may be substituted for `username`.
- Token lifetime is governed server-side by `ACCOUNTS_COMMON_LOGIN_EXPIRATION_IN_DAYS` (default 90 days). One login → one long-lived token that can be reused across many sessions and scripts.
- **Logging in again does not invalidate the previous token** (issue #1437). Old tokens remain valid until they expire. Practical consequence: you cannot rotate a leaked token by re-logging-in — an admin must disable/re-enable the user, or the tokens must be cleared in Mongo directly.
- **LDAP/OIDC-only accounts fail here.** Use a password-based service account.

### `POST /users/register` — public self-registration

Only works if self-registration is enabled server-side. Body: `{ "username", "email", "password" }`.

### `POST /api/users` — create a user (admin)

Admin-only. Body includes `username`, `email`, `password`, and typically `fromAdmin: true`.

### `GET /api/users` — list users (admin only)

Returns array of `{_id, username}`.

### `GET /api/users/:id`

Returns full user document.

### `GET /api/user`

Returns the currently logged-in user (based on the bearer token).

### `PUT /api/users/:id`

Perform an action on a user. Body: `{ "action": "disableLogin" | "enableLogin" | "takeOwnership" }`.

### `DELETE /api/users/:id`

Deletes a user. Historically destructive — verify behavior on your version (issue #1289).

### `GET /api/users/:id/boards`

Boards this user is a member of.

## Boards

### `GET /api/boards/:id`

Full board document, including labels, members, permission.

### `POST /api/boards`

Create a board. Admin permission required for arbitrary `owner`; otherwise owner is inferred.

```json
{
  "title": "Q4 Roadmap",
  "owner": "wA8Ekjr5c9pDfSjaG",
  "isAdmin": true,
  "isActive": true,
  "isNoComments": false,
  "isCommentOnly": false,
  "permission": "private",
  "color": "belize"
}
```

Valid colors: `belize`, `nephritis`, `pomegranate`, `pumpkin`, `wisteria`, `midnight`, `moderatepink`, `strongcyan`, `limegreen`, `midnight`, `dark`, `relax`, `corteza`, `clearblue`, `natural`. (Set has grown over time; verify against your version.)

Response: `{ "_id": "<newBoardId>", "defaultSwimlaneId": "..." }`.

### `PUT /api/boards/:id/title` — rename a board

Body: `{"title": "New title"}`. Gate at v12.65: `checkBoardAdmin` (board admin or site admin) — a normal member gets **HTTP 403** and the title is unchanged (v9.88 was looser: board write access sufficed; verified 2026-10-30). Response: `{"_id": "<boardId>", "title": "<new title>"}`.

The handler `$set`s the title only, so the board `_id` and the per-board `cardNumber` sequence survive a rename by construction — the counter lives in the `Counters` collection (`_id = "cardNumber-<boardId>"`), not on the board document, so every list/card/swimlane id and `cf-<cardNumber>` slug rides through untouched.

**There is no bare `PUT /api/boards/:id`** — it answers **405** at v9.88, v12.65 and v12.74 (upstream #5299); do not fetch-modify-put a full board document, none is writable. Board `color`, `permission` and `key` are set at create only and are REST-immutable afterwards.

### `DELETE /api/boards/:id`

Deletes the board.

### `POST /api/boards/:id/copy`

Duplicate a board.

### `GET /api/boards/:id/export`

Returns the full board JSON for backup/migration.

### `GET /api/boards/:id/attachments`

Returns all attachments on the board:

```json
[
  {
    "attachmentId": "...",
    "attachmentName": "spec.pdf",
    "attachmentType": "application/pdf",
    "url": "https://.../cdn/storage/attachments/.../original/spec.pdf",
    "urlDownload": "https://.../cdn/storage/attachments/.../download/spec.pdf",
    "boardId": "...",
    "swimlaneId": "...",
    "listId": "...",
    "cardId": "..."
  }
]
```

### `PUT /api/boards/:id/labels` — add a label

Gate: board admin or site admin (clean 401/403/404 with an `{"error": ...}` body). Accepted body forms (verified v12.65, 2026-10-30; identical at v9.88): `{"label": {"name": "urgent", "color": "red"}}`; `{"label": {"name": "urgent"}}` — color defaults to `green`; or the string form `{"label": "urgent"}`. A missing or garbage `label` answers a clean 400 (#5510).

Label colors — the 25 names in `config/const.js`, identical at v9.88 and v12.65: `white`, `green`, `yellow`, `orange`, `red`, `purple`, `blue`, `sky`, `lime`, `pink`, `black`, `silver`, `peachpuff`, `crimson`, `plum`, `darkgreen`, `slateblue`, `magenta`, `gold`, `navy`, `gray`, `saddlebrown`, `paleturquoise`, `mistyrose`, `indigo`. Unknown or hex colors answer 400 `Invalid label color '<x>'. Allowed colors: ...`. (Board colors are a different set — see `POST /api/boards` above.)

Response: a **bare JSON string** — the label id, new or existing, e.g. `"aB3xY9"`; parse it as a string, not an object. The idempotency key is (name, color): re-PUTting an existing (name, color) returns the existing id, while the same name with a different color creates a second label and returns the new id — never promise "rename by name".

### `GET /api/boards/:id/cards_count`

Returns `{ "cards_count": <int> }`.

### `GET /public`

Public boards, no auth required.

### `GET /api/boards_count`

Total counts (admin).

### Email-domain sharing (admin)

- `GET /api/boards/:id/domains`
- `POST /api/boards/:id/domains` — body `{ "domain": "example.com" }`
- `DELETE /api/boards/:id/domains/:domain`

## Board members and roles

The board document (`GET /api/boards/:id`, see [Boards](#boards)) stores `members[]` as an array of objects, and carries no usernames except the v12.65 `members.$.grantedBy` provenance array for team/org-granted memberships (shape verified v12.65, 2026-10-30; same at v9.88):

- `userId` — the member's user id.
- Required booleans: `isAdmin`, `isActive`.
- Seven optional booleans: `isNoComments`, `isCommentOnly`, `isWorker`, `isNormalAssignedOnly`, `isCommentAssignedOnly`, `isReadOnly`, `isReadAssignedOnly`.

Nine role booleans per entry in total — 2 required + 7 optional. There is no `owner` field: ownership is the members entry with `isAdmin: true`. No route at board-member privilege publishes usernames — the user-lookup routes (`GET /api/users`, `GET /api/users/:userId`) are site-admin-only (v12.65).

### `POST /api/boards/:id/members/:userId/add`

Adds a member to the board. **The `isAdmin: true` field in the body is ignored** on this endpoint — new members come in without admin. To promote them, immediately call the role-setting endpoint below.

### `POST /api/boards/:id/members/:userId/remove`

Removes a member. Removing a *deleted* user has silently no-op'd in older versions (issue #5330).

### `POST /api/boards/:id/members/:userId` — set role

Body: the role booleans — the stored entry keeps `isAdmin`/`isActive` required and the seven flags optional:

```json
{
  "isAdmin": true,
  "isActive": true,
  "isNoComments": false,
  "isCommentOnly": false,
  "isWorker": false
}
```

- `isAdmin` — full board admin.
- `isNoComments` — read-only.
- `isCommentOnly` — can comment but not edit cards.
- `isWorker` — limited role (assigned work only).
- `isNormalAssignedOnly`, `isCommentAssignedOnly`, `isReadOnly`, `isReadAssignedOnly` — the remaining four optional flags ride the same stored entry; their UI semantics live in the upstream board schema (verify on your version).

## Lists

Lists are the columns on a board.

### `GET /api/boards/:boardId/lists`

Array of `{ _id, title }`.

### `GET /api/boards/:boardId/lists/:listId`

Full list document.

### `GET /api/boards/:boardId/lists/:listId/cards`

Array of full card documents in the list (same shape as `GET .../swimlanes/:swimlaneId/cards`). Used by the wekan-mcp `list_cards_in_list` tool and `scripts/lists_swimlanes_cards_crud.py`.

### `POST /api/boards/:boardId/lists`

Body: `{ "title": "In progress" }`. Response: `{ "_id": "<newListId>" }`.

### `DELETE /api/boards/:boardId/lists/:listId`

## Swimlanes

Swimlanes are the horizontal rows. A board has at least one (the default swimlane, whose ID is returned when the board is created). Route bodies verified v12.65, 2026-10-30; identical at v9.88.

### `GET /api/boards/:boardId/swimlanes`

Array of `{_id, title}` — the collection projection carries no `sort`.

### `GET /api/boards/:boardId/swimlanes/:swimlaneId`

The single-swimlane GET returns the full document **including `sort`**, filtered to `archived: false`. It is the only route that reads `sort` back.

### `POST /api/boards/:boardId/swimlanes` — body `{ "title": "...", "sort": <number> }`

`title` required, `sort` optional; gate is board write access. An explicit finite `sort` is honored (#3624 — fixed long before the pinned tags); an omitted one appends at max(live sibling sorts)+1, computed over `archived: false` siblings only, so sequential creates land in creation order. Response: `{ "_id": "<newSwimlaneId>" }` only — no title, no sort; read the created swimlane back from the single GET above.

### `PUT /api/boards/:boardId/swimlanes/:swimlaneId`
### `DELETE /api/boards/:boardId/swimlanes/:swimlaneId`
### `GET /api/boards/:boardId/swimlanes/:swimlaneId/cards`

## Cards

### `POST /api/boards/:boardId/lists/:listId/cards` — create a card

Body:

```json
{
  "title": "Investigate flaky test",
  "description": "Details...",
  "authorId": "<userId>",
  "swimlaneId": "<swimlaneId>",
  "members": ["<userId>"],
  "assignees": ["<userId>"]
}
```

`authorId` and `swimlaneId` are required. Response: `{ "_id": "<newCardId>" }`.

### `GET /api/boards/:boardId/cards/:cardId`

Full card document (many fields):

```
_id, title, description, listId, swimlaneId, boardId,
members, assignees, labelIds, receivedAt, startAt, dueAt, endAt,
spentTime, isOvertime, customFields, vote, poker, parentId (subtask), ...
```

### `PUT /api/boards/:boardId/lists/:fromListId/cards/:cardId` — update

Update any subset of fields. To **move a card between lists**, include `"listId": "<toListId>"` in the body. Note the `fromListId` in the URL is still the *current* list.

### `DELETE /api/boards/:boardId/lists/:listId/cards/:cardId`

### `GET /api/boards/:boardId/cards_count`
### `GET /api/boards/:boardId/lists/:listId/cards_count`

### `GET /api/boards/:boardId/cards/customField/:customFieldId?value=...`

Returns cards matching a custom-field value (exact name of the endpoint varies by version — check `models/cards.js`).

### `POST /api/boards/:boardId/cards/:cardId/customFields/:customFieldId` — set a custom field on a card

Body depends on field type: `{ "value": "..." }` for text/number; item id for dropdown.

## Checklists and checklist items

### `GET /api/boards/:boardId/cards/:cardId/checklists`
### `POST /api/boards/:boardId/cards/:cardId/checklists` — body `{ "title": "Acceptance criteria", "items": ["item 1","item 2"] }`
### `GET /api/boards/:boardId/cards/:cardId/checklists/:checklistId`
### `DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId`

### `POST /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items` — body `{ "title": "..." }`
### `GET /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId`
### `PUT /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId` — body `{ "isFinished": true }` toggles the checkbox
### `DELETE /api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId`

## Card comments

### `GET /api/boards/:boardId/cards/:cardId/comments`
### `POST /api/boards/:boardId/cards/:cardId/comments` — body `{ "authorId": "<userId>", "comment": "..." }`
### `GET /api/boards/:boardId/cards/:cardId/comments/:commentId`
### `DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId`

## Automation rules

Board automation rules (IFTTT-style, issue #2674). A rule links a **trigger** (an activity event, a schedule, or a manual button) to an **action**. The REST API embeds the full trigger and action inline, so a rule is self-contained. Verified against `server/models/rules.js` on WeKan v9.99 (the lab's deployed version at check time; gate re-checked from the v12.65 tag 2026-10-30). Writes require board **admin** (`checkBoardAdmin`) at v12.65 — board write access was the v9.99-era gate; reads require board membership.

### `GET /api/boards/:boardId/rules`

Returns an array of `{_id, title, trigger, action}`. Trigger/action documents come back with internal fields (`_id`, `boardId`, timestamps) already stripped.

### `GET /api/boards/:boardId/rules/:ruleId`

One rule as `{_id, title, trigger, action}`. Errors if the rule does not belong to the board.

### `POST /api/boards/:boardId/rules` — create a rule

Body: `{ "title": "...", "trigger": {...}, "action": {...} }`. `trigger.activityType` and `action.actionType` are required. Omitted trigger matching fields (`listName`, `oldListName`, `swimlaneName`, `cardTitle`, `userId`) default to the `'*'` wildcard server-side — this is what makes "add member on move TO list" / "remove member on move AWAY FROM list" pairs work (#2674). Response: `{_id, triggerId, actionId}`.

```bash
curl -X POST https://boards.example.com/api/boards/<boardId>/rules \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"title":"Add member on move to Doing",
       "trigger":{"activityType":"moveCard","listName":"Doing"},
       "action":{"actionType":"addMember","username":"someuser"}}'
```

### `PUT /api/boards/:boardId/rules/:ruleId` — edit a rule

Body: any of `{ "title"?, "trigger"?, "action"? }`. A supplied trigger/action **replaces** the stored document wholesale — include every field the rule should keep matching on. Response: `{_id}`.

### `DELETE /api/boards/:boardId/rules/:ruleId`

Removes the rule **and its trigger and action**. Response: `{_id}`.

Notes:

- Trigger `activityType` values include `createCard`, `moveCard`, `editCard`, plus `scheduledTrigger` (with `scheduleKind`, e.g. `aging` + `days` + `atTime`) and `button` (with `buttonType`/`buttonLabel`). Scheduled and button triggers are NOT wildcard-normalized.
- Action `actionType` values include `addMember`, `removeMember`, `moveCardToTop`, `moveCardToBottom`, `archive`, and more.
- The trigger vocabulary and matching fields are enumerated in `server/triggersDef.js`; action types are dispatched in `server/rulesHelper.js` (both version-specific — re-verify on upgrade).
- **REST move gotcha (verified on v9.99)**: a REST card move that changes ONLY the swimlane (same list) creates **no `moveCard` activity** — the PUT route writes the swimlane via `Cards.direct` (skipping collection hooks) and only calls `cardMove()` with `['listId']` in the list-change branch. `moveCard`-triggered rules therefore fire only on REST moves that change the **list** (a swimlane change rides along in that activity). UI drag-and-drop is unaffected (it goes through the collection hooks and fires for swimlane-only moves too).

### Template variables in action text fields (`{name}` tokens, issue #2475)

Rules support Trello-Butler-style `{variable}` substitution, expanded when the rule fires (verified in `server/rulesHelper.js` on v9.99). It applies to **all three `sendEmail` action fields** (`emailTo`, `emailSubject`, `emailMsg`) and to `addChecklist`/`addChecklistWithItems` `checklistName` (+ items), `addSwimlane` `swimlaneName`, and `createCard` `cardName`.

Available variables (lookup is case-insensitive: `{CardName}` == `{cardname}`):

| Variable | Value |
|---|---|
| `{cardname}` / `{cardtitle}` | title of the card that triggered the rule |
| `{cardnumber}` | the card's number |
| `{description}` | card description |
| `{duedate}` | card due date, locale string (only when the card has one) |
| `{listname}` | list containing the card |
| `{swimlanename}` | swimlane containing the card |
| `{boardname}` | board title |
| `{username}` | user who performed the triggering activity |
| `{date}` / `{time}` / `{datetime}` | current date / time / both at rule execution |

Semantics:

- Tokens match `\{(\w+)\}`; **unknown tokens are left untouched** (no error).
- Card-scoped variables need a card context: board-level rules (scheduled/button triggers running without a card) leave `{cardname}` etc. unexpanded.
- `{username}` is the activity's actor, not the email recipient.
- `sendEmail` also detects the recipient's WeKan language preference (lookup by email address) for localized mail templates; the From address is the server's mail-template From. The WeKan server must have mail delivery configured (e.g. `MAIL_URL`) or no mail goes out — send failures are logged server-side and swallowed by the rule engine.

Example — email the team when a card is moved to "Done":

```bash
curl -X POST https://boards.example.com/api/boards/<boardId>/rules \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"title":"Email on done",
       "trigger":{"activityType":"moveCard","listName":"Done"},
       "action":{"actionType":"sendEmail",
                 "emailTo":"team@example.com",
                 "emailSubject":"[{boardname}] {cardname} is done",
                 "emailMsg":"{username} moved \"{cardname}\" to Done on {datetime}.\n\n{description}"}}'
```

## Custom fields

### `GET /api/boards/:boardId/custom-fields`
### `POST /api/boards/:boardId/custom-fields`

Body:

```json
{
  "name": "Story points",
  "type": "number",
  "settings": {},
  "showOnCard": true,
  "automaticallyOnCard": false,
  "showLabelOnMiniCard": true,
  "showSumAtTopOfList": false,
  "authorId": "<userId>"
}
```

Valid `type`: `text`, `number`, `date`, `dropdown`, `checkbox`, `currency`, `stringtemplate`.

### `GET /api/boards/:boardId/custom-fields/:id`
### `PUT /api/boards/:boardId/custom-fields/:id`
### `DELETE /api/boards/:boardId/custom-fields/:id`

For `dropdown` fields, there are additional endpoints to add/edit/delete items — check `models/customFields.js`.

## Labels

Labels live on the board document (`board.labels`). Create/update via `PUT /api/boards/:id/labels` (see [Boards](#boards)) — it answers a bare JSON string label id and is idempotent on (name, color) (v12.65, 2026-10-30). To apply to a card, add the label's `_id` to `card.labelIds` via a card update, or use the bulk route `POST /api/boards/:boardId/cards/labels` with body `{"cardIds": ["..."], "addLabelIds": ["..."]}` — present at v9.88 and v12.65; a label id not on the board answers 400.

## Integrations (webhooks)

Outgoing webhooks configured per board.

### `GET /api/boards/:boardId/integrations`

**Note**: `GET` responses **strip the `token` field** for security. If you need the token, store it client-side when you create the integration.

### `POST /api/boards/:boardId/integrations`

```json
{
  "enabled": true,
  "title": "Slack notifier",
  "url": "https://hooks.example.com/wekan",
  "token": "<optional-shared-secret>",
  "activities": ["all"]
}
```

`activities` can be `["all"]` or a list of activity names (e.g. `"act-createCard"`, `"act-moveCard"`).

### `GET /api/boards/:boardId/integrations/:intId`
### `PUT /api/boards/:boardId/integrations/:intId`
### `DELETE /api/boards/:boardId/integrations/:intId`
### `.../integrations/:intId/activities` — GET the delivered activities log

See `references/webhook-data.md` for the payload shape and activity catalog.

## Attachments

Historically attachment upload over REST was missing (issue #1482). Current WeKan implements it via the routes wrapped by `api.py`. Exact paths vary by version — verify against `models/attachments.js`.

### `GET /api/boards/:boardId/attachments`

Returns the array shown earlier under [Boards](#boards).

### Upload

Typically `POST /api/boards/:boardId/swimlanes/:swimlaneId/lists/:listId/cards/:cardId/attachments` as `multipart/form-data` with a `file` field. `api.py`'s `uploadattachment` takes an optional storage-backend argument (`fs`, `gridfs`, `s3`).

### Download

`GET` the `urlDownload` returned by the attachments list. This is CDN storage, not the API root; it may require the same auth cookie/header.

### Delete

`DELETE /api/attachments/:attachmentId` (verify against `api.py`).

### Copy/move

`api.py` exposes `copymoveattachment` — POST with target board/swimlane/list/card IDs and `mode: "copy" | "move"`.

### Board background

Upload/download a board background image; see `api.py`'s `uploadbackground` / `downloadbackground`.

### Attachment settings (admin)

- `GET /api/admin/attachment-settings`
- `PUT /api/admin/attachment-settings` — body `{ "field": "<dotted.path>", "value": ... }`

Controls storage backend, max size, allowed MIME types, external AV scanning program.

## Admin and global settings

### `GET /api/settings` / `PUT /api/settings` — global admin

Field-whitelisted. SMTP credentials are never returned or writable through this endpoint.

## Error handling patterns

- **HTTP 401**: token expired, invalid, or `WITH_API` disabled. Re-login and retry.
- **HTTP 403**: token valid but the user lacks permission for the resource.
- **HTTP 404**: resource doesn't exist, or endpoint doesn't exist on this version. Verify the path in `models/*.js`.
- **HTTP 500**: server-side, often on LDAP/OIDC users hitting password login or on attachment bugs in older versions.
- **HTTP 200 with `{"error": ..., "reason": ...}` body**: business-logic error. Always parse the body before treating a 200 as success.
