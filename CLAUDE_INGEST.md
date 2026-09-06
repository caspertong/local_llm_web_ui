# CLAUDE_INGEST.md — Files

v1 is **extract-and-inject**, matching the official Ollama app. No vector DB, no chunk retrieval. Uploaded files become text (or vision images) on the current user turn.

RAG is out of scope until people attach libraries too large for the context window.

## Picker

`<input type="file" multiple accept="…">` opens the OS explorer. Allowed extensions:

Images: `.png .jpg .jpeg .gif .webp .bmp .tif .tiff .heic .svg`

Documents: `.docx .xlsx .pptx .pdf .csv .txt .md .json`

Reject anything else with a per-file warning. Size cap **25 MB** per file.

## Extractors

| Kind | Module / lib | Output |
|---|---|---|
| Images | stored as bytes | `images[]` if model has `vision`; else skip + warning |
| `.txt` `.md` | utf-8 / latin-1 fallback | raw text |
| `.json` | json pretty-print | text |
| `.csv` | csv → markdown table | text |
| `.pdf` | pypdf | page text; if empty/whitespace and vision, rasterize pages (pypdfium2) as images (max 8 pages) |
| `.docx` | python-docx | paragraphs + tables as markdown |
| `.xlsx` | openpyxl | each sheet as a markdown table |
| `.pptx` | python-pptx | slide title + body per slide |

Wrap extracted text so the model (and history replay) can see boundaries:

```
<attachment filename="notes.md">
…extracted text…
</attachment>
```

Store that wrapped text in `messages.content` for the user turn. Keep original files at `data/uploads/{conversation_id}/{safe_filename}`.

## Truncation

Character budget ≈ `min(context_length * 3, 120_000)` minus a reserve for prior turns (~25%). Split the budget across files. If truncated, append `[truncated]` inside the attachment block and set `attachment.warning`.

## Replay

Do not re-extract on later turns. Rebuild Ollama messages from stored `content` + stored image paths (re-read bytes → base64). Missing files drop the image and add a warning in the UI only.
