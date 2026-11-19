# wekan-mcp operations — field learnings

Operational facts learned driving the lab's `wekan-mcp` deployments
(gpu `wekan-readonly`/`wekan-admin`, dev `boards`) through MCP. Distinct
from `rest-api-overview.md` (raw REST): this file is about the MCP tool
surface, the rules engine as used through `create_rule`, and the
deploy/verify loop. Evidence anchors cite the deployed WeKan v9.99 source.

## Verifying a server directly (bypass the session catalog)

Agent-session MCP catalogs are cached per connection: after a new image is
deployed, the catalog can keep showing the OLD tool surface (observed: 20
tools cached while the live server served 25). A direct JSON-RPC call is
the source of truth.

Streamable-HTTP handshake against `https://mcp.<cluster>.<domain>/<name>/mcp`
(OIDC is currently disabled on all wekan-mcp deployments — the `oidc:`
blocks are commented out, so no token is needed for this):

1. `POST` `initialize` (`Accept: application/json, text/event-stream`);
   capture the `Mcp-Session-Id` response header.
2. `POST` `notifications/initialized` with that header.
3. `POST` `tools/list` / `tools/call` with the same header.

Responses are SSE-framed — extract the JSON from the `data: {...}` line.
Tool results arrive in `result.structuredContent.result`, or as a
JSON-encoded string in `result.content[0].text` that needs a second parse;
handle both.

opencode's Code Mode runtime has no timers (`setTimeout` is unavailable) —
to wait on asynchronous server effects, poll by repeating the RPC call.

## Slim projections and key names

- MCP responses normalize WeKan's `_id` to `id` (e.g. `list_lists` returns
  `{id, title, swimlane_id}` — scripts that expect `_id` silently read
  undefined).
- `list_lists` carries no `sort` field; card ordering is the list order.
- `list_checklists` returns `{id, title}` only — use `get_checklist` for
  items.
- `get_card` includes `label_ids`, `custom_fields` (`[{id, value}]`) and
  `card_number` (since the v60 build). In `list_cards_in_list` responses
  `card_number` is null (the by-list projection strips it) — `get_card`
  when a card number is needed.

## Rules engine through `create_rule`

Verified against WeKan v9.99 (`server/rulesHelper.js`, `server/models/rules.js`):

- **Trigger**: `{activityType: createCard | moveCard | editCard |
  scheduledTrigger | button}`. Any matching field you omit (`listName`,
  `oldListName`, `swimlaneName`, `cardTitle`, `userId`) is normalized to
  `'*'` — the rule fires for any value.
- **Actions**: the create endpoint validates only the PRESENCE of
  `trigger.activityType` / `action.actionType` — there is no action
  whitelist; the vocabulary is what `rulesHelper.js` implements. Confirmed
  entries include `addChecklistWithItems` and `addLabel`/`removeLabel`
  (L400–404: `card.addLabel(action.labelId)`).
- `addChecklistWithItems` takes `{checklistName, checklistItems}` with the
  items **comma-joined** — an item containing a comma splits in two.
- **Rule execution order is unspecified** — rules matching one activity
  execute sequentially (activities.js → RulesHelper.executeRules) but
  trigger selection reads an UNSORTED Mongo cursor (reactiveCache.js), so
  which rule runs first is a lottery. A same-activity `createCard` →
  `checkItem` rule may run before the `addChecklistWithItems` insertion it
  depends on — the guarded lookup no-ops and the outcome flips
  nondeterministically (observed on the AI-Dev board). No ordering or
  priority control exists in v9.99; deterministic multi-action rules arrive
  only in WeKan v12.10+ (issue #4294). Do not build order-dependent rule
  chains on v9.99.
- **Item-added triggers are dead code** — checklist-item inserts emit
  activityType `addChecklistItem` but TriggersDef only knows
  `addedChecklistItem` (name mismatch, v9.99 through current main), so
  two-stage "check the item when it appears" rules can never fire.
- A `createCard` trigger fires for REST-created AND UI-created cards (the
  REST create route inserts the `createCard` activity), so creation-time
  automation covers both paths.
- Rules fire **asynchronously** (roughly 1–2 s after the activity) and are
  **never retroactive** — existing cards need a per-card backfill
  (`add_checklist`), the rule only covers future events.

Recipes proven on the AI-Dev board:

- **Standard checklists on every new card**: one rule per checklist,
  `trigger {activityType: "createCard"}` (no matchers) →
  `action {actionType: "addChecklistWithItems", checklistName, checklistItems}`.
- **Auto-label cards moved into a list**: `trigger {activityType:
  "moveCard", listName: "<list>"}` → `action {actionType: "addLabel",
  labelId: "<board label id>"}`. Apply it to cards already in the list by
  round-tripping them (below) — note the order side effect.

## Move semantics — `move_card` re-inserts at the TOP

`move_card` has no position argument; a moved card lands at the **top** of
the destination list. Consequences:

- A round-trip pass (list A → B → A, processing cards top-to-bottom)
  **reverses** the list order; a second identical pass restores the
  original order.
- Cards moved (or bounced back via Rework) into a pickup list outrank the
  cards already there — any "highest-sorted first" flow picks the
  most-recently-moved card first. Plan for it.

## Label assignment — no direct tool, rules-engine workaround

`update_card` covers title/description/dates only; there is no label
parameter and no label tool on the MCP surface. Workaround (proven):

1. Create the `moveCard → addLabel` rule for the target list.
2. Round-trip each card out and back (`move_card` twice).
3. Verify via `get_card` `label_ids`; run the round-trip a second time if
   the order reversal matters.

## Custom fields in practice

- `create_custom_field`: v9.99 REST create **ignores `alwaysOnCard`** —
  existing cards are NOT attached (no backfill). Pass
  `automatically_on_card=true` so future REST-created cards attach the
  field automatically.
- `set_card_custom_field` is an upsert: the dedicated value route silently
  no-ops on unattached fields, so the tool attaches-if-missing by PUTting
  the whole `customFields` array (documented read-modify-write race; fine
  for single-writer flows).
- Values are written as given — text fields take strings; number/checkbox
  coercion is not implemented.

## Deploy/verify loop (ToolHive + ghcr)

- A ToolHive `MCPServer` materializes as a **StatefulSet server pod**
  (`mcp-<name>-0`) plus a separate **proxyrunner Deployment pod**
  (`mcp-<name>-<hash>`, image `ghcr.io/stacklok/toolhive/proxyrunner`).
  Two pods per server is normal — not a duplicate/leftover.
- Mutable `:main` tag + `imagePullPolicy: Always`: a new build lands only
  when the pod is recreated, and ArgoCD recreates only on a manifest diff.
  Either pin the values to the immutable `:v<run>` tag (the lab's M-step
  sequence — the manifest diff triggers the recreation) or delete the pod
  manually for an immediate pull.
- **What is actually running**: the pod's
  `status.containerStatuses[].imageID` carries the manifest digest.
- **Tag == build, without pulling**: ghcr anonymous token flow —
  `GET https://ghcr.io/token?scope=repository:ownyourio/wekan-mcp:pull`,
  then `GET https://ghcr.io/v2/ownyourio/wekan-mcp/manifests/<ref>` with
  `Accept` listing OCI index/manifest + docker v2 types and compare
  `docker-content-digest` between the tag and `:main`.