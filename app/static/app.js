/* global marked, DOMPurify */

const ACCEPT = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff",
  ".heic", ".heif", ".svg", ".docx", ".xlsx", ".pptx", ".pdf", ".csv",
  ".txt", ".md", ".json", ".jsonl", ".yaml", ".yml",
];

const PROJECT_ACCEPT = [
  ".txt", ".csv", ".md", ".pdf", ".docx", ".pptx", ".xlsx",
  ".json", ".jsonl", ".yaml", ".yml",
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
  sidebarTab: "chats",
  projects: [],
  projectId: null,
  project: null,
  fileFilter: "",
  railOpen: false,
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
  composerProject: document.getElementById("composer-project"),
  prompt: document.getElementById("prompt"),
  send: document.getElementById("send"),
  attach: document.getElementById("attach-btn"),
  fileInput: document.getElementById("file-input"),
  chips: document.getElementById("chips"),
  tabChats: document.getElementById("tab-chats"),
  tabProjects: document.getElementById("tab-projects"),
  newChatLabel: document.getElementById("new-chat-label"),
  projectRecents: document.getElementById("project-recents"),
  rail: document.getElementById("project-rail"),
  railToggle: document.getElementById("rail-toggle"),
  railClose: document.getElementById("rail-close"),
  railTitle: document.getElementById("rail-title"),
  instructionsPreview: document.getElementById("instructions-preview"),
  instructionsEditor: document.getElementById("instructions-editor"),
  instructionsInput: document.getElementById("instructions-input"),
  editInstructions: document.getElementById("edit-instructions"),
  saveInstructions: document.getElementById("save-instructions"),
  cancelInstructions: document.getElementById("cancel-instructions"),
  memoryPreview: document.getElementById("memory-preview"),
  memoryUpdated: document.getElementById("memory-updated"),
  memoryEditor: document.getElementById("memory-editor"),
  memoryInput: document.getElementById("memory-input"),
  editMemory: document.getElementById("edit-memory"),
  saveMemory: document.getElementById("save-memory"),
  cancelMemory: document.getElementById("cancel-memory"),
  projectUploadBtn: document.getElementById("project-upload-btn"),
  projectFileInput: document.getElementById("project-file-input"),
  capacityLabel: document.getElementById("capacity-label"),
  capacityBar: document.getElementById("capacity-bar"),
  fileSearch: document.getElementById("file-search"),
  fileGrid: document.getElementById("file-grid"),
  projectDialog: document.getElementById("project-dialog"),
  projectDialogForm: document.getElementById("project-dialog-form"),
  projectName: document.getElementById("project-name"),
  cancelProject: document.getElementById("cancel-project"),
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
    if (state.project) renderProjectRail();
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
  if (state.project) renderProjectRail();
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

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatChars(n) {
  return Math.max(0, Math.round(n || 0)).toLocaleString();
}

function projectCapacity() {
  const ctx = state.caps?.context_length || 32768;
  return Math.min(ctx * 3, 120000);
}

function setSidebarTab(tab) {
  state.sidebarTab = tab;
  els.tabChats.classList.toggle("active", tab === "chats");
  els.tabProjects.classList.toggle("active", tab === "projects");
  els.tabChats.setAttribute("aria-selected", tab === "chats" ? "true" : "false");
  els.tabProjects.setAttribute("aria-selected", tab === "projects" ? "true" : "false");
  els.newChatLabel.textContent = tab === "projects" ? "New project" : "New chat";
  els.search.placeholder = tab === "projects" ? "Search projects" : "Search chats";
  renderSidebarList();
}

function projectChats() {
  if (!state.projectId) return [];
  return (state.chats || []).filter((c) => c.project_id === state.projectId);
}

async function loadProjects() {
  const res = await fetch("/api/projects");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showBanner(data.error || "Could not load projects");
    return;
  }
  state.projects = data.projects || [];
  if (state.sidebarTab === "projects") renderSidebarList();
}

async function loadProject(id, { keepChat = false } = {}) {
  const res = await fetch(`/api/projects/${id}`);
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not open project");
    return;
  }
  state.projectId = id;
  state.project = data;
  if (!keepChat) {
    state.currentId = null;
    state.messages = [];
    state.files = [];
    renderChips();
  }
  renderProjectRail();
  renderThread();
  renderSidebarList();
}

function hideProjectWorkspace() {
  state.projectId = null;
  state.project = null;
  state.railOpen = false;
  els.rail.hidden = true;
  els.railToggle.hidden = true;
  syncComposerProject();
}

function syncComposerProject() {
  const el = els.composerProject;
  if (!el) return;
  const name = (state.project?.name || "").trim();
  if (!name) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `<span class="mark" aria-hidden="true"></span><span>In project</span> <span class="name"></span>`;
  el.querySelector(".name").textContent = name;
  el.title = `Messages in this chat include ${name} instructions, memory, and files`;
}

function renderProjectRail() {
  const project = state.project;
  const show = !!project;
  els.railToggle.hidden = !show;
  if (!show) {
    els.rail.hidden = true;
    syncComposerProject();
    return;
  }
  const wide = window.matchMedia("(min-width: 1101px)").matches;
  els.rail.hidden = !(wide || state.railOpen);
  els.railTitle.textContent = project.name || "Project";
  const instructions = (project.instructions || "").trim();
  els.instructionsPreview.textContent = instructions || "Add instructions to tailor responses.";
  els.instructionsPreview.classList.toggle("has-text", !!instructions);
  els.instructionsPreview.classList.remove("expanded");
  els.instructionsPreview.title = instructions ? "Click to expand" : "";
  const memory = (project.memory || "").trim();
  els.memoryPreview.textContent = memory || "The model will write durable notes here.";
  els.memoryPreview.classList.toggle("has-text", !!memory);
  els.memoryPreview.classList.remove("expanded");
  els.memoryPreview.title = memory ? "Click to expand" : "";
  if (project.memory_updated_at) {
    els.memoryUpdated.hidden = false;
    els.memoryUpdated.textContent = `Last updated ${formatWhen(project.memory_updated_at)}`;
  } else {
    els.memoryUpdated.hidden = true;
  }
  const used = project.extracted_chars || (project.files || []).reduce((n, f) => n + (f.extracted_chars || 0), 0);
  const cap = projectCapacity();
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  els.capacityLabel.textContent = `${formatChars(used)} / ${formatChars(cap)} characters · ${pct}%`;
  els.capacityBar.style.width = `${pct}%`;
  renderFileGrid();
  syncComposerProject();
}

function renderFileGrid() {
  const q = (state.fileFilter || "").trim().toLowerCase();
  els.fileGrid.innerHTML = "";
  for (const file of state.project?.files || []) {
    if (q && !(file.filename || "").toLowerCase().includes(q)) continue;
    const card = document.createElement("div");
    card.className = "file-card";
    const ext = (file.filename.split(".").pop() || "").toUpperCase();
    card.innerHTML = `<button class="icon-btn remove" type="button" title="Delete" aria-label="Delete">×</button>
      <div class="name"></div>
      <div class="size"></div>
      <span class="badge"></span>`;
    card.querySelector(".name").textContent = file.filename;
    card.querySelector(".size").textContent = formatBytes(file.size_bytes || 0);
    card.querySelector(".badge").textContent = ext.slice(0, 4);
    card.querySelector(".remove").addEventListener("click", () => deleteProjectFile(file.filename));
    els.fileGrid.appendChild(card);
  }
}

async function patchProject(body) {
  if (!state.projectId) return;
  const res = await fetch(`/api/projects/${state.projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not save project");
    return;
  }
  state.project = data;
  renderProjectRail();
  if (state.sidebarTab === "projects") renderSidebarList();
}

async function deleteProjectFile(filename) {
  if (!state.projectId) return;
  await fetch(`/api/projects/${state.projectId}/files/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  await loadProject(state.projectId, { keepChat: true });
}

async function uploadProjectFiles(fileList) {
  if (!state.projectId || !fileList.length) return;
  const form = new FormData();
  for (const file of fileList) {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!PROJECT_ACCEPT.includes(ext)) continue;
    form.append("files", file);
  }
  if (![...form.keys()].length) return;
  form.append("context_length", String(state.caps?.context_length || 32768));
  const res = await fetch(`/api/projects/${state.projectId}/files`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not upload files");
    return;
  }
  state.project = data;
  renderProjectRail();
}

function renderSidebarList() {
  if (state.sidebarTab === "projects") {
    renderProjectList();
    return;
  }
  renderChatList();
}

function renderProjectList() {
  const q = state.filter.trim().toLowerCase();
  els.chatList.innerHTML = "";
  for (const project of state.projects) {
    if (q && !(project.name || "").toLowerCase().includes(q)) continue;
    const row = document.createElement("div");
    row.className = "chat-item" + (project.id === state.projectId ? " active" : "");
    row.innerHTML = `<span class="title"></span><button class="delete" type="button" title="Delete" aria-label="Delete">×</button>`;
    row.querySelector(".title").textContent = project.name || "Untitled project";
    row.addEventListener("click", (e) => {
      if (e.target.closest(".delete")) return;
      loadProject(project.id);
      collapseSidebarOnMobile();
    });
    row.querySelector(".delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteProject(project.id);
    });
    els.chatList.appendChild(row);
  }
}

async function loadChats() {
  const res = await fetch("/api/chats");
  const data = await res.json();
  state.chats = data.chats || [];
  renderSidebarList();
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
  if (state.sidebarTab !== "projects") hideProjectWorkspace();
  renderChips();
  renderThread();
  renderSidebarList();
  syncToolbar();
  els.prompt.focus();
}

function openProjectDialog() {
  els.projectName.value = "Untitled project";
  els.projectDialog.hidden = false;
  els.projectName.focus();
  els.projectName.select();
}

function closeProjectDialog() {
  els.projectDialog.hidden = true;
}

async function newProject(name) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: (name || "").trim() || "Untitled project" }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not create project");
    return;
  }
  closeProjectDialog();
  await loadProjects();
  await loadProject(data.id);
}

async function deleteProject(id) {
  await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (state.projectId === id) {
    hideProjectWorkspace();
    newChat();
  }
  await loadProjects();
  await loadChats();
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
  if (data.project_id) {
    if (!state.project || state.project.id !== data.project_id) {
      await loadProject(data.project_id, { keepChat: true });
    } else {
      syncComposerProject();
    }
  } else if (state.sidebarTab !== "projects") {
    hideProjectWorkspace();
  } else {
    syncComposerProject();
  }
  await applyChatSettings(data);
  renderSidebarList();
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
    const title = els.empty.querySelector("h1");
    const blurb = els.empty.querySelector("p");
    if (state.project) {
      title.textContent = state.project.name || "Project";
      blurb.textContent = "Ask anything in this project. Instructions, memory, and files are included automatically.";
    } else {
      title.textContent = "Hearth is ready";
      blurb.textContent = "Your models stay on this machine. Ask anything.";
    }
    els.thread.appendChild(keepEmpty);
    renderProjectRecents();
    return;
  }
  for (const msg of state.messages) {
    els.thread.appendChild(renderMessage(msg));
  }
  els.thread.scrollTop = els.thread.scrollHeight;
}

function renderProjectRecents() {
  const list = els.projectRecents;
  if (!list) return;
  list.innerHTML = "";
  const chats = projectChats();
  if (!state.project || !chats.length) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  for (const chat of chats) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "recent-item";
    row.innerHTML = `<span class="title"></span><span class="when"></span>`;
    row.querySelector(".title").textContent = chat.title || "New chat";
    row.querySelector(".when").textContent = formatWhen(chat.updated_at);
    row.addEventListener("click", () => openChat(chat.id));
    list.appendChild(row);
  }
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
        project_id: state.projectId || null,
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
          renderSidebarList();
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
        if (state.projectId) loadProject(state.projectId, { keepChat: true });
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
  if (state.sidebarTab === "projects") openProjectDialog();
  else {
    newChat();
    collapseSidebarOnMobile();
  }
});
els.projectDialogForm.addEventListener("submit", (e) => {
  e.preventDefault();
  newProject(els.projectName.value);
});
els.cancelProject.addEventListener("click", closeProjectDialog);
els.projectDialog.addEventListener("pointerdown", (e) => {
  if (e.target === els.projectDialog) closeProjectDialog();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.projectDialog.hidden) closeProjectDialog();
});
els.tabChats.addEventListener("click", () => {
  setSidebarTab("chats");
  const chat = state.chats.find((c) => c.id === state.currentId);
  if (!chat || !chat.project_id) {
    hideProjectWorkspace();
    renderThread();
  }
});
els.tabProjects.addEventListener("click", () => {
  setSidebarTab("projects");
  loadProjects();
});
els.editInstructions.addEventListener("click", () => {
  els.instructionsInput.value = state.project?.instructions || "";
  els.instructionsEditor.hidden = false;
  els.instructionsPreview.hidden = true;
});
els.cancelInstructions.addEventListener("click", () => {
  els.instructionsEditor.hidden = true;
  els.instructionsPreview.hidden = false;
});
els.saveInstructions.addEventListener("click", async () => {
  await patchProject({ instructions: els.instructionsInput.value });
  els.instructionsEditor.hidden = true;
  els.instructionsPreview.hidden = false;
});
els.editMemory.addEventListener("click", () => {
  els.memoryInput.value = state.project?.memory || "";
  els.memoryEditor.hidden = false;
  els.memoryPreview.hidden = true;
});
els.cancelMemory.addEventListener("click", () => {
  els.memoryEditor.hidden = true;
  els.memoryPreview.hidden = false;
});
els.saveMemory.addEventListener("click", async () => {
  await patchProject({ memory: els.memoryInput.value });
  els.memoryEditor.hidden = true;
  els.memoryPreview.hidden = false;
});
function toggleRailPreview(el) {
  if (!el.classList.contains("has-text")) return;
  const open = el.classList.toggle("expanded");
  el.title = open ? "Click to collapse" : "Click to expand";
}
els.instructionsPreview.addEventListener("click", () => toggleRailPreview(els.instructionsPreview));
els.memoryPreview.addEventListener("click", () => toggleRailPreview(els.memoryPreview));
els.projectUploadBtn.addEventListener("click", () => els.projectFileInput.click());
els.projectFileInput.addEventListener("change", async () => {
  await uploadProjectFiles([...els.projectFileInput.files]);
  els.projectFileInput.value = "";
});
els.fileSearch.addEventListener("input", () => {
  state.fileFilter = els.fileSearch.value;
  renderFileGrid();
});
els.railToggle.addEventListener("click", () => {
  state.railOpen = !state.railOpen;
  renderProjectRail();
});
els.railClose.addEventListener("click", () => {
  state.railOpen = false;
  if (window.matchMedia("(max-width: 1100px)").matches) els.rail.hidden = true;
});
els.composerProject.addEventListener("click", () => {
  if (!state.project) return;
  state.railOpen = true;
  renderProjectRail();
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
  renderSidebarList();
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
  await loadProjects();
  els.web.checked = state.web;
  els.imageAspect.value = state.imageAspect;
  syncToolbar();
  renderThread();
  els.prompt.focus();
})();
