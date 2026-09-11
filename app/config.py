from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", PROJECT_ROOT / "data"))
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
COMFY_HOST = os.environ.get("COMFY_HOST", "http://127.0.0.1:8188").rstrip("/")
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY", "").strip()
WEB_SEARCH_MAX_RESULTS = 5
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES_AS_IMAGES = 8
MAX_TABLE_ROWS = 200
MAX_IMAGE_SIDE = 1568
MEMORY_MAX_CHARS = 8000
PROJECT_CONTEXT_CAP = 120_000
