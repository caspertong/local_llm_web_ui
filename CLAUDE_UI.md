# CLAUDE_UI.md — Interface

Claude-like reading UI, not ChatGPT bubbles. Dark warm charcoal, high-readability type. Brand name: **Hearth**.

## Layout

- **Sidebar** (left, ~260px, near-black): brand (logo + Hearth), “New chat”, conversation list, collapse control at the bottom. Active chat is a slightly lighter row.
- **Main column**: max-width 760px, centered. Document flow, not bubbles.
- **Top bar** (inside the column): model `<select>`, Thinking toggle, Effort `<select>`.
- **Composer** (bottom of column, sticky): rounded paperclip + textarea + send. Enter sends, Shift+Enter newline. Multi-file via OS picker (`<input type="file" multiple>`).
- **Empty state**: short greeting, no marketing.

## Typography

- UI chrome: **Source Sans 3**.
- Assistant replies: **Source Serif 4**, 18–19px, line-height 1.7.
- User prompts: Source Sans 3, slightly heavier, same measure.
- Avoid tiny type. Minimum body 16px.

Load fonts from Google Fonts (or self-host later). Fallback: `Iowan Old Style`, `Palatino`, `Georgia`, serif for replies; system UI sans for chrome.

## Color

| Token | Hex | Use |
|---|---|---|
| Paper | `#1f1e1c` | Main canvas |
| Paper-deep | `#262522` | Controls |
| Sidebar | `#171614` | Left rail |
| Composer | `#2a2926` | Message bar fill |
| Ink | `#eceae4` | Body text |
| Ink-muted | `#9c9a93` | Meta, placeholders |
| Taupe | `#2e2c28` | Chips, hover rows |
| Line | `#3a3834` | Hairline borders |
| Terracotta | `#d97757` | Primary actions |
| Terracotta-deep | `#e08a6a` | Hover |
| Thinking | `#a8a49c` | Thinking trace |

Warm dark, not cool OLED black. Soft 1px borders. No focus ring on the composer textarea. Composer is a short pill (~40px), not a tall card.

## Control visibility

On model change, GET `/api/models/{name}` (capabilities) and:

- No `thinking` → hide Thinking and Effort.
- Has `thinking`, not GPT-OSS → show Thinking. Show Effort only when Thinking is on. Options: Low, Medium, High, Max.
- GPT-OSS → Thinking locked on (visible, disabled). Effort: Low, Medium, High (no Max).

Default: Thinking on when available; Effort Medium.

## Messages

- User: left-aligned prompt, ink, modest top margin.
- Assistant: serif body. Markdown rendered (headings, lists, code, tables).
- Attachments: chips under the user prompt (filename + kind). Warnings in muted italic.
- Thinking: `<details>` labeled “Thinking…” while streaming (open). On `done`, collapse and retitle “Thought for Ns” if elapsed is known, else “Thought”.
- Streaming cursor: a dim terracotta caret on the active block.

## Motion

Minimal. 150ms ease on sidebar collapse and chip add/remove. No bounce. Thinking text streams in place; do not typewriter the answer beyond native SSE chunks.
