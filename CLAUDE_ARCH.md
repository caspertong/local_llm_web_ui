# CLAUDE_ARCH.md — Architecture

## Components

```
Browser SPA  →  FastAPI (REST + SSE)  →  Ollama :11434
                      │
                      ├── capabilities.py   (think / vision / gpt-oss)
                      ├── comfy_client.py   (optional Flux txt2img via ComfyUI :8188)
                      ├── ingest/           (file → text or images)
                      ├── project_prompt.py (system inject + memory extract)
                      └── storage.py        (SQLite + upload copies)
```

`app/main.py` serves the SPA and JSON/SSE APIs. `app/ollama_client.py` is the only module that HTTP-calls Ollama. `app/comfy_client.py` is the only module that HTTP-calls ComfyUI (`COMFY_HOST`, default `http://127.0.0.1:8188`). Comfy is optional: if it is down, chat still works; the Image toggle stays visible and explains that Comfy is unreachable.

## Request flow (send a message)

1. Client POSTs `/api/chats/{id}/messages` as `multipart/form-data` (text + files) or JSON (text only).
2. Storage creates/loads the conversation. Files are copied to `data/uploads/{conversation_id}/`.
3. Ingest extracts text / vision images. Extracted text is wrapped in labeled attachment blocks and stored on the user message so replay does not re-parse.
4. Capabilities mapper turns UI `{thinking, effort}` into Ollama `think`.
5. If the chat belongs to a project, a `role: system` message is prepended (instructions + memory + live project file extracts). That system text is not stored on the user turn.
6. Client streams `/api/chat` (`stream: true`) with full message history.
7. SSE events (`thinking`, `content`, `done`, `error`) go to the browser. The finished assistant message (content + thinking) is saved.
8. After `done`, a second non-streaming `/api/chat` (no `think`) may update project memory from the latest turn.

## Thinking / effort → `think`

`/api/show` `capabilities` decides what the UI shows. The request field is always top-level `think` on `/api/chat`.

| UI | Ollama `think` |
|---|---|
| Thinking off | `false` |
| Thinking on, no effort | `true` |
| Thinking on + Low/Medium/High/Max | `"low"` / `"medium"` / `"high"` / `"max"` |

**GPT-OSS:** family or name contains `gpt-oss`. `think` must be `"low"|"medium"|"high"`. Boolean off is ignored by Ollama. UI locks Thinking on and hides Max.

If `thinking` is missing from capabilities, omit `think` entirely.

## Vision

If `vision` is in capabilities, image bytes (and rasterized empty PDFs) go on the user message as `images` (base64). Otherwise images are skipped with a warning attached to the user message. Assistant-generated images are not sent back to Ollama.

## Image generation (ComfyUI)

When Image mode is on, the client POSTs `/api/chats/{id}/images` instead of `/api/chats/{id}/messages`. FastAPI queues a Flux txt2img workflow on Comfy (`POST /prompt`, poll `/history`, `GET /view`) and stores the PNG under `data/uploads/{conversation_id}/`. The assistant message has `attachments` with `kind: image`.

Community Flux LoRAs are files the user places in ComfyUI’s `models/loras/` folder. Hearth only lists what Comfy reports.

## Data model (SQLite `data/app.db`)

**conversations:** `id`, `title`, `model`, `image_mode` (bool; Image vs Ollama for that chat), `project_id` (nullable), `created_at`, `updated_at`

**messages:** `id`, `conversation_id`, `role` (`user`|`assistant`), `content`, `thinking`, `attachments` (JSON), `created_at`

**projects:** `id`, `name`, `instructions`, `memory`, `memory_updated_at`, `created_at`, `updated_at`

**project_files:** `id`, `project_id`, `filename` (unique per project), `size_bytes`, `extracted_text`, `warning`, `created_at`, `updated_at`

`attachments` is a list of `{filename, kind, path, warning?}`. `kind` is `image` or `document`.

Title is the first user message, truncated to ~60 characters, set once.

Project files live at `data/projects/{project_id}/{filename}` and overwrite on re-upload of the same name. Chat uploads stay under `data/uploads/{conversation_id}/`. Deleting a project unlinks its chats (`project_id = NULL`) and removes the project files directory.

## Context window

`model_info.*.context_length` from `/api/show` (fallback 8192). Extracted text is truncated to a conservative character budget derived from that window so the prompt fits. Truncation adds a warning on the attachment.
