from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from app.config import DATA_DIR


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_conv(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "title": row["title"],
        "model": row["model"],
        "image_mode": bool(row["image_mode"]) if "image_mode" in keys else False,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_msg(row: sqlite3.Row) -> dict[str, Any]:
    attachments = []
    if row["attachments"]:
        try:
            attachments = json.loads(row["attachments"])
        except json.JSONDecodeError:
            attachments = []
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "role": row["role"],
        "content": row["content"] or "",
        "thinking": row["thinking"] or "",
        "attachments": attachments,
        "created_at": row["created_at"],
    }


class Store:
    def __init__(self, db_path: Optional[Path] = None):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path or (DATA_DIR / "app.db")
        self.uploads_root = DATA_DIR / "uploads"
        self.uploads_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT 'New chat',
                    model TEXT NOT NULL DEFAULT '',
                    image_mode INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    thinking TEXT NOT NULL DEFAULT '',
                    attachments TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );
                CREATE INDEX IF NOT EXISTS idx_messages_conv
                    ON messages(conversation_id, created_at);
                """
            )
            cols = {
                r[1]
                for r in self._conn.execute("PRAGMA table_info(conversations)").fetchall()
            }
            if "image_mode" not in cols:
                self._conn.execute(
                    "ALTER TABLE conversations ADD COLUMN image_mode INTEGER NOT NULL DEFAULT 0"
                )
                self._conn.execute(
                    """
                    UPDATE conversations SET image_mode = 1
                    WHERE id IN (
                        SELECT DISTINCT conversation_id FROM messages
                        WHERE role = 'assistant'
                          AND attachments LIKE '%"kind": "image"%'
                    )
                    """
                )
            self._conn.commit()

    def list_conversations(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM conversations ORDER BY updated_at DESC"
            ).fetchall()
        return [_row_to_conv(r) for r in rows]

    def create_conversation(self, model: str, image_mode: bool = False) -> dict[str, Any]:
        now = _now()
        conv_id = str(uuid.uuid4())
        with self._lock:
            self._conn.execute(
                "INSERT INTO conversations (id, title, model, image_mode, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (conv_id, "New chat", model, 1 if image_mode else 0, now, now),
            )
            self._conn.commit()
        (self.uploads_root / conv_id).mkdir(parents=True, exist_ok=True)
        return {
            "id": conv_id,
            "title": "New chat",
            "model": model,
            "image_mode": bool(image_mode),
            "created_at": now,
            "updated_at": now,
        }

    def get_conversation(self, conv_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM conversations WHERE id = ?", (conv_id,)
            ).fetchone()
        if not row:
            return None
        return _row_to_conv(row)

    def get_conversation_with_messages(self, conv_id: str) -> Optional[dict[str, Any]]:
        conv = self.get_conversation(conv_id)
        if not conv:
            return None
        conv["messages"] = self.list_messages(conv_id)
        return conv

    def patch_conversation(
        self,
        conv_id: str,
        *,
        title: Optional[str] = None,
        model: Optional[str] = None,
        image_mode: Optional[bool] = None,
    ) -> Optional[dict[str, Any]]:
        conv = self.get_conversation(conv_id)
        if not conv:
            return None
        bump = False
        if title is not None:
            conv["title"] = title
            bump = True
        if model is not None:
            conv["model"] = model
            bump = True
        if image_mode is not None:
            conv["image_mode"] = bool(image_mode)
        if bump:
            conv["updated_at"] = _now()
        with self._lock:
            self._conn.execute(
                "UPDATE conversations SET title = ?, model = ?, image_mode = ?, updated_at = ? WHERE id = ?",
                (
                    conv["title"],
                    conv["model"],
                    1 if conv["image_mode"] else 0,
                    conv["updated_at"],
                    conv_id,
                ),
            )
            self._conn.commit()
        return conv

    def touch(self, conv_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (_now(), conv_id),
            )
            self._conn.commit()

    def delete_conversation(self, conv_id: str) -> bool:
        conv = self.get_conversation(conv_id)
        if not conv:
            return False
        with self._lock:
            self._conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
            self._conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
            self._conn.commit()
        upload_dir = self.uploads_root / conv_id
        if upload_dir.exists():
            shutil.rmtree(upload_dir, ignore_errors=True)
        return True

    def list_messages(self, conv_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
                (conv_id,),
            ).fetchall()
        return [_row_to_msg(r) for r in rows]

    def add_message(
        self,
        conv_id: str,
        role: str,
        content: str,
        thinking: str = "",
        attachments: Optional[List[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        msg_id = str(uuid.uuid4())
        now = _now()
        payload = json.dumps(attachments or [])
        with self._lock:
            self._conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, thinking, attachments, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (msg_id, conv_id, role, content, thinking, payload, now),
            )
            self._conn.commit()
        self.touch(conv_id)
        return {
            "id": msg_id,
            "conversation_id": conv_id,
            "role": role,
            "content": content,
            "thinking": thinking,
            "attachments": attachments or [],
            "created_at": now,
        }

    def maybe_set_title(self, conv_id: str, user_text: str, attachments: list[dict]) -> Optional[str]:
        conv = self.get_conversation(conv_id)
        if not conv or conv["title"] != "New chat":
            return None
        text = (user_text or "").strip().split("\n")[0]
        if text.startswith("<attachment"):
            text = ""
        if not text and attachments:
            text = attachments[0].get("filename") or "Untitled"
        title = (text or "New chat")[:60]
        self.patch_conversation(conv_id, title=title)
        return title

    def save_upload(self, conv_id: str, filename: str, data: bytes) -> Path:
        folder = self.uploads_root / conv_id
        folder.mkdir(parents=True, exist_ok=True)
        safe = Path(filename).name.replace("\x00", "")
        if not safe or safe in {".", ".."}:
            safe = "file"
        dest = folder / safe
        stem, suffix = dest.stem, dest.suffix
        n = 1
        while dest.exists():
            dest = folder / f"{stem}_{n}{suffix}"
            n += 1
        dest.write_bytes(data)
        return dest

    def upload_path(self, conv_id: str, filename: str) -> Optional[Path]:
        folder = (self.uploads_root / conv_id).resolve()
        candidate = (folder / Path(filename).name).resolve()
        if folder not in candidate.parents and candidate != folder:
            return None
        if not candidate.is_file():
            return None
        return candidate
