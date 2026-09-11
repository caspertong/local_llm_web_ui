# CLAUDE_API.md — HTTP surface

All JSON. Errors: `{ "error": "…" }` with 4xx/5xx. SSE uses `text/event-stream` with `event:` + `data:` JSON lines.

## App endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | SPA |
| GET | `/api/health` | `{ "ok": true, "ollama": bool, "comfy": bool }` |
| GET | `/api/models` | Installed models from Ollama `/api/tags` |
| GET | `/api/models/{name}` | Capabilities from `/api/show` (see below) |
| GET | `/api/image/models` | Comfy UNET/checkpoints + LoRAs (`{ "checkpoints", "loras" }`) |
| GET | `/api/chats` | Conversation list, newest first |
| POST | `/api/chats` | `{ "model": "…", "image_mode"?, "project_id"? }` → new conversation |
| GET | `/api/chats/{id}` | Conversation + messages (`image_mode`, `project_id` included) |
| PATCH | `/api/chats/{id}` | `{ "title"?, "model"?, "image_mode"? }` |
| DELETE | `/api/chats/{id}` | Delete chat + upload dir |
| POST | `/api/chats/{id}/messages` | Send turn (multipart or JSON); **SSE** |
| POST | `/api/chats/{id}/images` | Flux txt2img via ComfyUI; **SSE** |
| GET | `/api/projects` | Project list, newest first |
| POST | `/api/projects` | `{ "name" }` → new project |
| GET | `/api/projects/{id}` | Project + files + chats |
| PATCH | `/api/projects/{id}` | `{ "name"?, "instructions"?, "memory"? }` |
| DELETE | `/api/projects/{id}` | Delete project + files; unlink chats |
| POST | `/api/projects/{id}/files` | Multipart `files`; replace by filename |
| GET | `/api/projects/{id}/files/{filename}` | Download original |
| DELETE | `/api/projects/{id}/files/{filename}` | Remove file + extract |

### `GET /api/models/{name}`

```json
{
  "name": "qwen3:latest",
  "capabilities": ["completion", "thinking", "tools"],
  "thinking": true,
  "vision": false,
  "gpt_oss": false,
  "effort_options": ["low", "medium", "high", "max"],
  "thinking_locked": false,
  "context_length": 32768
}
```

GPT-OSS: `gpt_oss: true`, `thinking_locked: true`, `effort_options: ["low","medium","high"]`.

### `POST /api/chats/{id}/messages`

Multipart fields: `content` (str), `thinking` (`true`/`false`), `effort` (`low|medium|high|max` or empty), `files` (repeated). JSON body allowed when there are no files.

SSE events:

- `thinking` — `{ "text": "…" }` incremental
- `content` — `{ "text": "…" }` incremental
- `user` — `{ "message": {…} }` the persisted user turn (including attachment warnings)
- `done` — `{ "message": {…} }` persisted assistant turn
- `error` — `{ "error": "…" }`

### `POST /api/chats/{id}/images`

JSON: `{ "content", "checkpoint?", "lora?", "aspect?", "seed?" }`. `aspect` is `1:1` | `3:4` | `9:16` | `16:9`. Multipart with the same field names is also accepted.

SSE events: `user`, `status` (`{ "text": "Generating image…" }`), `done` (assistant message with `kind: image` attachment), `error`.

Requires ComfyUI at `COMFY_HOST`. See [docs/COMFY.md](docs/COMFY.md).

## Ollama calls (native only)

- `GET {OLLAMA_HOST}/api/tags`
- `POST {OLLAMA_HOST}/api/show` body `{ "model": "…" }`
- `POST {OLLAMA_HOST}/api/chat` body:

```json
{
  "model": "qwen3",
  "messages": [
    { "role": "user", "content": "…", "images": ["base64…"] }
  ],
  "stream": true,
  "think": true
}
```

`think` omitted when the model has no thinking capability. Values: `true`, `false`, `"low"`, `"medium"`, `"high"`, `"max"` as mapped in CLAUDE_ARCH.md.

Do not send `think` inside `options`. Do not use `/v1/chat/completions`.
