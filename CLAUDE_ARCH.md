# CLAUDE_ARCH.md — Architecture

## Components

```
Browser SPA  →  FastAPI (REST + SSE)  →  Ollama :11434
                      │
                      ├── capabilities.py   (think / vision / gpt-oss)
                      ├── ingest/           (file → text or images)
                      └── storage.py        (SQLite + upload copies)
```

`app/main.py` serves the SPA and JSON/SSE APIs. `app/ollama_client.py` is the only module that HTTP-calls Ollama.

## Request flow (send a message)

1. Client POSTs `/api/chats/{id}/messages` as `multipart/form-data` (text + files) or JSON (text only).
2. Storage creates/loads the conversation. Files are copied to `data/uploads/{conversation_id}/`.
3. Ingest extracts text / vision images. Extracted text is wrapped in labeled attachment blocks and stored on the user message so replay does not re-parse.
4. Capabilities mapper turns UI `{thinking, effort}` into Ollama `think`.
5. Client streams `/api/chat` (`stream: true`) with full message history.
6. SSE events (`thinking`, `content`, `done`, `error`) go to the browser. The finished assistant message (content + thinking) is saved.

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

If `vision` is in capabilities, image bytes (and rasterized empty PDFs) go on the user message as `images` (base64). Otherwise images are skipped with a warning attached to the user message.

## Data model (SQLite `data/app.db`)

**conversations:** `id`, `title`, `model`, `created_at`, `updated_at`

**messages:** `id`, `conversation_id`, `role` (`user`|`assistant`), `content`, `thinking`, `attachments` (JSON), `created_at`

`attachments` is a list of `{filename, kind, path, warning?}`. `kind` is `image` or `document`.

Title is the first user message, truncated to ~60 characters, set once.

## Context window

`model_info.*.context_length` from `/api/show` (fallback 8192). Extracted text is truncated to a conservative character budget derived from that window so the prompt fits. Truncation adds a warning on the attachment.
