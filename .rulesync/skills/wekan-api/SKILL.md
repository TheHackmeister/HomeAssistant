---
name: wekan-api
description: Interact with a WeKan open-source kanban server via its REST API — authenticate, manage boards/lists/swimlanes/cards/checklists/comments/custom-fields/attachments, and handle outgoing webhooks. Use this skill whenever the user mentions WeKan, Wekan, a self-hosted kanban board, an "open-source Trello alternative," or asks to script/automate kanban actions against a WeKan instance (creating cards from tickets, syncing boards, receiving board events, migrating from Trello/Jira into WeKan, etc.), even if they don't explicitly say "REST API." Also use when the user references endpoints like `/users/login`, `/api/boards`, or files like `api.py` from the wekan/wekan repo. This skill also covers the lab's `wekan-mcp` server (`containers/wekan-mcp`), which exposes the high-frequency subset of these operations as MCP tools.
---

# WeKan REST API Skill

Tools and reference material for driving a WeKan server through its REST API.

## When this skill applies

Use it when the user wants to:

- Read or mutate data on a WeKan instance (boards, lists, swimlanes, cards, checklists, comments, custom fields, labels, members, attachments).
- Authenticate against WeKan and manage bearer tokens.
- Set up or consume outgoing webhooks for kanban events.
- Migrate data into WeKan from Trello, Jira, CSV, etc., or export it out.
- Stand up a local WeKan instance for API testing.

If the user is just looking for UI help, general kanban advice, or non-WeKan tools (Trello, Jira, Planka, Kanboard), this skill is not the right fit — say so and redirect.

## Prefer the wekan MCP server when it is available

For generic MCP board work — call shapes, projections, failure modes, the
board-context block schema — load the `wekan-mcp` skill (`skills/wekan-mcp/`);
it owns the agent-side tool surface. This section keeps the deployment and
credential story, and the rest of this skill owns raw REST plus server
internals (with the rules-engine vocabulary and MCP-over-HTTP recipe in
`references/wekan-mcp-ops.md`).

In SpencersLab, prefer the **`wekan` MCP server** over raw REST calls. It is an
in-repo server (`containers/wekan-mcp`), published as
`ghcr.io/ownyourio/wekan-mcp` and deployed on the lab's ToolHive platform
(`charts/hivetools`). Three deployments share that image:

- **`wekan-readonly`** — `https://mcp.gpu.spencerslab.com/wekan-readonly/mcp`
  (Keycloak OIDC audience `wekan-readonly`): read tools only; write tools are
  never registered (`WEKAN_MCP_READ_ONLY=true`).
- **`wekan-admin`** — `https://mcp.gpu.spencerslab.com/wekan-admin/mcp`
  (audience `wekan-admin`): the full 31-tool surface. The two gpu tiers share
  one long-lived `WEKAN_TOKEN`.
- **`boards`** on the dev cluster — the pipeline board-intake endpoint. It
  authenticates by login-mint instead: the pod gets `WEKAN_USERNAME` +
  `WEKAN_PASSWORD` from a Bitwarden LOGIN item (the base URL rides that
  item's URI field) and the client exchanges the pair for a bearer at
  startup, re-minting once on a 401.

The server exposes 31 typed tools:

- **Read:** `list_boards`, `get_board`, `list_lists`, `list_swimlanes`,
  `list_cards_in_list`, `get_card`, `list_comments`, `list_checklists`,
  `get_checklist`, `list_rules`, `get_rule`, `list_custom_fields`,
  `get_custom_field`, `list_board_members` (user ids + nine normalized
  role booleans; usernames are site-admin-gated REST, so each entry
  carries `username: null` + a `username_resolution` note)
- **Write** (every tier except `wekan-readonly`): `create_card` (optional
  `default_checked` map — checklist title → item titles to arrive CHECKED;
  bounded-polls the rules-created checklist, then PUTs the exact-title items),
  `update_card`, `move_card`, `add_comment`, `add_checklist`,
  `add_checklist_item`, `toggle_checklist_item`, `delete_checklist_item` (destructive, scoped to
  one item), `create_rule`, `update_rule`, `remove_rule` (marked
  destructive), `create_custom_field`, `set_card_custom_field`,
  `create_list` (optional `swimlane_id` + `position`; omitted `swimlane_id`
  binds the board's first swimlane, and `position` rides a second, non-atomic
  same-board move POST — a failed reposition reports `positioned: false` +
  `position_error` and never fails the create),
  `update_board` (title-only rename via the dedicated title route — board id
  and the cardNumber sequence survive by construction; board-admin gate),
  `create_swimlane` (optional explicit `sort`, else appends at max+1; the
  hydrated echo carries the actual `sort`), and `create_label` ((name, color)
  idempotent, 25 named colors validated client-side — hex rejected with the
  allowed list before any request)

Using it keeps the credential (bearer or login pair) entirely out of model
context — it lives only in the server pod, injected via ExternalSecret +
Bitwarden — and its errors are sanitized. It targets the bot-enabled instance
`https://wekan.spencerslab.com` (`WITH_API=true`, password-based service user).

Fall back to this skill's raw REST workflow only when:

- the operation is intentionally omitted from the MCP surface — attachments,
  webhooks, admin/user management, imports/exports, and entity-level
  destructive ops (`delete_board`, `delete_card`, `delete_list`,
  `remove_member`); or
- the MCP server is unavailable, or the task targets a different WeKan
  instance than the lab's.

Some gaps have MCP-native workarounds instead — card label assignment (no
label tool; rules-engine round-trip) and per-card custom-field writes
(upsert tool) are documented in `references/wekan-mcp-ops.md`.

For deploying or modifying the MCP server itself, see
`skills/helm-chart-creation/references/mcp-servers.md` (platform wiring) and
`containers/wekan-mcp/README.md` (server internals).

## Ground truth and version pinning

WeKan releases **frequently** (near-daily). Two facts drive everything else in this skill:

1. **The generated docs at `https://wekan.fi/api/vX.YZ/` lag the code**, sometimes by many minor versions. Documented content-types (`multipart/form-data`) and some documented endpoints do not match reality.
2. **The wiki itself states "REST API is not complete yet, please add missing functionality with pull requests to devel branch."**

Therefore, when the user's target version matters (which is almost always):

- Ask for or confirm the target WeKan version. Pin it.
- Treat these repo files as **canonical**, in this order:
  1. `https://github.com/wekan/wekan/blob/main/api.py` — the official Python CLI. It is the widest and most current surface (attachments, admin settings, imports).
  2. `https://github.com/wekan/wekan/tree/main/models/*.js` — the Meteor model files that actually declare the routes.
  3. `https://github.com/wekan/wekan/tree/main/docs/API/` and the GitHub wiki `REST-API-*` pages — human-readable but partially stale.
  4. The generated Redoc HTML at `wekan.fi/api/vX.YZ/` — useful for schemas but version-lagged.
- On upgrade, diff `api.py` and the relevant `models/*.js` to see what changed.

## Standard workflow

1. **Confirm target WeKan version and base URL.** The base URL is the site root (e.g. `https://boards.example.com`), *not* including `/api`. Dev servers use `http://localhost:3000`; Docker maps to port `8080` internally.
2. **Reuse the caller's existing token.** This skill assumes the user has already logged in out-of-band (once) and has a bearer token available as `WEKAN_TOKEN`. Do not build login flows into scripts. If the user needs to obtain a token in the first place, see the `/users/login` section in `references/rest-api-overview.md` — a single JSON POST returns a token they can then reuse indefinitely.
3. **Send all authenticated requests with** `Authorization: Bearer <token>` and, for writes, `Content-Type: application/json`.
4. **Resolve IDs top-down** (board → swimlane/list → card). Child endpoints require parent IDs. Cache the ID map for a session.
5. **Check response bodies for errors even on HTTP 200.** Several routes return 200 with an embedded error object.
6. **Do not assume pagination or rate limits.** There is no cursor/page parameter on list endpoints and no documented API rate limiting. Plan for large payloads and add your own client-side backoff for slow boards.
7. **On upgrade or unexpected behavior**, re-verify the endpoint against `api.py` / `models/*.js` for the pinned version.

## Non-obvious facts to encode into any code you write

These come up repeatedly and are easy to get wrong:

- **`WITH_API=true`** must be set on the server, or every REST call returns an auth error even with a valid token. If the caller gets 401 with a token they know is fresh, this is usually why.
- **Tokens are long-lived by default** — the server env `ACCOUNTS_COMMON_LOGIN_EXPIRATION_IN_DAYS` defaults to 90. A token obtained once can be reused for the whole lifetime. **But**: old tokens remain valid after re-login (GitHub issue #1437), so the caller cannot "rotate" a token by logging in again. To invalidate a leaked token, an admin must disable/re-enable the user via `PUT /api/users/:id` or reset their tokens directly in Mongo.
- **HTTPS only.** The bearer token is a long-lived credential; treat it like a password. Never log it, never commit it, never send it over plain HTTP.
- **The `isAdmin: true` field is ignored** on the "add member to board" endpoint — added members come in as non-admin regardless. To promote a member, use the separate role-setting endpoint (`POST /api/boards/:id/members/:userId`).
- **Some endpoints require the global admin** (the first-created user): `GET /api/users`, `/api/settings`, `/api/admin/attachment-settings`, most bulk/global operations. If the token belongs to a non-admin, expect 403 on these.
- **Webhook receivers must return `200 OK` immediately**, or WeKan's activity processing stalls. Do work asynchronously.
- **Not every activity fires a webhook.** Don't rely on webhooks for full audit coverage.
- **Attachment upload used to be missing** (issue #1482) and is now implemented via the routes exposed by `api.py`'s `uploadattachment` command. Older WeKan versions won't have it.

### If you need to help the caller obtain a token in the first place

- POST JSON (not form data — form data is documented as broken) to `/users/login`: `{"username": "...", "password": "..."}`. `email` may be substituted for `username`. Username and password are case-sensitive.
- The response contains `id`, `token`, and `tokenExpires`. Save the token; that's what goes into `WEKAN_TOKEN`.
- **LDAP/OIDC-only accounts cannot use `/users/login`.** For SSO deployments, an admin must provision a dedicated password-based service account.

## Configuration the skill expects

Read these from environment variables. Never hardcode credentials.

- `WEKAN_BASE_URL` — e.g. `https://boards.example.com`. No trailing slash, no `/api`.
- `WEKAN_TOKEN` — bearer token the caller obtained out-of-band. Reused across all scripts. Treat as a long-lived credential.
- `WEKAN_WEBHOOK_TOKEN` (optional, only for `webhook_receiver.py`) — the token WeKan is configured to send on outgoing webhooks, for receiver-side verification.

Every script in `scripts/` uses this convention. `auth.py` validates the token by fetching `/api/user` on session construction, which also populates `session.userId` for the scripts that need to default `authorId` or `owner`.

## What lives in this skill

**`references/`** — read the one that matches the task; do not preload all of them.

- `rest-api-overview.md` — endpoint tables per resource (Login, Users, Boards, Board Members, Lists, Swimlanes, Cards, Checklists, Checklist Items, Card Comments, Custom Fields, Integrations, Attachments, Admin) with JSON curl examples. **Start here for CRUD questions.**
- `api-py-cheatsheet.md` — command-by-command map of the official `api.py` CLI, which is the newest surface. **Consult when the wiki/Redoc don't cover something** (esp. attachments, admin settings, imports).
- `webhook-data.md` — outgoing webhook configuration, payload shape, activity-type catalog, receiver contract. **Consult for any event-driven feature.**
- `config-reference.md` — server env vars that affect the API (`WITH_API`, `ROOT_URL`, `MONGO_URL`, `WRITABLE_PATH`, CORS, token lifetime, attachment settings). **Consult when setting up a test instance or debugging server-side errors.**
- `wekan-mcp-ops.md` — field learnings from driving the lab's wekan-mcp servers through MCP: direct endpoint verification (session catalogs go stale after image swaps), slim-projection key names, rules-engine vocabulary + proven recipes (`addChecklistWithItems`, `addLabel`), `move_card`'s top-insert order semantics, the label-assignment workaround, custom-field upsert behavior, and the ToolHive/ghcr deploy-verify loop. **Consult when automating boards through MCP tools or verifying a deployed server.**

**`scripts/`** — runnable Python examples. Each is self-contained and reads config from environment variables. All use only the stdlib except where marked.

- `auth.py` — `WekanSession` wrapping a pre-obtained bearer token from `WEKAN_TOKEN`; validates by fetching `/api/user` on init and exposes `session.userId` for the other scripts.
- `boards_crud.py` — list, get, create (with owner + color), copy, export, delete boards; add board members with correct role.
- `lists_swimlanes_cards_crud.py` — create list + swimlane, create card, move card between lists, update fields, delete.
- `checklists_comments.py` — add checklist, add items, toggle item state, add comment.
- `webhook_receiver.py` — minimal Flask receiver that returns 200 immediately, verifies optional token, dispatches on activity type. Requires `flask`.
- `attachments.py` — list attachments on a board, upload a file to a card, download an attachment, delete. Uses `api.py`-style routes for the current WeKan version.

## How to approach a new task

1. **Match the task to a reference file** and skim it before writing code. If the task involves an endpoint not in the reference files, tell the user the reference is version-lagged and confirm the endpoint by fetching `api.py` or the relevant `models/*.js` from the pinned version tag on GitHub.
2. **Adapt the closest script in `scripts/`** rather than writing from scratch. The auth + retry pattern in `auth.py` should be copied verbatim into any new script.
3. **When the user asks for a client library** rather than raw scripts, recommend one of:
   - `bastianwenske/python-wekan` (PyPI `python-wekan`) — object-oriented, `WekanClient → Board → List → Card`, Python ≥3.9. Good default.
   - `wekan/wekan-python-api-client` — the official fork, install via git.
   - `desertbit/wego` — Go client with auto token renewal.
   - n8n's built-in **Wekan node** for no-code workflows (falls back to the HTTP Request node for uncovered ops).

   Note in the recommendation that all of these lag WeKan itself and may need to be supplemented with raw HTTP for the newest routes.
4. **When something doesn't work**, check in this order: server has `WITH_API=true`; base URL has no trailing `/api`; body is JSON not form data; the token is still valid and belongs to a user with the needed permission (401 vs 403 tells you which); endpoint exists in the pinned version's `api.py`/`models/*.js`; response body doesn't contain an embedded error despite HTTP 200.

## Local test instance

If the user wants to test without touching production, spin up a local instance with Docker. See `references/config-reference.md` for a minimal `docker-compose.yml` and the required env vars. The first registered user becomes the global admin.

## SpencersLab instances

- `wekan.spencerslab.com` — the **bot instance** (`OIDC_REDIRECTION_ENABLED=false`, so password login via `/users/login` works). Target for API scripts and MCP clients; use a dedicated password-based bot account.
- `boards.spencerslab.com` — the **human instance** (Keycloak SSO via proxy-local).
- Both releases share one MongoDB, so the data behind them is the same.
- In-lab MCP access: the `wekan-readonly` / `wekan-admin` tier servers on `mcp.<domain>` (deployed via `charts/hivetools`, image `ghcr.io/ownyourio/wekan-mcp` from `containers/wekan-mcp`) — see "Prefer the wekan MCP server when it is available" above.
- **Observed quirk**: unauthenticated `GET /api/user` returns **502** (not 401) on these instances — treat a 502-on-`/api/user` as an auth failure (missing/invalid/expired token).
