from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, AsyncIterator, Optional
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.capabilities import from_show, map_think
from app.comfy_client import ASPECTS, ComfyError, generate as comfy_generate
from app.comfy_client import health as comfy_health
from app.comfy_client import list_models as comfy_list_models
from app.ingest.extract import image_to_jpeg, ingest_files
from app.ollama_client import OllamaError, chat_stream, health, list_models, show_model
from app.storage import Store
from app.web_search import search_web, wrap_web_results

STATIC_DIR = Path(__file__).resolve().parent / "static"
TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"

app = FastAPI(title="Local Ollama Web UI")
store = Store()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ChatCreate(BaseModel):
    model: str
    image_mode: bool = False


class ChatPatch(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None
    image_mode: Optional[bool] = None


class MessageJSON(BaseModel):
    content: str = ""
    thinking: bool = True
    effort: Optional[str] = None
    model: Optional[str] = None
    web: bool = False


class ImageJSON(BaseModel):
    content: str = ""
    checkpoint: Optional[str] = None
    lora: Optional[str] = None
    aspect: str = "1:1"
    seed: Optional[int] = None


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"error": str(exc.errors())}, status_code=422)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(TEMPLATE_DIR / "index.html")


@app.get("/api/health")
async def api_health() -> dict[str, Any]:
    ollama_ok = await health()
    comfy_ok = await comfy_health()
    return {"ok": True, "ollama": ollama_ok, "comfy": comfy_ok}


@app.get("/api/image/models")
async def api_image_models() -> dict[str, Any]:
    try:
        models = await comfy_list_models()
    except ComfyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return models


@app.get("/api/models")
async def api_models() -> dict[str, Any]:
    try:
        models = await list_models()
    except OllamaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"models": models}


@app.get("/api/models/{name:path}")
async def api_model_caps(name: str) -> dict[str, Any]:
    name = unquote(name)
    try:
        payload = await show_model(name)
    except OllamaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return from_show(name, payload).to_dict()


@app.get("/api/chats")
async def api_chats() -> dict[str, Any]:
    return {"chats": store.list_conversations()}


@app.post("/api/chats")
async def api_create_chat(body: ChatCreate) -> dict[str, Any]:
    if not body.model.strip():
        raise HTTPException(status_code=400, detail="model is required")
    return store.create_conversation(body.model.strip(), image_mode=body.image_mode)


@app.get("/api/chats/{chat_id}")
async def api_get_chat(chat_id: str) -> dict[str, Any]:
    conv = store.get_conversation_with_messages(chat_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Chat not found")
    return conv


@app.patch("/api/chats/{chat_id}")
async def api_patch_chat(chat_id: str, body: ChatPatch) -> dict[str, Any]:
    conv = store.patch_conversation(
        chat_id, title=body.title, model=body.model, image_mode=body.image_mode
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Chat not found")
    return conv


@app.delete("/api/chats/{chat_id}")
async def api_delete_chat(chat_id: str) -> dict[str, Any]:
    if not store.delete_conversation(chat_id):
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"ok": True}


@app.get("/api/chats/{chat_id}/files/{filename}")
async def api_chat_file(chat_id: str, filename: str) -> FileResponse:
    path = store.upload_path(chat_id, filename)
    if not path:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path)


def _file_bytes_for_vision(chat_id: str, filename: str, cached: Optional[bytes]) -> Optional[bytes]:
    if cached is not None:
        return cached
    path = store.upload_path(chat_id, filename)
    if not path:
        return None
    data = path.read_bytes()
    try:
        return image_to_jpeg(data, filename)
    except Exception:
        return data


def _build_ollama_messages(
    chat_id: str,
    history: list[dict[str, Any]],
    image_cache: dict[str, bytes],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for msg in history:
        item: dict[str, Any] = {
            "role": msg["role"],
            "content": msg.get("content") or "",
        }
        images: list[str] = []
        if msg.get("role") != "user":
            out.append(item)
            continue
        for att in msg.get("attachments") or []:
            if att.get("kind") != "image":
                continue
            name = Path(att.get("path") or att.get("filename") or "").name
            raw = _file_bytes_for_vision(chat_id, name, image_cache.get(name))
            if raw:
                images.append(base64.b64encode(raw).decode("ascii"))
        if images:
            item["images"] = images
        out.append(item)
    return out


def _truthy(value: Optional[str], default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


async def _send_turn(
    chat_id: str,
    content: str,
    thinking: bool,
    effort: Optional[str],
    model: Optional[str],
    uploads: list[tuple[str, bytes]],
    web: bool = False,
) -> AsyncIterator[str]:
    conv = store.get_conversation(chat_id)
    if not conv:
        yield _sse("error", {"error": "Chat not found"})
        return

    if web:
        yield _sse("status", {"text": "Searching the web…"})

    model_name = (model or conv["model"] or "").strip()
    if not model_name:
        yield _sse("error", {"error": "No model selected"})
        return
    if model_name != conv["model"]:
        store.patch_conversation(chat_id, model=model_name, image_mode=False)
    elif conv.get("image_mode"):
        store.patch_conversation(chat_id, image_mode=False)

    try:
        show = await show_model(model_name)
    except OllamaError as exc:
        yield _sse("error", {"error": str(exc)})
        return
    caps = from_show(model_name, show)
    think_value = map_think(caps, thinking, effort)

    originals: dict[str, str] = {}
    for name, data in uploads:
        dest = store.save_upload(chat_id, name, data)
        originals[name] = dest.name

    ingested = ingest_files(
        uploads,
        vision=caps.vision,
        context_length=caps.context_length,
        prior_chars=sum(len(m.get("content") or "") for m in store.list_messages(chat_id)),
    )

    image_cache: dict[str, bytes] = {}
    attachments: list[dict[str, Any]] = []
    blocks: list[str] = []
    for item in ingested:
        if item.image_bytes is not None:
            dest = store.save_upload(chat_id, item.filename, item.image_bytes)
            item.filename = dest.name
            item.path = dest.name
            image_cache[dest.name] = item.image_bytes
        else:
            item.path = originals.get(item.filename, item.filename)
        attachments.append(item.meta())
        blocks.append(item.wrapped_text())

    user_body = content.strip()
    if blocks:
        joined = "\n\n".join(blocks)
        user_body = f"{user_body}\n\n{joined}".strip() if user_body else joined

    if web:
        query = content.strip() or " ".join(
            Path(name).stem for name, _ in uploads[:3]
        )
        hits, warning = await search_web(query)
        web_block = wrap_web_results(query, hits, warning)
        note = (
            "Use the web_search results below for current information. "
            "Cite source URLs in the answer."
        )
        user_body = f"{user_body}\n\n{note}\n\n{web_block}".strip() if user_body else f"{note}\n\n{web_block}"
        web_meta: dict[str, Any] = {
            "filename": "Web search",
            "kind": "web",
            "path": "",
            "query": query,
        }
        if warning:
            web_meta["warning"] = warning
        elif hits:
            web_meta["results"] = len(hits)
        attachments.append(web_meta)

    if not user_body:
        yield _sse("error", {"error": "Type a message or attach a file"})
        return

    user_msg = store.add_message(chat_id, "user", user_body, attachments=attachments)
    title = store.maybe_set_title(chat_id, content.strip(), attachments)
    if title:
        user_msg["conversation_title"] = title
    yield _sse("user", {"message": user_msg})

    history = store.list_messages(chat_id)
    ollama_messages = _build_ollama_messages(chat_id, history, image_cache)

    thinking_acc = ""
    content_acc = ""
    try:
        async for kind, text in chat_stream(model_name, ollama_messages, think_value):
            if kind == "thinking":
                thinking_acc += text
                yield _sse("thinking", {"text": text})
            elif kind == "content":
                content_acc += text
                yield _sse("content", {"text": text})
    except OllamaError as exc:
        yield _sse("error", {"error": str(exc)})
        return

    assistant = store.add_message(
        chat_id,
        "assistant",
        content_acc,
        thinking=thinking_acc,
    )
    yield _sse("done", {"message": assistant})


def _stream(gen: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chats/{chat_id}/messages")
async def api_send_message(chat_id: str, request: Request) -> StreamingResponse:
    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype:
        body = MessageJSON.model_validate(await request.json())
        return _stream(
            _send_turn(
                chat_id,
                body.content,
                body.thinking,
                body.effort,
                body.model,
                [],
                body.web,
            )
        )

    form = await request.form()
    content = str(form.get("content") or "")
    thinking = _truthy(str(form.get("thinking")) if "thinking" in form else None)
    web = _truthy(str(form.get("web")) if "web" in form else None, default=False)
    effort_val = form.get("effort")
    effort = str(effort_val) if effort_val not in (None, "") else None
    model_val = form.get("model")
    model = str(model_val) if model_val not in (None, "") else None

    uploads: list[tuple[str, bytes]] = []
    raw_files = form.getlist("files")
    for upload in raw_files:
        if hasattr(upload, "read"):
            data = await upload.read()
            uploads.append((getattr(upload, "filename", None) or "file", data))

    return _stream(_send_turn(chat_id, content, thinking, effort, model, uploads, web))


async def _generate_image_turn(
    chat_id: str,
    content: str,
    checkpoint: Optional[str],
    lora: Optional[str],
    aspect: str,
    seed: Optional[int],
) -> AsyncIterator[str]:
    conv = store.get_conversation(chat_id)
    if not conv:
        yield _sse("error", {"error": "Chat not found"})
        return

    prompt = content.strip()
    if not conv.get("image_mode"):
        store.patch_conversation(chat_id, image_mode=True)

    if not prompt:
        yield _sse("error", {"error": "Type an image prompt"})
        return

    if aspect not in ASPECTS:
        aspect = "1:1"

    user_msg = store.add_message(chat_id, "user", prompt)
    title = store.maybe_set_title(chat_id, prompt, [])
    if title:
        user_msg["conversation_title"] = title
    yield _sse("user", {"message": user_msg})
    yield _sse("status", {"text": "Generating image…"})

    lora_name = (lora or "").strip() or None
    try:
        png = await comfy_generate(
            prompt,
            checkpoint=checkpoint,
            lora=lora_name,
            aspect=aspect,
            seed=seed,
        )
    except ComfyError as exc:
        yield _sse("error", {"error": str(exc)})
        return

    dest = store.save_upload(chat_id, "generated.png", png)
    caption = "Generated image"
    bits = [checkpoint] if checkpoint else []
    if lora_name:
        bits.append(lora_name)
    bits.append(aspect)
    if bits:
        caption = "Generated with " + " · ".join(str(b) for b in bits if b)

    assistant = store.add_message(
        chat_id,
        "assistant",
        caption,
        attachments=[
            {
                "filename": dest.name,
                "kind": "image",
                "path": dest.name,
            }
        ],
    )
    yield _sse("done", {"message": assistant})


@app.post("/api/chats/{chat_id}/images")
async def api_generate_image(chat_id: str, request: Request) -> StreamingResponse:
    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype:
        body = ImageJSON.model_validate(await request.json())
        return _stream(
            _generate_image_turn(
                chat_id,
                body.content,
                body.checkpoint,
                body.lora,
                body.aspect,
                body.seed,
            )
        )

    form = await request.form()
    content = str(form.get("content") or "")
    checkpoint_val = form.get("checkpoint")
    checkpoint = str(checkpoint_val) if checkpoint_val not in (None, "") else None
    lora_val = form.get("lora")
    lora = str(lora_val) if lora_val not in (None, "") else None
    aspect = str(form.get("aspect") or "1:1")
    seed_val = form.get("seed")
    seed = None
    if seed_val not in (None, ""):
        try:
            seed = int(str(seed_val))
        except ValueError:
            seed = None
    return _stream(_generate_image_turn(chat_id, content, checkpoint, lora, aspect, seed))
