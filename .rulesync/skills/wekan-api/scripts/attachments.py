"""
Attachment operations.

Requires auth.py in the same directory.

Historical note: attachment upload over REST was missing for a long time
(issue #1482) and is now implemented via the routes wrapped by `api.py`.
The exact route paths vary by WeKan version - if any of these calls fails
with 404, check `models/attachments.js` and `api.py` for the pinned version
and update the paths below.

Usage examples:
    python attachments.py list-board <boardId>
    python attachments.py list-card <boardId> <swimlaneId> <listId> <cardId>
    python attachments.py info <attachmentId>
    python attachments.py upload <boardId> <swimlaneId> <listId> <cardId> ./spec.pdf
    python attachments.py upload <boardId> <swimlaneId> <listId> <cardId> ./spec.pdf --backend s3
    python attachments.py download <attachmentId> ./spec.pdf
    python attachments.py delete <attachmentId>

    python attachments.py upload-bg <boardId> ./bg.png
    python attachments.py download-bg <boardId> ./bg.png
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import urllib.request
import uuid
from pathlib import Path
from typing import Optional

from auth import WekanError, WekanSession


def list_board_attachments(s: WekanSession, board_id: str) -> list:
    return s.get(f"/api/boards/{board_id}/attachments")


def list_card_attachments(s: WekanSession, board_id: str, swimlane_id: str,
                          list_id: str, card_id: str) -> list:
    # Path shape drawn from api.py's listcardattachments; verify against your version.
    return s.get(
        f"/api/boards/{board_id}/swimlanes/{swimlane_id}"
        f"/lists/{list_id}/cards/{card_id}/attachments"
    )


def attachment_info(s: WekanSession, attachment_id: str) -> dict:
    return s.get(f"/api/attachments/{attachment_id}")


def upload_attachment(
    s: WekanSession, board_id: str, swimlane_id: str, list_id: str, card_id: str,
    file_path: Path, storage_backend: Optional[str] = None,
) -> dict:
    """
    Upload as multipart/form-data. Only endpoint in this file that does not use
    the standard JSON helper.
    """
    if not file_path.exists():
        raise WekanError(f"file not found: {file_path}")
    boundary = f"----wekan-{uuid.uuid4().hex}"
    mime, _ = mimetypes.guess_type(file_path.name)
    mime = mime or "application/octet-stream"
    body_bytes = _build_multipart(
        boundary,
        [("file", file_path.name, mime, file_path.read_bytes())],
        {"storage": storage_backend} if storage_backend else {},
    )
    url = (
        f"{s.base_url}/api/boards/{board_id}/swimlanes/{swimlane_id}"
        f"/lists/{list_id}/cards/{card_id}/attachments"
    )
    req = urllib.request.Request(
        url,
        data=body_bytes,
        method="POST",
        headers={
            "Authorization": f"Bearer {s.token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raise WekanError(f"upload failed ({e.code})", status=e.code, body=e.read())
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw.decode("utf-8", errors="replace")}


def _build_multipart(boundary: str, files: list, fields: dict) -> bytes:
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        parts.append(str(value).encode() + b"\r\n")
    for field_name, filename, mime, content in files:
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode()
        )
        parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
        parts.append(content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts)


def download_attachment(s: WekanSession, attachment_id: str, out_path: Path) -> None:
    """
    Downloads follow the `urlDownload` returned by the board-attachments list.
    We resolve it via /api/attachments/:id first, then GET the CDN URL with
    the same bearer token.
    """
    info = attachment_info(s, attachment_id)
    url = None
    if isinstance(info, dict):
        url = info.get("urlDownload") or info.get("url")
    if not url:
        raise WekanError(f"could not resolve download URL for {attachment_id}", body=info)

    # If urlDownload is a path (starts with /), prepend base_url.
    if url.startswith("/"):
        url = f"{s.base_url}{url}"

    req = urllib.request.Request(
        url, method="GET",
        headers={"Authorization": f"Bearer {s.token}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        out_path.write_bytes(resp.read())


def delete_attachment(s: WekanSession, attachment_id: str) -> dict:
    return s.delete(f"/api/attachments/{attachment_id}")


def upload_background(s: WekanSession, board_id: str, file_path: Path) -> dict:
    if not file_path.exists():
        raise WekanError(f"file not found: {file_path}")
    boundary = f"----wekan-{uuid.uuid4().hex}"
    mime, _ = mimetypes.guess_type(file_path.name)
    mime = mime or "application/octet-stream"
    body_bytes = _build_multipart(
        boundary,
        [("file", file_path.name, mime, file_path.read_bytes())],
        {},
    )
    url = f"{s.base_url}/api/boards/{board_id}/background"
    req = urllib.request.Request(
        url,
        data=body_bytes,
        method="POST",
        headers={
            "Authorization": f"Bearer {s.token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def download_background(s: WekanSession, board_id: str, out_path: Path) -> None:
    req = urllib.request.Request(
        f"{s.base_url}/api/boards/{board_id}/background",
        method="GET",
        headers={"Authorization": f"Bearer {s.token}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        out_path.write_bytes(resp.read())


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="WeKan attachments")
    sub = p.add_subparsers(dest="cmd", required=True)

    x = sub.add_parser("list-board"); x.add_argument("board_id")

    x = sub.add_parser("list-card")
    x.add_argument("board_id"); x.add_argument("swimlane_id")
    x.add_argument("list_id"); x.add_argument("card_id")

    x = sub.add_parser("info"); x.add_argument("attachment_id")

    x = sub.add_parser("upload")
    x.add_argument("board_id"); x.add_argument("swimlane_id")
    x.add_argument("list_id"); x.add_argument("card_id"); x.add_argument("file_path")
    x.add_argument("--backend", choices=["fs", "gridfs", "s3"], default=None,
                   help="Server-side storage backend to use (must be configured)")

    x = sub.add_parser("download")
    x.add_argument("attachment_id"); x.add_argument("out_path")

    x = sub.add_parser("delete"); x.add_argument("attachment_id")

    x = sub.add_parser("upload-bg"); x.add_argument("board_id"); x.add_argument("file_path")
    x = sub.add_parser("download-bg"); x.add_argument("board_id"); x.add_argument("out_path")

    return p


def main() -> int:
    args = build_parser().parse_args()
    try:
        s = WekanSession()
        r = None
        if args.cmd == "list-board":
            r = list_board_attachments(s, args.board_id)
        elif args.cmd == "list-card":
            r = list_card_attachments(s, args.board_id, args.swimlane_id,
                                      args.list_id, args.card_id)
        elif args.cmd == "info":
            r = attachment_info(s, args.attachment_id)
        elif args.cmd == "upload":
            r = upload_attachment(s, args.board_id, args.swimlane_id,
                                  args.list_id, args.card_id,
                                  Path(args.file_path), args.backend)
        elif args.cmd == "download":
            download_attachment(s, args.attachment_id, Path(args.out_path))
            r = {"wrote": args.out_path}
        elif args.cmd == "delete":
            r = delete_attachment(s, args.attachment_id)
        elif args.cmd == "upload-bg":
            r = upload_background(s, args.board_id, Path(args.file_path))
        elif args.cmd == "download-bg":
            download_background(s, args.board_id, Path(args.out_path))
            r = {"wrote": args.out_path}
        print(json.dumps(r, indent=2, default=str))
    except WekanError as e:
        print(f"error: {e}", file=sys.stderr)
        if e.body:
            print(f"body: {e.body}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
