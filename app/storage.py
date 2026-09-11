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


def _safe_basename(filename: str) -> str:
    safe = Path(filename).name.replace("\x00", "")
    if not safe or safe in {".", ".."}:
        return "file"
    return safe


def _row_to_conv(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "title": row["title"],
        "model": row["model"],
        "image_mode": bool(row["image_mode"]) if "image_mode" in keys else False,
        "project_id": row["project_id"] if "project_id" in keys else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_project(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "instructions": row["instructions"] or "",
        "memory": row["memory"] or "",
        "memory_updated_at": row["memory_updated_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_project_file(row: sqlite3.Row, *, include_text: bool = False) -> dict[str, Any]:
    data = {
        "id": row["id"],
        "project_id": row["project_id"],
        "filename": row["filename"],
        "size_bytes": row["size_bytes"],
        "warning": row["warning"] or None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "extracted_chars": len(row["extracted_text"] or ""),
    }
    if include_text:
        data["extracted_text"] = row["extracted_text"] or ""
    return data


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
        self.projects_root = DATA_DIR / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
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
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    instructions TEXT NOT NULL DEFAULT '',
                    memory TEXT NOT NULL DEFAULT '',
                    memory_updated_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS project_files (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    extracted_text TEXT NOT NULL DEFAULT '',
                    warning TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(project_id, filename),
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                );
                CREATE INDEX IF NOT EXISTS idx_project_files
                    ON project_files(project_id, filename);
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
            if "project_id" not in cols:
                self._conn.execute(
                    "ALTER TABLE conversations ADD COLUMN project_id TEXT"
                )
            self._conn.commit()

    def list_conversations(self, project_id: Optional[str] = None) -> list[dict[str, Any]]:
        with self._lock:
            if project_id:
                rows = self._conn.execute(
                    "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC",
                    (project_id,),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM conversations ORDER BY updated_at DESC"
                ).fetchall()
        return [_row_to_conv(r) for r in rows]

    def create_conversation(
        self,
        model: str,
        image_mode: bool = False,
        project_id: Optional[str] = None,
    ) -> dict[str, Any]:
        now = _now()
        conv_id = str(uuid.uuid4())
        with self._lock:
            self._conn.execute(
                "INSERT INTO conversations (id, title, model, image_mode, project_id, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    conv_id,
                    "New chat",
                    model,
                    1 if image_mode else 0,
                    project_id,
                    now,
                    now,
                ),
            )
            self._conn.commit()
        (self.uploads_root / conv_id).mkdir(parents=True, exist_ok=True)
        return {
            "id": conv_id,
            "title": "New chat",
            "model": model,
            "image_mode": bool(image_mode),
            "project_id": project_id,
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
                "UPDATE conversations SET title = ?, model = ?, image_mode = ?, project_id = ?, updated_at = ? WHERE id = ?",
                (
                    conv["title"],
                    conv["model"],
                    1 if conv["image_mode"] else 0,
                    conv.get("project_id"),
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
        safe = _safe_basename(filename)
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

    def list_projects(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC"
            ).fetchall()
        return [_row_to_project(r) for r in rows]

    def create_project(self, name: str) -> dict[str, Any]:
        now = _now()
        project_id = str(uuid.uuid4())
        label = (name or "").strip() or "Untitled project"
        with self._lock:
            self._conn.execute(
                "INSERT INTO projects (id, name, instructions, memory, created_at, updated_at) "
                "VALUES (?, ?, '', '', ?, ?)",
                (project_id, label, now, now),
            )
            self._conn.commit()
        (self.projects_root / project_id).mkdir(parents=True, exist_ok=True)
        return {
            "id": project_id,
            "name": label,
            "instructions": "",
            "memory": "",
            "memory_updated_at": None,
            "created_at": now,
            "updated_at": now,
        }

    def get_project(self, project_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
        if not row:
            return None
        return _row_to_project(row)

    def get_project_detail(self, project_id: str) -> Optional[dict[str, Any]]:
        project = self.get_project(project_id)
        if not project:
            return None
        project["files"] = self.list_project_files(project_id)
        project["chats"] = self.list_conversations(project_id)
        return project

    def patch_project(
        self,
        project_id: str,
        *,
        name: Optional[str] = None,
        instructions: Optional[str] = None,
        memory: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        project = self.get_project(project_id)
        if not project:
            return None
        if name is not None:
            project["name"] = (name or "").strip() or project["name"]
        if instructions is not None:
            project["instructions"] = instructions
        if memory is not None:
            project["memory"] = memory
            project["memory_updated_at"] = _now()
        project["updated_at"] = _now()
        with self._lock:
            self._conn.execute(
                """
                UPDATE projects
                SET name = ?, instructions = ?, memory = ?, memory_updated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    project["name"],
                    project["instructions"],
                    project["memory"],
                    project["memory_updated_at"],
                    project["updated_at"],
                    project_id,
                ),
            )
            self._conn.commit()
        return project

    def touch_project(self, project_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE projects SET updated_at = ? WHERE id = ?",
                (_now(), project_id),
            )
            self._conn.commit()

    def delete_project(self, project_id: str) -> bool:
        project = self.get_project(project_id)
        if not project:
            return False
        with self._lock:
            self._conn.execute(
                "UPDATE conversations SET project_id = NULL WHERE project_id = ?",
                (project_id,),
            )
            self._conn.execute(
                "DELETE FROM project_files WHERE project_id = ?", (project_id,)
            )
            self._conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            self._conn.commit()
        folder = self.projects_root / project_id
        if folder.exists():
            shutil.rmtree(folder, ignore_errors=True)
        return True

    def list_project_files(
        self, project_id: str, *, include_text: bool = False
    ) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM project_files WHERE project_id = ? ORDER BY filename COLLATE NOCASE",
                (project_id,),
            ).fetchall()
        return [_row_to_project_file(r, include_text=include_text) for r in rows]

    def extracted_chars_total(self, project_id: str, exclude_filename: Optional[str] = None) -> int:
        with self._lock:
            if exclude_filename:
                row = self._conn.execute(
                    """
                    SELECT COALESCE(SUM(LENGTH(extracted_text)), 0)
                    FROM project_files
                    WHERE project_id = ? AND filename != ?
                    """,
                    (project_id, exclude_filename),
                ).fetchone()
            else:
                row = self._conn.execute(
                    "SELECT COALESCE(SUM(LENGTH(extracted_text)), 0) FROM project_files WHERE project_id = ?",
                    (project_id,),
                ).fetchone()
        return int(row[0] if row else 0)

    def upsert_project_file(
        self,
        project_id: str,
        filename: str,
        size_bytes: int,
        extracted_text: str,
        warning: Optional[str] = None,
    ) -> dict[str, Any]:
        now = _now()
        safe = _safe_basename(filename)
        with self._lock:
            existing = self._conn.execute(
                "SELECT id, created_at FROM project_files WHERE project_id = ? AND filename = ?",
                (project_id, safe),
            ).fetchone()
            if existing:
                self._conn.execute(
                    """
                    UPDATE project_files
                    SET size_bytes = ?, extracted_text = ?, warning = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (size_bytes, extracted_text, warning, now, existing["id"]),
                )
                file_id = existing["id"]
                created = existing["created_at"]
            else:
                file_id = str(uuid.uuid4())
                self._conn.execute(
                    """
                    INSERT INTO project_files
                    (id, project_id, filename, size_bytes, extracted_text, warning, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (file_id, project_id, safe, size_bytes, extracted_text, warning, now, now),
                )
                created = now
            self._conn.execute(
                "UPDATE projects SET updated_at = ? WHERE id = ?",
                (now, project_id),
            )
            self._conn.commit()
        return {
            "id": file_id,
            "project_id": project_id,
            "filename": safe,
            "size_bytes": size_bytes,
            "warning": warning,
            "extracted_chars": len(extracted_text or ""),
            "created_at": created,
            "updated_at": now,
        }

    def delete_project_file(self, project_id: str, filename: str) -> bool:
        safe = _safe_basename(filename)
        with self._lock:
            row = self._conn.execute(
                "SELECT id FROM project_files WHERE project_id = ? AND filename = ?",
                (project_id, safe),
            ).fetchone()
            if not row:
                return False
            self._conn.execute("DELETE FROM project_files WHERE id = ?", (row["id"],))
            self._conn.commit()
        path = self.project_file_path(project_id, safe)
        if path and path.exists():
            path.unlink(missing_ok=True)
        self.touch_project(project_id)
        return True

    def save_project_upload(self, project_id: str, filename: str, data: bytes) -> Path:
        folder = self.projects_root / project_id
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / _safe_basename(filename)
        dest.write_bytes(data)
        return dest

    def project_file_path(self, project_id: str, filename: str) -> Optional[Path]:
        folder = (self.projects_root / project_id).resolve()
        candidate = (folder / _safe_basename(filename)).resolve()
        if folder not in candidate.parents and candidate != folder:
            return None
        if not candidate.is_file():
            return None
        return candidate
