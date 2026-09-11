from __future__ import annotations

import re
from typing import Any, Optional

from app.config import MEMORY_MAX_CHARS
from app.ingest.extract import project_capacity
from app.ollama_client import OllamaError, chat_once
from app.storage import Store

_ATTACHMENT_RE = re.compile(r"<attachment\b[^>]*>[\s\S]*?</attachment>", re.I)
_WEB_RE = re.compile(r"<web_search\b[^>]*>[\s\S]*?</web_search>", re.I)
_TRUNC_MARK = "\n[truncated]"


def strip_injected(text: str) -> str:
    cleaned = _ATTACHMENT_RE.sub("", text or "")
    cleaned = _WEB_RE.sub("", cleaned)
    return cleaned.strip()


def wrap_project_file(filename: str, text: str, warning: Optional[str] = None) -> str:
    warn = f"\n[{warning}]" if warning else ""
    return (
        f'<attachment filename="{filename}" kind="document">\n'
        f"{text or ''}{warn}\n"
        f"</attachment>"
    )


def build_system_content(
    project: dict[str, Any],
    files: list[dict[str, Any]],
    *,
    context_length: int,
    history_chars: int,
) -> str:
    parts: list[str] = []
    instructions = (project.get("instructions") or "").strip()
    memory = (project.get("memory") or "").strip()
    if instructions:
        parts.append(instructions)
    if memory:
        parts.append(f"<project_memory>\n{memory}\n</project_memory>")

    prefix_len = sum(len(p) for p in parts) + 2 * max(len(parts) - 1, 0)
    cap = project_capacity(context_length)
    remaining = max(cap - history_chars - prefix_len - 2000, 500)

    docs = [f for f in files if (f.get("extracted_text") or "").strip()]
    if docs:
        per = max(remaining // len(docs), 200)
        for item in docs:
            text = item.get("extracted_text") or ""
            warning = item.get("warning")
            if len(text) > per:
                text = text[: max(per - len(_TRUNC_MARK), 0)] + _TRUNC_MARK
                note = "truncated to fit the model context window"
                warning = f"{warning}; {note}" if warning else note
            parts.append(wrap_project_file(item["filename"], text, warning))

    return "\n\n".join(parts).strip()


async def maybe_update_memory(
    store: Store,
    project_id: str,
    model: str,
    user_text: str,
    assistant_text: str,
) -> None:
    project = store.get_project(project_id)
    if not project:
        return
    user_plain = strip_injected(user_text)[:4000]
    assistant_plain = (assistant_text or "").strip()[:4000]
    if not user_plain and not assistant_plain:
        return
    current = (project.get("memory") or "").strip()
    prompt = (
        "You maintain a short project memory of durable facts (people, goals, decisions, preferences).\n"
        "Update the memory using the latest turn. Reply with the full replacement memory text, "
        "or exactly NO_CHANGE if nothing durable should be stored.\n"
        "No preamble. Keep it under 8000 characters.\n\n"
        f"Current memory:\n{current or '(empty)'}\n\n"
        f"Latest user:\n{user_plain or '(empty)'}\n\n"
        f"Latest assistant:\n{assistant_plain or '(empty)'}"
    )
    try:
        reply = await chat_once(
            model,
            [{"role": "user", "content": prompt}],
        )
    except OllamaError:
        return
    if not reply or reply.strip().upper() == "NO_CHANGE":
        return
    updated = reply.strip()[:MEMORY_MAX_CHARS]
    if updated == current:
        return
    store.patch_project(project_id, memory=updated)
