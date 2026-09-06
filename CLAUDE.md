# CLAUDE.md — Local Ollama Web UI

Single-user local chat UI for Ollama. FastAPI backend, Claude-style single-page frontend, SQLite history. Ollama stays on the host; this app is only the client.

Read this file first. Then:

- [CLAUDE_ARCH.md](CLAUDE_ARCH.md) — components, data flow, Ollama mapping
- [CLAUDE_UI.md](CLAUDE_UI.md) — layout, typography, control visibility
- [CLAUDE_INGEST.md](CLAUDE_INGEST.md) — file types, extract-and-inject, truncation
- [CLAUDE_API.md](CLAUDE_API.md) — our REST/SSE endpoints and the Ollama calls they wrap
- [docs/COMFY.md](docs/COMFY.md) — optional local Flux via ComfyUI

## Run

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Ollama must already be running at `OLLAMA_HOST` (default `http://localhost:11434`).

Docker (UI only; Ollama still on the host):

```bash
docker compose up --build
```

## Conventions

- Python 3.9+, type hints, no extra frameworks.
- Talk to Ollama’s **native** `/api/chat`, `/api/tags`, `/api/show`. Never the OpenAI-compat `/v1` path (`reasoning_effort` is a different value set).
- Thinking and effort are **one** Ollama field (`think`). Two UI controls map onto it. See CLAUDE_ARCH.md.
- Files are extract-and-inject, not RAG. See CLAUDE_INGEST.md.
- Persist conversations in SQLite under `data/` (gitignored). Do not store secrets.
- Frontend is vanilla HTML/CSS/JS in `app/templates` and `app/static`. No Node build.
- Keep the UI Claude-like: warm paper, readable type, document layout (not chat bubbles). See CLAUDE_UI.md.

## Out of scope (v1)

RAG, auth, pulling/deleting models, tool calling, multi-node Ollama.

Optional image generation uses a **separate** ComfyUI process. See [docs/COMFY.md](docs/COMFY.md).
