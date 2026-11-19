"""
Lists, swimlanes, and cards CRUD.

Requires auth.py in the same directory.

Usage examples:
    python lists_swimlanes_cards_crud.py list-lists <boardId>
    python lists_swimlanes_cards_crud.py create-list <boardId> "In progress"
    python lists_swimlanes_cards_crud.py delete-list <boardId> <listId>

    python lists_swimlanes_cards_crud.py list-swimlanes <boardId>
    python lists_swimlanes_cards_crud.py create-swimlane <boardId> "Team A"

    python lists_swimlanes_cards_crud.py create-card <boardId> <listId> <swimlaneId> \\
        "Investigate flaky test" --description "..." --author <userId>
    python lists_swimlanes_cards_crud.py get-card <boardId> <cardId>
    python lists_swimlanes_cards_crud.py move-card <boardId> <fromListId> <cardId> <toListId>
    python lists_swimlanes_cards_crud.py update-card <boardId> <fromListId> <cardId> \\
        --title "New title" --description "new desc" --due 2026-08-15T17:00:00Z
    python lists_swimlanes_cards_crud.py delete-card <boardId> <listId> <cardId>

Notes:
    - `create-card` requires an author user id; defaults to the logged-in user.
    - `create-card` requires a swimlane id; get it from `list-swimlanes` (a board
      always has at least one, the default swimlane).
    - `move-card` is implemented as a PUT with the new listId in the body,
      using the CURRENT list id in the URL.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional

from auth import WekanError, WekanSession


# ---------- Lists ----------

def list_lists(s: WekanSession, board_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/lists")


def get_list(s: WekanSession, board_id: str, list_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}/lists/{list_id}")


def create_list(s: WekanSession, board_id: str, title: str) -> dict:
    return s.post(f"/api/boards/{board_id}/lists", json_body={"title": title})


def delete_list(s: WekanSession, board_id: str, list_id: str) -> dict:
    return s.delete(f"/api/boards/{board_id}/lists/{list_id}")


# ---------- Swimlanes ----------

def list_swimlanes(s: WekanSession, board_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/swimlanes")


def get_swimlane(s: WekanSession, board_id: str, swimlane_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}/swimlanes/{swimlane_id}")


def create_swimlane(s: WekanSession, board_id: str, title: str) -> dict:
    return s.post(f"/api/boards/{board_id}/swimlanes", json_body={"title": title})


def delete_swimlane(s: WekanSession, board_id: str, swimlane_id: str) -> dict:
    return s.delete(f"/api/boards/{board_id}/swimlanes/{swimlane_id}")


def cards_in_swimlane(s: WekanSession, board_id: str, swimlane_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/swimlanes/{swimlane_id}/cards")


# ---------- Cards ----------

def create_card(
    s: WekanSession, board_id: str, list_id: str, swimlane_id: str,
    title: str, description: str = "", author_id: Optional[str] = None,
    members: Optional[list] = None, assignees: Optional[list] = None,
) -> dict:
    body = {
        "title": title,
        "description": description,
        "authorId": author_id or s.userId,
        "swimlaneId": swimlane_id,
    }
    if members: body["members"] = members
    if assignees: body["assignees"] = assignees
    return s.post(f"/api/boards/{board_id}/lists/{list_id}/cards", json_body=body)


def get_card(s: WekanSession, board_id: str, card_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}/cards/{card_id}")


def get_cards_in_list(s: WekanSession, board_id: str, list_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/lists/{list_id}/cards")


def update_card(s: WekanSession, board_id: str, from_list_id: str, card_id: str,
                **fields) -> dict:
    """
    Update a card. To move it, pass listId=<toListId>. The from_list_id in the
    URL is the CURRENT list; the body's listId is the destination.
    """
    body = {k: v for k, v in fields.items() if v is not None}
    return s.put(f"/api/boards/{board_id}/lists/{from_list_id}/cards/{card_id}",
                 json_body=body)


def move_card(s: WekanSession, board_id: str, from_list_id: str, card_id: str,
              to_list_id: str, to_swimlane_id: Optional[str] = None) -> dict:
    body: dict = {"listId": to_list_id}
    if to_swimlane_id:
        body["swimlaneId"] = to_swimlane_id
    return s.put(f"/api/boards/{board_id}/lists/{from_list_id}/cards/{card_id}",
                 json_body=body)


def delete_card(s: WekanSession, board_id: str, list_id: str, card_id: str) -> dict:
    return s.delete(f"/api/boards/{board_id}/lists/{list_id}/cards/{card_id}")


# ---------- CLI ----------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="WeKan lists/swimlanes/cards CRUD")
    sub = p.add_subparsers(dest="cmd", required=True)

    # lists
    x = sub.add_parser("list-lists"); x.add_argument("board_id")
    x = sub.add_parser("get-list"); x.add_argument("board_id"); x.add_argument("list_id")
    x = sub.add_parser("create-list"); x.add_argument("board_id"); x.add_argument("title")
    x = sub.add_parser("delete-list"); x.add_argument("board_id"); x.add_argument("list_id")

    # swimlanes
    x = sub.add_parser("list-swimlanes"); x.add_argument("board_id")
    x = sub.add_parser("get-swimlane"); x.add_argument("board_id"); x.add_argument("swimlane_id")
    x = sub.add_parser("create-swimlane"); x.add_argument("board_id"); x.add_argument("title")
    x = sub.add_parser("delete-swimlane"); x.add_argument("board_id"); x.add_argument("swimlane_id")
    x = sub.add_parser("swimlane-cards"); x.add_argument("board_id"); x.add_argument("swimlane_id")

    # cards
    c = sub.add_parser("create-card")
    c.add_argument("board_id"); c.add_argument("list_id"); c.add_argument("swimlane_id")
    c.add_argument("title")
    c.add_argument("--description", default="")
    c.add_argument("--author", default=None)
    c.add_argument("--members", nargs="*", default=None)
    c.add_argument("--assignees", nargs="*", default=None)

    x = sub.add_parser("get-card"); x.add_argument("board_id"); x.add_argument("card_id")

    x = sub.add_parser("list-cards"); x.add_argument("board_id"); x.add_argument("list_id")

    m = sub.add_parser("move-card")
    m.add_argument("board_id"); m.add_argument("from_list_id"); m.add_argument("card_id")
    m.add_argument("to_list_id")
    m.add_argument("--to-swimlane", default=None)

    u = sub.add_parser("update-card")
    u.add_argument("board_id"); u.add_argument("from_list_id"); u.add_argument("card_id")
    u.add_argument("--title"); u.add_argument("--description")
    u.add_argument("--due", help="ISO 8601 datetime, e.g. 2026-08-15T17:00:00Z")
    u.add_argument("--start"); u.add_argument("--end")

    x = sub.add_parser("delete-card")
    x.add_argument("board_id"); x.add_argument("list_id"); x.add_argument("card_id")

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        s = WekanSession()
        r = None
        if args.cmd == "list-lists": r = list_lists(s, args.board_id)
        elif args.cmd == "get-list": r = get_list(s, args.board_id, args.list_id)
        elif args.cmd == "create-list": r = create_list(s, args.board_id, args.title)
        elif args.cmd == "delete-list": r = delete_list(s, args.board_id, args.list_id)
        elif args.cmd == "list-swimlanes": r = list_swimlanes(s, args.board_id)
        elif args.cmd == "get-swimlane": r = get_swimlane(s, args.board_id, args.swimlane_id)
        elif args.cmd == "create-swimlane": r = create_swimlane(s, args.board_id, args.title)
        elif args.cmd == "delete-swimlane": r = delete_swimlane(s, args.board_id, args.swimlane_id)
        elif args.cmd == "swimlane-cards": r = cards_in_swimlane(s, args.board_id, args.swimlane_id)
        elif args.cmd == "create-card":
            r = create_card(s, args.board_id, args.list_id, args.swimlane_id,
                            args.title, args.description, args.author,
                            args.members, args.assignees)
        elif args.cmd == "get-card": r = get_card(s, args.board_id, args.card_id)
        elif args.cmd == "list-cards": r = get_cards_in_list(s, args.board_id, args.list_id)
        elif args.cmd == "move-card":
            r = move_card(s, args.board_id, args.from_list_id, args.card_id,
                          args.to_list_id, args.to_swimlane)
        elif args.cmd == "update-card":
            r = update_card(s, args.board_id, args.from_list_id, args.card_id,
                            title=args.title, description=args.description,
                            dueAt=args.due, startAt=args.start, endAt=args.end)
        elif args.cmd == "delete-card":
            r = delete_card(s, args.board_id, args.list_id, args.card_id)
        print(json.dumps(r, indent=2))
    except WekanError as e:
        print(f"error: {e}", file=sys.stderr)
        if e.body:
            print(f"body: {e.body}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
