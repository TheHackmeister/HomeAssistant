"""
Minimal Flask receiver for WeKan outgoing webhooks.

Design constraints, per the WeKan webhook contract:
    - Return 200 OK IMMEDIATELY, or WeKan's activity processing stalls.
      Do actual work asynchronously.
    - No retries: if the receiver is down or slow, events are lost.
    - Not every WeKan activity fires a webhook.

Environment variables:
    WEKAN_WEBHOOK_TOKEN   optional shared secret. If set, this receiver rejects
                          payloads whose `token` field doesn't match.
    PORT                  listen port (default 8000)

Install:
    pip install flask

Run:
    python webhook_receiver.py

Register the tunnel URL (ngrok/smee/cloudflared) as an outgoing webhook on your
WeKan board, and paste WEKAN_WEBHOOK_TOKEN as the integration's token.

Extend `handle(event)` for your dispatch logic. See references/webhook-data.md
for the activity-type catalog.
"""

from __future__ import annotations

import json
import os
import queue
import threading
import traceback
from typing import Any

try:
    from flask import Flask, request, jsonify
except ImportError:
    raise SystemExit(
        "flask is required. Install it with: pip install flask"
    )


PORT = int(os.environ.get("PORT", "8000"))
SECRET = os.environ.get("WEKAN_WEBHOOK_TOKEN")

app = Flask(__name__)
_work: "queue.Queue[dict]" = queue.Queue(maxsize=10_000)
_dropped_lock = threading.Lock()
_dropped_events = 0


def _worker() -> None:
    while True:
        event = _work.get()
        try:
            handle(event)
        except Exception:
            traceback.print_exc()
        finally:
            _work.task_done()


def handle(event: dict) -> None:
    """
    Dispatch on `description` (the activity type).

    Extend this with your own logic. Keep it idempotent - WeKan won't retry,
    but you might replay old payloads during debugging.
    """
    activity = event.get("description", "")
    who = event.get("user")
    card = event.get("card")
    board = event.get("boardId")
    text = event.get("text", "")

    if activity == "act-createCard":
        print(f"[create] {who} created '{card}' on board {board}")
    elif activity == "act-moveCard":
        print(f"[move]   {who} moved '{card}' from {event.get('oldListId')} "
              f"to {event.get('listId')}")
    elif activity == "act-addComment":
        print(f"[cmt]    {who} on '{card}': {event.get('comment')}")
    elif activity == "act-checkedItem":
        print(f"[check]  {who} checked an item on '{card}'")
    elif activity == "act-uncheckedItem":
        print(f"[uncheck] {who} unchecked an item on '{card}'")
    elif activity == "act-archivedCard":
        print(f"[arch]   {who} archived '{card}'")
    elif activity == "act-editCardDescription":
        print(f"[desc]   {who} edited description on '{card}'")
    else:
        # Unknown / unhandled activity - log the text field for humans.
        print(f"[?]      {activity or '(no description)'}: {text}")


@app.route("/wekan", methods=["POST"])
def receive():
    payload: Any = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify(ok=False, reason="expected JSON object"), 400

    if SECRET and payload.get("token") != SECRET:
        # Don't leak whether we require a token or what it is.
        return jsonify(ok=False), 401

    try:
        _work.put_nowait(payload)
    except queue.Full:
        # Backpressure: keep returning 200 so WeKan doesn't stall or retry,
        # but count the drop so /health makes the loss visible to operators.
        global _dropped_events
        with _dropped_lock:
            _dropped_events += 1
        print("WARN: work queue full, dropping event")

    # ALWAYS return 200 quickly.
    return jsonify(ok=True), 200


@app.route("/health", methods=["GET"])
def health():
    with _dropped_lock:
        dropped = _dropped_events
    return jsonify(ok=True, queue_size=_work.qsize(), dropped_events=dropped), 200


def main() -> None:
    threading.Thread(target=_worker, daemon=True).start()
    print(f"listening on 0.0.0.0:{PORT}/wekan"
          f"{' (token-verified)' if SECRET else ' (no token verification)'}")
    # For production, put this behind gunicorn or similar.
    app.run(host="0.0.0.0", port=PORT)


if __name__ == "__main__":
    main()
