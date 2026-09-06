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
  web: localStorage.getItem("hearth-web") === "1",
  comfy: false,
  imageMode: false,
  imageCheckpoint: "",
  imageLora: "",
  imageAspect: localStorage.getItem("hearth-image-aspect") || "1:1",
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
  web: document.getElementById("web"),
  webWrap: document.getElementById("web-wrap"),
  imageMode: document.getElementById("image-mode"),
  imageWrap: document.getElementById("image-wrap"),
  imageCkpt: document.getElementById("image-ckpt"),
  imageCkptWrap: document.getElementById("image-ckpt-wrap"),
  imageLora: document.getElementById("image-lora"),
  imageLoraWrap: document.getElementById("image-lora-wrap"),
  imageAspect: document.getElementById("image-aspect"),
  imageAspectWrap: document.getElementById("image-aspect-wrap"),
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
    .replace(/<web_search\b[^>]*>[\s\S]*?<\/web_search>/g, "")
    .replace(/Use the web_search results below for current information\. Cite source URLs in the answer\./g, "")
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
    syncToolbar();
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
  syncToolbar();
}

function syncToolbar() {
  const image = !!(state.imageMode && state.comfy);
  els.imageWrap.title = state.comfy ? "" : "Requires ComfyUI on port 8188";
  els.imageCkptWrap.hidden = !image;
  els.imageLoraWrap.hidden = !image;
  els.imageAspectWrap.hidden = !image;
  if (els.imageMode) els.imageMode.checked = !!state.imageMode;
  if (image) {
    els.thinkWrap.hidden = true;
    els.effortWrap.hidden = true;
    els.webWrap.hidden = true;
    els.model.hidden = true;
    els.attach.hidden = true;
    els.prompt.placeholder = "Describe an image…";
  } else {
    els.model.hidden = false;
    els.attach.hidden = false;
    els.webWrap.hidden = false;
    if (state.caps && state.caps.thinking) {
      els.thinkWrap.hidden = false;
      els.effortWrap.hidden = !state.thinking;
    }
    els.prompt.placeholder = state.web ? "Ask with web search…" : "Write a message…";
  }
}

function fillSelect(select, names, selected, emptyLabel) {
  select.innerHTML = "";
  if (emptyLabel) select.add(new Option(emptyLabel, ""));
  for (const name of names) {
    select.add(new Option(name, name));
  }
  if (selected && names.includes(selected)) select.value = selected;
  else if (!emptyLabel && names.length) select.value = names[0];
  else select.value = "";
  return select.value;
}

function preferFlux(names) {
  const fp8 = names.find((n) => /flux/i.test(n) && /fp8/i.test(n));
  if (fp8) return fp8;
  const flux = names.find((n) => /flux1-dev|flux/i.test(n));
  return flux || names[0] || "";
}

async function loadImageModels() {
  if (!state.comfy) {
    syncToolbar();
    return;
  }
  const res = await fetch("/api/image/models");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showBanner(data.error || "Could not list ComfyUI models.");
    syncToolbar();
    return;
  }
  const checkpoints = data.checkpoints || [];
  const loras = data.loras || [];
  state.imageCheckpoint = fillSelect(
    els.imageCkpt,
    checkpoints,
    state.imageCheckpoint || preferFlux(checkpoints),
    checkpoints.length ? "" : "No checkpoints"
  );
  fillSelect(els.imageLora, loras, state.imageLora, "No LoRA");
  state.imageLora = els.imageLora.value;
  if (els.imageAspect) {
    if (![...els.imageAspect.options].some((o) => o.value === state.imageAspect)) {
      state.imageAspect = "1:1";
    }
    els.imageAspect.value = state.imageAspect;
  }
  syncToolbar();
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
    state.comfy = !!data.comfy;
    if (!data.ollama) showBanner("Ollama is not reachable at the configured host.");
    await loadImageModels();
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
      collapseSidebarOnMobile();
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
  state.imageMode = false;
  renderChips();
  renderThread();
  renderChatList();
  syncToolbar();
  els.prompt.focus();
}

async function persistImageMode() {
  if (!state.currentId) return;
  await fetch(`/api/chats/${state.currentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_mode: !!state.imageMode }),
  });
}

async function applyChatSettings(data) {
  state.imageMode = !!data.image_mode;
  const known = !!(data.model && state.models.some((m) => m.name === data.model));
  if (known) {
    state.model = data.model;
    els.model.value = data.model;
    await loadCaps(data.model);
  } else {
    syncToolbar();
  }
  if (
    state.imageMode
    && data.model
    && els.imageCkpt
    && [...els.imageCkpt.options].some((o) => o.value === data.model)
  ) {
    state.imageCheckpoint = data.model;
    els.imageCkpt.value = data.model;
  }
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
  await applyChatSettings(data);
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
    chip.className = "chip" + (att.kind === "web" ? " web" : "");
    chip.textContent = att.kind === "web" ? "Web" : att.filename;
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
  const images = (msg.attachments || []).filter((att) => att.kind === "image" && att.path && msg.conversation_id);
  if (images.length) {
    const fig = document.createElement("figure");
    fig.className = "gen-figure";
    for (const att of images) {
      const img = document.createElement("img");
      img.alt = att.filename || "Generated image";
      img.src = `/api/chats/${msg.conversation_id}/files/${encodeURIComponent(att.filename)}`;
      fig.appendChild(img);
    }
    el.appendChild(fig);
  }
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
  if (state.imageMode && !state.comfy) {
    await loadHealth();
    if (!state.comfy) {
      showBanner("ComfyUI is not reachable. Start it on port 8188, then send again.");
      return;
    }
  }
  const image = !!(state.imageMode && state.comfy);
  if (!text && (image || !state.files.length)) return;
  if (!image && !state.model) {
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
      body: JSON.stringify({
        model: state.model || state.imageCheckpoint || "flux",
        image_mode: !!state.imageMode,
      }),
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

  els.prompt.value = "";
  autosize();
  const pendingFiles = state.files.slice();
  if (!image) {
    state.files = [];
    renderChips();
  }

  const assistant = { role: "assistant", content: "", thinking: "", attachments: [] };
  let assistantEl = null;
  const started = Date.now();
  const url = image
    ? `/api/chats/${state.currentId}/images`
    : `/api/chats/${state.currentId}/messages`;

  try {
    let res;
    if (image) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          checkpoint: state.imageCheckpoint || null,
          lora: state.imageLora || null,
          aspect: state.imageAspect || "1:1",
        }),
      });
    } else {
      const form = new FormData();
      form.append("content", text);
      form.append("thinking", state.thinking ? "true" : "false");
      form.append("web", state.web ? "true" : "false");
      if (state.thinking && state.effort) form.append("effort", state.effort);
      form.append("model", state.model);
      for (const file of pendingFiles) form.append("files", file);
      res = await fetch(url, { method: "POST", body: form });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(data.error || "Send failed");
    }
    await readSSE(res, {
      status(payload) {
        let statusEl = els.thread.querySelector(".thread-status");
        if (!statusEl) {
          if (els.empty.parentNode) els.empty.remove();
          statusEl = document.createElement("p");
          statusEl.className = "thread-status";
          els.thread.appendChild(statusEl);
        }
        statusEl.textContent = payload.text || "Working…";
        els.thread.scrollTop = els.thread.scrollHeight;
      },
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
        if (!image) {
          assistantEl = renderMessage(assistant, true);
          els.thread.appendChild(assistantEl);
        }
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
        const statusEl = els.thread.querySelector(".thread-status");
        if (statusEl) statusEl.remove();
        const msg = payload.message;
        state.messages.push(msg);
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        const next = renderMessage(msg);
        const details = next.querySelector(".thinking");
        if (details) {
          details.open = false;
          details.querySelector("summary").textContent = msg.thinking
            ? `Thought for ${secs}s`
            : "Thought";
        }
        if (assistantEl) assistantEl.replaceWith(next);
        else els.thread.appendChild(next);
        assistantEl = next;
        els.thread.scrollTop = els.thread.scrollHeight;
      },
      error(payload) {
        const statusEl = els.thread.querySelector(".thread-status");
        if (statusEl) statusEl.remove();
        showBanner(payload.error || "The model request failed");
      },
    });
  } catch (err) {
    const statusEl = els.thread.querySelector(".thread-status");
    if (statusEl) statusEl.remove();
    showBanner(err.message || "The model request failed");
    if (!image && !state.messages.length) {
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

function isMobileLayout() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function collapseSidebar() {
  document.body.classList.add("sidebar-collapsed");
  els.reopen.hidden = false;
}

function expandSidebar() {
  document.body.classList.remove("sidebar-collapsed");
  els.reopen.hidden = true;
}

function collapseSidebarOnMobile() {
  if (isMobileLayout()) collapseSidebar();
}

els.newChat.addEventListener("click", () => {
  newChat();
  collapseSidebarOnMobile();
});
els.collapse.addEventListener("click", collapseSidebar);
els.reopen.addEventListener("click", expandSidebar);
document.addEventListener("pointerdown", (e) => {
  if (!isMobileLayout()) return;
  if (document.body.classList.contains("sidebar-collapsed")) return;
  if (els.sidebar.contains(e.target)) return;
  collapseSidebar();
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
  els.effortWrap.hidden = !state.caps?.thinking || !state.thinking || state.imageMode;
});
els.web.addEventListener("change", () => {
  state.web = els.web.checked;
  localStorage.setItem("hearth-web", state.web ? "1" : "0");
  if (!state.imageMode) {
    els.prompt.placeholder = state.web ? "Ask with web search…" : "Write a message…";
  }
});
els.imageMode.addEventListener("change", async () => {
  if (els.imageMode.checked && !state.comfy) {
    await loadHealth();
  }
  if (els.imageMode.checked && !state.comfy) {
    els.imageMode.checked = false;
    state.imageMode = false;
    syncToolbar();
    showBanner("ComfyUI is not reachable. Start it on port 8188, then turn Image on.");
    return;
  }
  state.imageMode = els.imageMode.checked;
  syncToolbar();
  persistImageMode();
  if (state.imageMode) await loadImageModels();
});
els.imageCkpt.addEventListener("change", () => {
  state.imageCheckpoint = els.imageCkpt.value;
});
els.imageLora.addEventListener("change", () => {
  state.imageLora = els.imageLora.value;
});
els.imageAspect.addEventListener("change", () => {
  state.imageAspect = els.imageAspect.value;
  localStorage.setItem("hearth-image-aspect", state.imageAspect);
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
  els.web.checked = state.web;
  els.imageAspect.value = state.imageAspect;
  syncToolbar();
  renderThread();
  els.prompt.focus();
})();
