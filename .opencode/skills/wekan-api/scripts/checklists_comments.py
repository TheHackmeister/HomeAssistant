"""
Checklists, checklist items, and card comments.

Requires auth.py in the same directory.

Usage examples:
    python checklists_comments.py add-checklist <boardId> <cardId> "Acceptance criteria" \\
        --items "Write test" "Update docs" "Review with team"
    python checklists_comments.py list-checklists <boardId> <cardId>
    python checklists_comments.py add-item <boardId> <cardId> <checklistId> "New item"
    python checklists_comments.py toggle-item <boardId> <cardId> <checklistId> <itemId> --done
    python checklists_comments.py toggle-item <boardId> <cardId> <checklistId> <itemId> --undone
    python checklists_comments.py delete-checklist <boardId> <cardId> <checklistId>

    python checklists_comments.py add-comment <boardId> <cardId> "This looks good, merging."
    python checklists_comments.py list-comments <boardId> <cardId>
    python checklists_comments.py delete-comment <boardId> <cardId> <commentId>
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional

from auth import WekanError, WekanSession


# ---------- Checklists ----------

def list_checklists(s: WekanSession, board_id: str, card_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/cards/{card_id}/checklists")


def get_checklist(s: WekanSession, board_id: str, card_id: str, checklist_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}")


def add_checklist(s: WekanSession, board_id: str, card_id: str, title: str,
                  items: Optional[list] = None) -> dict:
    body: dict = {"title": title}
    if items:
        body["items"] = items
    return s.post(f"/api/boards/{board_id}/cards/{card_id}/checklists", json_body=body)


def delete_checklist(s: WekanSession, board_id: str, card_id: str, checklist_id: str) -> dict:
    return s.delete(f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}")


# ---------- Checklist items ----------

def add_item(s: WekanSession, board_id: str, card_id: str, checklist_id: str,
             title: str) -> dict:
    return s.post(
        f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}/items",
        json_body={"title": title},
    )


def get_item(s: WekanSession, board_id: str, card_id: str, checklist_id: str,
             item_id: str) -> dict:
    return s.get(
        f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}/items/{item_id}"
    )


def toggle_item(s: WekanSession, board_id: str, card_id: str, checklist_id: str,
                item_id: str, is_finished: bool) -> dict:
    return s.put(
        f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}/items/{item_id}",
        json_body={"isFinished": is_finished},
    )


def rename_item(s: WekanSession, board_id: str, card_id: str, checklist_id: str,
                item_id: str, title: str) -> dict:
    return s.put(
        f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}/items/{item_id}",
        json_body={"title": title},
    )


def delete_item(s: WekanSession, board_id: str, card_id: str, checklist_id: str,
                item_id: str) -> dict:
    return s.delete(
        f"/api/boards/{board_id}/cards/{card_id}/checklists/{checklist_id}/items/{item_id}"
    )


# ---------- Comments ----------

def list_comments(s: WekanSession, board_id: str, card_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/cards/{card_id}/comments")


def get_comment(s: WekanSession, board_id: str, card_id: str, comment_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}/cards/{card_id}/comments/{comment_id}")


def add_comment(s: WekanSession, board_id: str, card_id: str, comment: str,
                author_id: Optional[str] = None) -> dict:
    body = {
        "authorId": author_id or s.userId,
        "comment": comment,
    }
    return s.post(f"/api/boards/{board_id}/cards/{card_id}/comments", json_body=body)


def delete_comment(s: WekanSession, board_id: str, card_id: str, comment_id: str) -> dict:
    return s.delete(f"/api/boards/{board_id}/cards/{card_id}/comments/{comment_id}")


# ---------- CLI ----------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="WeKan checklists and comments")
    sub = p.add_subparsers(dest="cmd", required=True)

    x = sub.add_parser("list-checklists")
    x.add_argument("board_id"); x.add_argument("card_id")

    x = sub.add_parser("get-checklist")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")

    x = sub.add_parser("add-checklist")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("title")
    x.add_argument("--items", nargs="*", default=None)

    x = sub.add_parser("delete-checklist")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")

    x = sub.add_parser("add-item")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")
    x.add_argument("title")

    x = sub.add_parser("get-item")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")
    x.add_argument("item_id")

    x = sub.add_parser("toggle-item")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")
    x.add_argument("item_id")
    grp = x.add_mutually_exclusive_group(required=True)
    grp.add_argument("--done", action="store_true")
    grp.add_argument("--undone", action="store_true")

    x = sub.add_parser("rename-item")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")
    x.add_argument("item_id"); x.add_argument("title")

    x = sub.add_parser("delete-item")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("checklist_id")
    x.add_argument("item_id")

    x = sub.add_parser("list-comments")
    x.add_argument("board_id"); x.add_argument("card_id")

    x = sub.add_parser("get-comment")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("comment_id")

    x = sub.add_parser("add-comment")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("comment")
    x.add_argument("--author", default=None)

    x = sub.add_parser("delete-comment")
    x.add_argument("board_id"); x.add_argument("card_id"); x.add_argument("comment_id")

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        s = WekanSession()
        r = None
        if args.cmd == "list-checklists": r = list_checklists(s, args.board_id, args.card_id)
        elif args.cmd == "get-checklist": r = get_checklist(s, args.board_id, args.card_id, args.checklist_id)
        elif args.cmd == "add-checklist": r = add_checklist(s, args.board_id, args.card_id, args.title, args.items)
        elif args.cmd == "delete-checklist": r = delete_checklist(s, args.board_id, args.card_id, args.checklist_id)
        elif args.cmd == "add-item": r = add_item(s, args.board_id, args.card_id, args.checklist_id, args.title)
        elif args.cmd == "get-item": r = get_item(s, args.board_id, args.card_id, args.checklist_id, args.item_id)
        elif args.cmd == "toggle-item":
            r = toggle_item(s, args.board_id, args.card_id, args.checklist_id, args.item_id, args.done)
        elif args.cmd == "rename-item":
            r = rename_item(s, args.board_id, args.card_id, args.checklist_id, args.item_id, args.title)
        elif args.cmd == "delete-item":
            r = delete_item(s, args.board_id, args.card_id, args.checklist_id, args.item_id)
        elif args.cmd == "list-comments": r = list_comments(s, args.board_id, args.card_id)
        elif args.cmd == "get-comment": r = get_comment(s, args.board_id, args.card_id, args.comment_id)
        elif args.cmd == "add-comment": r = add_comment(s, args.board_id, args.card_id, args.comment, args.author)
        elif args.cmd == "delete-comment": r = delete_comment(s, args.board_id, args.card_id, args.comment_id)
        print(json.dumps(r, indent=2))
    except WekanError as e:
        print(f"error: {e}", file=sys.stderr)
        if e.body:
            print(f"body: {e.body}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
