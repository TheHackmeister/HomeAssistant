"""
Board CRUD operations against WeKan.

Requires auth.py in the same directory.

Usage examples:
    python boards_crud.py list
    python boards_crud.py get <boardId>
    python boards_crud.py create "Q4 Roadmap" --color belize
    python boards_crud.py export <boardId> board.json
    python boards_crud.py copy <boardId>
    python boards_crud.py add-member <boardId> <userId> --admin
    python boards_crud.py set-role <boardId> <userId> --admin
    python boards_crud.py add-label <boardId> --name urgent --color red
    python boards_crud.py delete <boardId>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from auth import WekanError, WekanSession


VALID_COLORS = {
    "belize", "nephritis", "pomegranate", "pumpkin", "wisteria", "midnight",
    "moderatepink", "strongcyan", "limegreen", "dark", "relax", "corteza",
    "clearblue", "natural",
}

VALID_LABEL_COLORS = {
    "green", "yellow", "orange", "red", "purple", "blue", "sky", "lime",
    "pink", "black", "silver", "peachpuff", "crimson", "plum", "darkgreen",
    "slateblue", "magenta", "gold", "navy", "gray", "saddlebrown",
    "paleturquoise", "mistyrose", "indigo",
}


def list_boards(s: WekanSession) -> list:
    """Boards the current user is a member of."""
    return s.get(f"/api/users/{s.userId}/boards")


def get_board(s: WekanSession, board_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}")


def create_board(s: WekanSession, title: str, owner: str | None = None,
                 permission: str = "private", color: str = "belize") -> dict:
    if color not in VALID_COLORS:
        print(f"warning: color '{color}' not in known set {sorted(VALID_COLORS)}", file=sys.stderr)
    owner = owner or s.userId
    body = {
        "title": title,
        "owner": owner,
        "isAdmin": True,
        "isActive": True,
        "isNoComments": False,
        "isCommentOnly": False,
        "permission": permission,
        "color": color,
    }
    return s.post("/api/boards", json_body=body)


def copy_board(s: WekanSession, board_id: str) -> dict:
    return s.post(f"/api/boards/{board_id}/copy", json_body={})


def export_board(s: WekanSession, board_id: str, out_path: Path) -> None:
    data = s.get(f"/api/boards/{board_id}/export")
    out_path.write_text(json.dumps(data, indent=2))


def delete_board(s: WekanSession, board_id: str) -> dict:
    return s.delete(f"/api/boards/{board_id}")


def add_member(s: WekanSession, board_id: str, user_id: str, is_admin: bool = False) -> dict:
    """
    Add a user to a board. Then, if is_admin=True, promote them via the
    role endpoint - because the `isAdmin: true` field on the add endpoint
    is IGNORED by WeKan (known bug).
    """
    added = s.post(f"/api/boards/{board_id}/members/{user_id}/add", json_body={})
    if is_admin:
        set_role(s, board_id, user_id, is_admin=True)
    return added


def remove_member(s: WekanSession, board_id: str, user_id: str) -> dict:
    return s.post(f"/api/boards/{board_id}/members/{user_id}/remove", json_body={})


def set_role(s: WekanSession, board_id: str, user_id: str,
             is_admin: bool = False, is_no_comments: bool = False,
             is_comment_only: bool = False, is_worker: bool = False) -> dict:
    body = {
        "isAdmin": is_admin,
        "isNoComments": is_no_comments,
        "isCommentOnly": is_comment_only,
        "isWorker": is_worker,
    }
    return s.post(f"/api/boards/{board_id}/members/{user_id}", json_body=body)


def add_label(s: WekanSession, board_id: str, name: str, color: str) -> dict:
    if color not in VALID_LABEL_COLORS:
        print(f"warning: label color '{color}' not in known set {sorted(VALID_LABEL_COLORS)}", file=sys.stderr)
    return s.put(f"/api/boards/{board_id}/labels",
                 json_body={"label": {"name": name, "color": color}})


def cards_count(s: WekanSession, board_id: str) -> dict:
    return s.get(f"/api/boards/{board_id}/cards_count")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="WeKan board CRUD")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list boards for the current user")

    g = sub.add_parser("get"); g.add_argument("board_id")

    c = sub.add_parser("create")
    c.add_argument("title")
    c.add_argument("--owner", default=None, help="userId; defaults to logged-in user")
    c.add_argument("--permission", default="private", choices=["private", "public"])
    c.add_argument("--color", default="belize")

    cp = sub.add_parser("copy"); cp.add_argument("board_id")

    ex = sub.add_parser("export")
    ex.add_argument("board_id"); ex.add_argument("out_path")

    d = sub.add_parser("delete"); d.add_argument("board_id")

    am = sub.add_parser("add-member")
    am.add_argument("board_id"); am.add_argument("user_id")
    am.add_argument("--admin", action="store_true")

    rm = sub.add_parser("remove-member")
    rm.add_argument("board_id"); rm.add_argument("user_id")

    sr = sub.add_parser("set-role")
    sr.add_argument("board_id"); sr.add_argument("user_id")
    sr.add_argument("--admin", action="store_true")
    sr.add_argument("--no-comments", action="store_true")
    sr.add_argument("--comment-only", action="store_true")
    sr.add_argument("--worker", action="store_true")

    al = sub.add_parser("add-label")
    al.add_argument("board_id")
    al.add_argument("--name", required=True); al.add_argument("--color", required=True)

    cc = sub.add_parser("count"); cc.add_argument("board_id")

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        s = WekanSession()
        if args.cmd == "list":
            print(json.dumps(list_boards(s), indent=2))
        elif args.cmd == "get":
            print(json.dumps(get_board(s, args.board_id), indent=2))
        elif args.cmd == "create":
            print(json.dumps(create_board(s, args.title, args.owner, args.permission, args.color), indent=2))
        elif args.cmd == "copy":
            print(json.dumps(copy_board(s, args.board_id), indent=2))
        elif args.cmd == "export":
            export_board(s, args.board_id, Path(args.out_path))
            print(f"wrote {args.out_path}")
        elif args.cmd == "delete":
            print(json.dumps(delete_board(s, args.board_id), indent=2))
        elif args.cmd == "add-member":
            print(json.dumps(add_member(s, args.board_id, args.user_id, args.admin), indent=2))
        elif args.cmd == "remove-member":
            print(json.dumps(remove_member(s, args.board_id, args.user_id), indent=2))
        elif args.cmd == "set-role":
            print(json.dumps(set_role(
                s, args.board_id, args.user_id,
                args.admin, args.no_comments, args.comment_only, args.worker
            ), indent=2))
        elif args.cmd == "add-label":
            print(json.dumps(add_label(s, args.board_id, args.name, args.color), indent=2))
        elif args.cmd == "count":
            print(json.dumps(cards_count(s, args.board_id), indent=2))
    except WekanError as e:
        print(f"error: {e}", file=sys.stderr)
        if e.body:
            print(f"body: {e.body}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
