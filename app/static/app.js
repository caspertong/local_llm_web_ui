/* global marked, DOMPurify */

const ACCEPT = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff",
  ".heic", ".heif", ".svg", ".docx", ".xlsx", ".pptx", ".pdf", ".csv",
  ".txt", ".md", ".json",
];

const state = {
  chats: [],
  currentId: null,
  messages: [],
  models: [],
  model: "",
  caps: null,
  thinking: true,
  effort: "medium",
  files: [],
  streaming: false,
  filter: "",
};

const els = {
  sidebar: document.getElementById("sidebar"),
  chatList: document.getElementById("chat-list"),
  search: document.getElementById("search"),
  newChat: document.getElementById("new-chat"),
  collapse: document.getElementById("collapse-sidebar"),
  reopen: document.getElementById("reopen-sidebar"),
  model: document.getElementById("model"),
  thinking: document.getElementById("thinking"),
  thinkWrap: document.getElementById("think-wrap"),
  effort: document.getElementById("effort"),
  effortWrap: document.getElementById("effort-wrap"),
  banner: document.getElementById("banner"),
  thread: document.getElementById("thread"),
  empty: document.getElementById("empty"),
  composer: document.getElementById("composer"),
  prompt: document.getElementById("prompt"),
  send: document.getElementById("send"),
  attach: document.getElementById("attach-btn"),
  fileInput: document.getElementById("file-input"),
  chips: document.getElementById("chips"),
};

if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
}

function showBanner(text) {
  if (!text) {
    els.banner.hidden = true;
    els.banner.textContent = "";
    return;
  }
  els.banner.hidden = false;
  els.banner.textContent = text;
}

function labelEffort(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function displayUserText(content) {
  return (content || "")
    .replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/g, "")
    .trim();
}

function renderMarkdown(text) {
  const raw = window.marked ? marked.parse(text || "") : (text || "");
  return window.DOMPurify ? DOMPurify.sanitize(raw) : raw;
}

function applyCaps(caps) {
  state.caps = caps;
  if (!caps || !caps.thinking) {
    els.thinkWrap.hidden = true;
    els.effortWrap.hidden = true;
    return;
  }
  els.thinkWrap.hidden = false;
  els.thinking.disabled = !!caps.thinking_locked;
  if (caps.thinking_locked) {
    state.thinking = true;
    els.thinking.checked = true;
  }
  els.effort.innerHTML = "";
  for (const opt of caps.effort_options || []) {
    els.effort.add(new Option(labelEffort(opt), opt));
  }
  if (!(caps.effort_options || []).includes(state.effort)) {
    state.effort = (caps.effort_options || []).includes("medium")
      ? "medium"
      : (caps.effort_options || [])[0] || "medium";
  }
  els.effort.value = state.effort;
  els.effortWrap.hidden = !state.thinking;
}

async function loadCaps(name) {
  if (!name) {
    applyCaps(null);
    return;
  }
  const res = await fetch(`/api/models/${encodeURIComponent(name)}`);
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not load model details");
    applyCaps(null);
    return;
  }
  applyCaps(data);
}

async function loadModels() {
  const res = await fetch("/api/models");
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Cannot reach Ollama. Is it running?");
    return;
  }
  state.models = data.models || [];
  els.model.innerHTML = "";
  if (!state.models.length) {
    els.model.add(new Option("No models installed", ""));
    showBanner("No models found. Pull one with ollama pull.");
    return;
  }
  for (const m of state.models) {
    els.model.add(new Option(m.name, m.name));
  }
  if (!state.model || !state.models.some((m) => m.name === state.model)) {
    state.model = state.models[0].name;
  }
  els.model.value = state.model;
  await loadCaps(state.model);
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!data.ollama) showBanner("Ollama is not reachable at the configured host.");
  } catch {
    showBanner("The UI server is not responding.");
  }
}

async function loadChats() {
  const res = await fetch("/api/chats");
  const data = await res.json();
  state.chats = data.chats || [];
  renderChatList();
}

function renderChatList() {
  const q = state.filter.trim().toLowerCase();
  els.chatList.innerHTML = "";
  for (const chat of state.chats) {
    if (q && !(chat.title || "").toLowerCase().includes(q)) continue;
    const row = document.createElement("div");
    row.className = "chat-item" + (chat.id === state.currentId ? " active" : "");
    row.innerHTML = `<span class="title"></span><button class="delete" type="button" title="Delete" aria-label="Delete">×</button>`;
    row.querySelector(".title").textContent = chat.title || "New chat";
    row.addEventListener("click", (e) => {
      if (e.target.closest(".delete")) return;
      openChat(chat.id);
    });
    row.querySelector(".delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });
    els.chatList.appendChild(row);
  }
}

function newChat() {
  state.currentId = null;
  state.messages = [];
  state.files = [];
  renderChips();
  renderThread();
  renderChatList();
  els.prompt.focus();
}

async function openChat(id) {
  const res = await fetch(`/api/chats/${id}`);
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not open chat");
    return;
  }
  state.currentId = id;
  state.messages = data.messages || [];
  if (data.model) {
    state.model = data.model;
    els.model.value = data.model;
    await loadCaps(data.model);
  }
  renderChatList();
  renderThread();
}

async function deleteChat(id) {
  await fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (state.currentId === id) newChat();
  await loadChats();
}

function renderChips() {
  els.chips.innerHTML = "";
  state.files.forEach((file, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span></span><button type="button" aria-label="Remove">×</button>`;
    chip.querySelector("span").textContent = file.name;
    chip.querySelector("button").addEventListener("click", () => {
      state.files.splice(i, 1);
      renderChips();
    });
    els.chips.appendChild(chip);
  });
}

function attachmentChips(msg) {
  const wrap = document.createElement("div");
  wrap.className = "chips-row";
  for (const att of msg.attachments || []) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = att.filename;
    wrap.appendChild(chip);
    if (att.kind === "image" && att.path && msg.conversation_id) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = att.filename;
      img.src = `/api/chats/${msg.conversation_id}/files/${encodeURIComponent(att.filename)}`;
      wrap.appendChild(img);
    }
    if (att.warning) {
      const w = document.createElement("p");
      w.className = "warning";
      w.textContent = att.warning;
      wrap.appendChild(w);
    }
  }
  return wrap;
}

function renderThread() {
  const keepEmpty = els.empty;
  els.thread.innerHTML = "";
  if (!state.messages.length) {
    els.thread.appendChild(keepEmpty);
    return;
  }
  for (const msg of state.messages) {
    els.thread.appendChild(renderMessage(msg));
  }
  els.thread.scrollTop = els.thread.scrollHeight;
}

function renderMessage(msg, streaming = false) {
  const el = document.createElement("article");
  el.className = `msg ${msg.role}`;
  el.dataset.id = msg.id || "";

  if (msg.role === "user") {
    const p = document.createElement("p");
    p.className = "prompt";
    p.textContent = displayUserText(msg.content) || (msg.attachments || []).map((a) => a.filename).join(", ");
    el.appendChild(p);
    if (msg.attachments && msg.attachments.length) el.appendChild(attachmentChips(msg));
    return el;
  }

  if (msg.thinking || streaming) {
    const details = document.createElement("details");
    details.className = "thinking";
    details.open = streaming && !msg.content;
    const summary = document.createElement("summary");
    summary.textContent = streaming && !msg.content ? "Thinking…" : "Thought";
    const pre = document.createElement("pre");
    pre.className = "thinking-body";
    pre.textContent = msg.thinking || "";
    details.appendChild(summary);
    details.appendChild(pre);
    el.appendChild(details);
  }

  const body = document.createElement("div");
  body.className = "body" + (streaming ? " caret" : "");
  body.innerHTML = renderMarkdown(msg.content || "");
  el.appendChild(body);
  return el;
}

function autosize() {
  els.prompt.style.height = "22px";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 160)}px`;
}

async function readSSE(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const part of parts) {
      let event = "message";
      const dataLines = [];
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let payload = {};
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      if (handlers[event]) handlers[event](payload);
    }
  }
}

async function send() {
  if (state.streaming) return;
  const text = els.prompt.value.trim();
  if (!text && !state.files.length) return;
  if (!state.model) {
    showBanner("Select a model first.");
    return;
  }

  showBanner("");
  state.streaming = true;
  els.send.disabled = true;

  if (!state.currentId) {
    const created = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: state.model }),
    });
    const chat = await created.json();
    if (!created.ok) {
      showBanner(chat.error || "Could not create chat");
      state.streaming = false;
      els.send.disabled = false;
      return;
    }
    state.currentId = chat.id;
    await loadChats();
  }

  const form = new FormData();
  form.append("content", text);
  form.append("thinking", state.thinking ? "true" : "false");
  if (state.thinking && state.effort) form.append("effort", state.effort);
  form.append("model", state.model);
  for (const file of state.files) form.append("files", file);

  els.prompt.value = "";
  autosize();
  const pendingFiles = state.files.slice();
  state.files = [];
  renderChips();

  const assistant = { role: "assistant", content: "", thinking: "", attachments: [] };
  let assistantEl = null;
  const started = Date.now();

  try {
    const res = await fetch(`/api/chats/${state.currentId}/messages`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(data.error || "Send failed");
    }
    await readSSE(res, {
      user(payload) {
        const msg = payload.message;
        state.messages.push(msg);
        if (msg.conversation_title) {
          const chat = state.chats.find((c) => c.id === state.currentId);
          if (chat) chat.title = msg.conversation_title;
          renderChatList();
        }
        if (els.empty.parentNode) els.empty.remove();
        els.thread.appendChild(renderMessage(msg));
        assistantEl = renderMessage(assistant, true);
        els.thread.appendChild(assistantEl);
        els.thread.scrollTop = els.thread.scrollHeight;
      },
      thinking(payload) {
        assistant.thinking += payload.text || "";
        if (!assistantEl) return;
        let details = assistantEl.querySelector(".thinking");
        if (!details) {
          assistantEl.prepend(renderMessage(assistant, true).querySelector(".thinking"));
          details = assistantEl.querySelector(".thinking");
        }
        details.open = true;
        details.querySelector("summary").textContent = "Thinking…";
        details.querySelector(".thinking-body").textContent = assistant.thinking;
        els.thread.scrollTop = els.thread.scrollHeight;
      },
      content(payload) {
        assistant.content += payload.text || "";
        if (!assistantEl) return;
        const details = assistantEl.querySelector(".thinking");
        if (details) {
          details.open = false;
          details.querySelector("summary").textContent = "Thought";
        }
        const body = assistantEl.querySelector(".body");
        body.classList.add("caret");
        body.innerHTML = renderMarkdown(assistant.content);
        els.thread.scrollTop = els.thread.scrollHeight;
      },
      done(payload) {
        const msg = payload.message;
        state.messages.push(msg);
        if (assistantEl) {
          const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
          const details = assistantEl.querySelector(".thinking");
          if (details) {
            details.open = false;
            details.querySelector("summary").textContent = msg.thinking
              ? `Thought for ${secs}s`
              : "Thought";
          }
          const body = assistantEl.querySelector(".body");
          body.classList.remove("caret");
          body.innerHTML = renderMarkdown(msg.content || "");
        }
      },
      error(payload) {
        showBanner(payload.error || "The model request failed");
      },
    });
  } catch (err) {
    showBanner(err.message || "The model request failed");
    if (!state.messages.length) {
      state.files = pendingFiles;
      renderChips();
    }
  } finally {
    state.streaming = false;
    els.send.disabled = false;
    if (assistantEl) {
      const body = assistantEl.querySelector(".body");
      if (body) body.classList.remove("caret");
    }
  }
}

els.newChat.addEventListener("click", newChat);
els.collapse.addEventListener("click", () => {
  document.body.classList.add("sidebar-collapsed");
  els.reopen.hidden = false;
});
els.reopen.addEventListener("click", () => {
  document.body.classList.remove("sidebar-collapsed");
  els.reopen.hidden = true;
});
els.search.addEventListener("input", () => {
  state.filter = els.search.value;
  renderChatList();
});
els.model.addEventListener("change", async () => {
  state.model = els.model.value;
  await loadCaps(state.model);
  if (state.currentId && state.model) {
    await fetch(`/api/chats/${state.currentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: state.model }),
    });
  }
});
els.thinking.addEventListener("change", () => {
  state.thinking = els.thinking.checked;
  els.effortWrap.hidden = !state.caps?.thinking || !state.thinking;
});
els.effort.addEventListener("change", () => {
  state.effort = els.effort.value;
});
els.attach.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  for (const file of els.fileInput.files) {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPT.includes(ext) && !file.type.startsWith("image/")) continue;
    state.files.push(file);
  }
  els.fileInput.value = "";
  renderChips();
});
els.prompt.addEventListener("input", autosize);
els.prompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});

(async function init() {
  await loadHealth();
  await loadModels();
  await loadChats();
  renderThread();
  els.prompt.focus();
})();
