# CLAUDE_API.md — HTTP surface

All JSON. Errors: `{ "error": "…" }` with 4xx/5xx. SSE uses `text/event-stream` with `event:` + `data:` JSON lines.

## App endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | SPA |
| GET | `/api/health` | `{ "ok": true, "ollama": bool }` |
| GET | `/api/models` | Installed models from Ollama `/api/tags` |
| GET | `/api/models/{name}` | Capabilities from `/api/show` (see below) |
| GET | `/api/chats` | Conversation list, newest first |
| POST | `/api/chats` | `{ "model": "…" }` → new conversation |
| GET | `/api/chats/{id}` | Conversation + messages |
| PATCH | `/api/chats/{id}` | `{ "title"?, "model"? }` |
| DELETE | `/api/chats/{id}` | Delete chat + upload dir |
| POST | `/api/chats/{id}/messages` | Send turn (multipart or JSON); **SSE** |

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
