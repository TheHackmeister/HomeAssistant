# WeKan Outgoing Webhooks

Everything needed to consume WeKan's outgoing webhooks: configuration, delivery contract, payload shape, and the activity-type catalog.

## Configuration paths

Three ways to configure outgoing webhooks:

1. **Per board via the UI** — Board hamburger menu → *Outgoing Webhooks*. Fields: URL, optional token (shared secret), name, optional activity filter.
2. **Globally via server env** — set `Global_Webhook_URL` (or the admin panel "Global Webhooks" setting). All boards fire to that URL.
3. **Per board via the REST API** — `POST /api/boards/:boardId/integrations` (see `rest-api-overview.md`). Programmatic setup for CI/scripts.

## Delivery contract

- **Transport**: HTTP POST, `Content-Type: application/json`.
- **Compatibility**: designed to look like Slack / Rocket.Chat / Discord incoming-webhook payloads. Every payload includes a human-readable `text` field alongside structured fields.
- **Discord**: append `/slack` to the Discord webhook URL — Discord's Slack-compatible endpoint accepts WeKan's payload as-is.
- **Receiver requirement**: **respond `200 OK` immediately** (issue #5077). WeKan's activity processing stalls if the endpoint blocks. Do the actual work asynchronously (background job, queue, worker thread).
- **No retry / no delivery guarantee.** If your receiver is down or slow, the event is lost. Don't rely on webhooks for full audit coverage.
- **Not every activity fires a webhook** — the covered set has grown over time and there are still known gaps.
- **Token verification** — if you set a token on the integration, WeKan sends it in the payload (typically in the body). Compare it in your receiver before acting.

## Payload shape

Every payload has at least:

- `text` — human-readable summary (Slack-style).
- `description` — the activity type, e.g. `"act-moveCard"`, `"act-createCard"`. This is your primary dispatch field.
- Structured fields specific to the activity type.

### Example: card moved

```json
{
  "text": "Alice moved *Investigate flaky test* from *To do* to *In progress*",
  "cardId": "abc123",
  "listId": "listInProgress",
  "oldListId": "listToDo",
  "boardId": "boardXYZ",
  "user": "alice",
  "card": "Investigate flaky test",
  "description": "act-moveCard"
}
```

### Example: card created

```json
{
  "text": "Alice created card *Investigate flaky test*",
  "cardId": "abc123",
  "listId": "listInProgress",
  "boardId": "boardXYZ",
  "user": "alice",
  "card": "Investigate flaky test",
  "description": "act-createCard"
}
```

### Example: comment added

```json
{
  "text": "Alice commented on *Investigate flaky test*: could not reproduce",
  "cardId": "abc123",
  "listId": "listInProgress",
  "boardId": "boardXYZ",
  "user": "alice",
  "card": "Investigate flaky test",
  "comment": "could not reproduce",
  "commentId": "cmt789",
  "description": "act-addComment"
}
```

### Example: description changed (newer versions)

Recent WeKan versions include before/after values for description edits:

```json
{
  "text": "Alice edited description of *Investigate flaky test*",
  "cardId": "abc123",
  "boardId": "boardXYZ",
  "user": "alice",
  "oldValue": "Old description...",
  "value": "New description...",
  "description": "act-editCardDescription"
}
```

## Activity types (partial catalog)

The set has grown over versions. Verify by inspecting `models/activities.js` in your pinned version, or by triggering the event and watching the payload.

Common activity types:

| Activity | Fired when |
|---|---|
| `act-createBoard` | Board created |
| `act-createList` | List created |
| `act-createSwimlane` | Swimlane created |
| `act-createCard` | Card created |
| `act-moveCard` | Card moved between lists |
| `act-archivedCard` | Card archived |
| `act-restoredCard` | Card restored from archive |
| `act-editCardTitle` | Card title changed |
| `act-editCardDescription` | Card description changed |
| `act-editCardDueAt` / `act-editCardStartAt` / `act-editCardEndAt` | Date fields changed |
| `act-addComment` | Comment added to card |
| `act-editComment` | Comment edited |
| `act-deleteComment` | Comment deleted |
| `act-addChecklist` | Checklist added |
| `act-removeChecklist` | Checklist removed |
| `act-checkedItem` / `act-uncheckedItem` | Checklist item toggled |
| `act-addChecklistItem` / `act-removedChecklistItem` | Checklist item added/removed |
| `act-addAttachment` | Attachment added |
| `act-deleteAttachment` | Attachment removed |
| `act-addLabel` / `act-removeLabel` | Label toggled on card |
| `act-joinMember` / `act-unjoinMember` | Member added/removed on card |
| `act-createCustomField` | Custom field created on board |
| `act-setCustomField` | Custom field value set on card |

`act-` events are the outgoing webhook description strings. `models/activities.js` holds the current list.

## Server-side controls

Environment variables that shape webhook behavior:

- `Global_Webhook_URL` — one URL for all boards; complements per-board integrations.
- `CARD_OPENED_WEBHOOK_ENABLED` — toggles firing when a card is opened (off by default).
- `WEBHOOKS_ATTRIBUTES` — limit or expand the set of fields included in payloads. Snap example: `webhooks-attributes=cardId,listId,oldListId,boardId,comment,user,card,commentId`. Use to reduce noise or add fields.

## Receiver design patterns

### Minimal Flask receiver

Return 200 immediately, enqueue work.

```python
from flask import Flask, request, jsonify
import queue, threading, os

app = Flask(__name__)
work = queue.Queue()
SECRET = os.environ.get("WEKAN_WEBHOOK_TOKEN")

def worker():
    while True:
        event = work.get()
        try:
            handle(event)
        except Exception as e:
            print("handler error:", e)
        finally:
            work.task_done()

threading.Thread(target=worker, daemon=True).start()

@app.route("/wekan", methods=["POST"])
def receive():
    payload = request.get_json(silent=True) or {}
    if SECRET and payload.get("token") != SECRET:
        return "", 401
    work.put(payload)
    return jsonify(ok=True), 200

def handle(event):
    activity = event.get("description", "")
    if activity == "act-createCard":
        ...
    elif activity == "act-moveCard":
        ...
```

### Local testing

- Use **ngrok**, **smee.io**, or **cloudflared** to give your local receiver a public URL.
- Register the tunnel URL as the outgoing webhook on a test board.
- Trigger events by clicking around in the WeKan UI.

### Bidirectional (experimental)

An experimental "two-way webhook" that acts on returned payloads exists as PR #2665. Do not build production flows on it — treat it as a research prototype.

### What webhooks can't do

- Guarantee delivery.
- Cover every mutation (some activities don't fire yet).
- Deliver in strict order under load.

For any of the above, poll the REST API on an interval and reconcile against your own state.
