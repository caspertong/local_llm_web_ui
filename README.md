# Local Ollama Web UI

**Hearth** is a Claude-style chat UI for a local [Ollama](https://ollama.com) install. Pick a model, toggle thinking and effort when the model supports them, attach documents or images, and keep a sidebar of past chats.

Ollama stays on your machine. This app is only the browser UI and a small Python API in front of it.

## Requirements

- Python 3.9+
- [Ollama](https://ollama.com) running locally (default `http://localhost:11434`)
- At least one model pulled (`ollama pull qwen3` or similar)

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

Optional: `OLLAMA_HOST=http://localhost:11434`.

## Docker

Builds only the UI. Ollama still runs on the host.

```bash
docker compose up --build
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Features

- Model picker from whatever you have installed
- Thinking toggle and Low / Medium / High / Max effort when the model supports them
- Multi-file upload via the OS file picker (images, PDF, Office, CSV, text, Markdown, JSON)
- Extract-and-inject into the prompt (not a vector knowledge base)
- Persistent chat history in local SQLite

## Docs for contributors

Start at [CLAUDE.md](CLAUDE.md).
