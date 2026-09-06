from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Optional, Union

import httpx

from app.config import OLLAMA_HOST


class OllamaError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


async def health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{OLLAMA_HOST}/api/tags")
            return response.status_code == 200
    except httpx.HTTPError:
        return False


async def list_models() -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{OLLAMA_HOST}/api/tags")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OllamaError(f"Cannot reach Ollama at {OLLAMA_HOST}: {exc}") from exc
    payload = response.json()
    models = []
    for item in payload.get("models") or []:
        models.append(
            {
                "name": item.get("name") or item.get("model"),
                "size": item.get("size"),
                "modified_at": item.get("modified_at"),
                "digest": item.get("digest"),
            }
        )
    return models


async def show_model(name: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OLLAMA_HOST}/api/show",
                json={"model": name},
            )
            if response.status_code == 404:
                raise OllamaError(f"Model not found: {name}", status_code=404)
            response.raise_for_status()
    except OllamaError:
        raise
    except httpx.HTTPError as exc:
        raise OllamaError(f"Cannot reach Ollama at {OLLAMA_HOST}: {exc}") from exc
    return response.json()


async def chat_stream(
    model: str,
    messages: list[dict[str, Any]],
    think: Optional[Union[bool, str]],
) -> AsyncIterator[tuple[str, str]]:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    if think is not None:
        body["think"] = think

    timeout = httpx.Timeout(10.0, read=None)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_HOST}/api/chat",
                json=body,
            ) as response:
                if response.status_code >= 400:
                    raw = (await response.aread()).decode("utf-8", errors="replace")
                    raise OllamaError(
                        f"Ollama chat failed ({response.status_code}): {raw[:500]}",
                        status_code=502,
                    )
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if err := chunk.get("error"):
                        raise OllamaError(str(err))
                    message = chunk.get("message") or {}
                    thinking = message.get("thinking") or ""
                    content = message.get("content") or ""
                    if thinking:
                        yield "thinking", thinking
                    if content:
                        yield "content", content
                    if chunk.get("done"):
                        return
    except OllamaError:
        raise
    except httpx.HTTPError as exc:
        raise OllamaError(f"Ollama stream failed: {exc}") from exc
