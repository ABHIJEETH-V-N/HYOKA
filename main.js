'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var obsidian = require('obsidian');

var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var VIEW_CHAT = "hyoka-chat-view";
var VIEW_PREVIEW = "hyoka-preview-view";
var VIEW_SLIDES = "hyoka-slides-view";
var AGENT_MEMORY_ROOT = "agent-memory";
var WEBSITE_SYSTEM_PROMPT = 'You are a high-performance frontend generator. You write a single self-contained HTML5 file. Use Tailwind via the CDN script tag (<script src="https://cdn.tailwindcss.com"></script>) and Tailwind utility classes for ALL styling. Do not write a separate <style> block unless absolutely necessary. Inline any needed <script>. Respond with ONLY the raw HTML, starting at <!DOCTYPE html> \u2014 no markdown code fences, no commentary, no opinions. If you need a placeholder image, use an <img> pointing at https://picsum.photos/seed/<short-slug>/<width>/<height> Make it visually polished, responsive, and clean.';
function freshProfile(name = "Agent") {
  return {
    id: `profile-${Date.now()}`,
    name,
    apiUrl: "http://127.0.0.1:8080/v1",
    modelName: "gemma-4",
    apiKey: "",
    systemPrompt: "You are an autonomous engineering agent operating directly inside the user's Obsidian vault. Execute commands, write robust code, and do not provide conversational filler. Call tools to accomplish tasks.",
    temperature: 0.1,
    maxContextTokens: 128e3
  };
}
var DEFAULT_SETTINGS = {
  profiles: [
    {
      id: "sys-core",
      name: "Core",
      apiUrl: "http://127.0.0.1:8080/v1",
      modelName: "gemma-4",
      apiKey: "",
      systemPrompt: "You are an autonomous systems engineering agent. You build robust code using your tools. Never describe what you would do \u2014 call the tool. Keep prose terse.",
      temperature: 0.1,
      maxContextTokens: 128e3
    }
  ],
  activeProfileId: "sys-core",
  scraperUrl: "",
  scraperApiKey: "",
  autoApproveCommands: false,
  enableWebSearch: true,
  enableImageLookup: true,
  hyperizedMode: false
};
var McpToolRegistry = class {
  static getCapabilities(plugin) {
    const tools = [
      {
        name: "create_note",
        description: "Creates or overwrites a file in the vault (markdown, code, or text file) with the given content.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Full vault-relative path including extension." },
            content: { type: "string" }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "edit_note",
        description: "Performs a precise find-and-replace patch on an existing file.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } },
          required: ["path", "find", "replace"]
        }
      },
      {
        name: "read_note",
        description: "Reads the content of an existing file in the vault.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
      },
      {
        name: "list_files",
        description: "Lists files under a given vault folder, recursively.",
        inputSchema: { type: "object", properties: { folder: { type: "string" } }, required: ["folder"] }
      },
      {
        name: "run_command",
        description: "Executes a local shell command (e.g. 'cargo build', 'npm run dev'). Executes in the vault root unless cwd is provided.",
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" }, cwd: { type: "string", description: "Relative directory path (optional)" } },
          required: ["command"]
        }
      }
    ];
    if (plugin.settings.enableWebSearch) {
      tools.push({
        name: "search_web",
        description: "Searches the internet. Fails gracefully if offline.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
      });
    }
    if (plugin.settings.scraperUrl) {
      tools.push({
        name: "scrape_web",
        description: "Uses the configured local web scraper to fetch JS-rendered URL content.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" }, selector: { type: "string" } },
          required: ["url"]
        }
      });
    }
    return tools;
  }
  static asOpenAiTools(plugin) {
    return this.getCapabilities(plugin).map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema }
    }));
  }
  static async executeTool(name, args, plugin) {
    try {
      const vault = plugin.app.vault;
      if (name === "create_note") {
        await ensureParentFolders(plugin, args.path);
        if (await vault.adapter.exists(args.path)) {
          await vault.adapter.write(args.path, args.content);
          plugin.notifyLiveUpdate(args.path);
          return `Updated existing file: ${args.path}`;
        }
        await vault.create(args.path, args.content);
        plugin.notifyLiveUpdate(args.path);
        return `Created file: ${args.path}`;
      }
      if (name === "edit_note") {
        if (!await vault.adapter.exists(args.path)) return `Error: file not found at ${args.path}`;
        const current = await vault.adapter.read(args.path);
        if (!current.includes(args.find)) return `Error: 'find' text not found in ${args.path}.`;
        await vault.adapter.write(args.path, current.replace(args.find, args.replace));
        plugin.notifyLiveUpdate(args.path);
        return `Patched ${args.path}`;
      }
      if (name === "read_note") {
        if (!await vault.adapter.exists(args.path)) return `Error: file not found at ${args.path}`;
        return `[CONTENT OF ${args.path}]:
${await vault.adapter.read(args.path)}`;
      }
      if (name === "list_files") {
        const folder = args.folder || "";
        const all = vault.getFiles().map((f) => f.path).filter((p) => p.startsWith(folder));
        return all.length ? all.join("\n") : `No files under ${folder || "(root)"}`;
      }
      if (name === "run_command") return await plugin.commandRunner.request(args.command, args.cwd);
      if (name === "search_web") {
        try {
          const res = await obsidian.requestUrl({ url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`, method: "GET" });
          const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          const strip = (s) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          const titles = [];
          let m;
          while ((m = linkRe.exec(res.text)) !== null && titles.length < 5) titles.push(strip(m[2]));
          const snippets = [];
          while ((m = snippetRe.exec(res.text)) !== null && snippets.length < 5) snippets.push(strip(m[1]));
          if (titles.length === 0) return `No web results found.`;
          return titles.map((t, i) => `${i + 1}. ${t}
   ${snippets[i] || ""}`).join("\n");
        } catch (e) {
          return `Network error: Offline or unreachable. Proceed without web data.`;
        }
      }
      if (name === "scrape_web") {
        try {
          const res = await obsidian.requestUrl({
            url: plugin.settings.scraperUrl,
            method: "POST",
            contentType: "application/json",
            headers: plugin.settings.scraperApiKey ? { "Authorization": `Bearer ${plugin.settings.scraperApiKey}` } : void 0,
            body: JSON.stringify({ url: args.url, selector: args.selector || null })
          });
          return `[SCRAPED CONTENT FROM ${args.url}]:
${res.text.substring(0, 15e3)}`;
        } catch (e) {
          return `Scraper offline or unreachable.`;
        }
      }
      throw new Error(`Unregistered tool: ${name}`);
    } catch (e) {
      return `Tool execution failed: ${e.message}`;
    }
  }
};
async function ensureParentFolders(plugin, path) {
  const parts = path.split("/").slice(0, -1);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!await plugin.app.vault.adapter.exists(acc)) await plugin.app.vault.createFolder(acc);
  }
}
var CommandRunner = class {
  plugin;
  constructor(plugin) {
    this.plugin = plugin;
  }
  async request(command, cwd) {
    if (!this.plugin.settings.autoApproveCommands) {
      const approved = await new Promise((resolve) => new CommandConfirmModal(this.plugin.app, command, cwd || "Vault Root", resolve).open());
      if (!approved) return `User declined to run: ${command}`;
    }
    return this.execute(command, cwd);
  }
  execute(command, relativeCwd) {
    return new Promise((resolve) => {
      try {
        const { exec } = __require("child_process");
        const adapter = this.plugin.app.vault.adapter;
        const basePath = adapter.getBasePath ? adapter.getBasePath() : "";
        let targetCwd = basePath;
        if (relativeCwd && basePath) targetCwd = `${basePath}/${relativeCwd}`;
        exec(command, { cwd: targetCwd, timeout: 6e4, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve(err ? `Error.
STDOUT:
${stdout}
STDERR:
${stderr || err.message}` : `Success.
STDOUT:
${stdout}${stderr ? `
STDERR:
${stderr}` : ""}`);
        });
      } catch (e) {
        resolve(`Execution environment unavailable: ${e.message}`);
      }
    });
  }
};
var CommandConfirmModal = class extends obsidian.Modal {
  constructor(app, command, cwd, cb) {
    super(app);
    this.command = command;
    this.cwd = cwd;
    this.cb = cb;
  }
  command;
  cwd;
  cb;
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "SYS_EXEC", attr: { style: "font-family: var(--font-monospace); color: var(--text-normal); font-weight: normal; margin-bottom: 4px;" } });
    contentEl.createEl("div", { text: `cwd: ${this.cwd}`, attr: { style: "font-size: 0.8em; font-family: var(--font-monospace); color: var(--text-muted); margin-bottom: 12px;" } });
    contentEl.createEl("div", { text: this.command, attr: { style: "background:var(--background-secondary); border: 1px solid var(--background-modifier-border); padding:10px; font-family: var(--font-monospace); font-size: 0.9em;" } });
    const row = contentEl.createEl("div", { attr: { style: "display:flex; gap:8px; justify-content:flex-end; margin-top:16px;" } });
    const denyBtn = row.createEl("button", { cls: "hyoka-btn-flat" });
    obsidian.setIcon(denyBtn, "x");
    denyBtn.appendChild(document.createTextNode(" Deny"));
    denyBtn.onclick = () => {
      this.cb(false);
      this.close();
    };
    const runBtn = row.createEl("button", { cls: "hyoka-btn-flat" });
    runBtn.style.color = "var(--text-normal)";
    runBtn.style.borderColor = "var(--text-normal)";
    obsidian.setIcon(runBtn, "play");
    runBtn.appendChild(document.createTextNode(" Exec"));
    runBtn.onclick = () => {
      this.cb(true);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var HyokaPlugin = class extends obsidian.Plugin {
  settings;
  commandRunner;
  async onload() {
    await this.loadSettings();
    this.commandRunner = new CommandRunner(this);
    await this.initializeMemoryFolders();
    this.injectStyles();
    this.registerView(VIEW_CHAT, (leaf) => new HyokaChatView(leaf, this));
    this.registerView(VIEW_PREVIEW, (leaf) => new HyokaPreviewView(leaf, this));
    this.registerView(VIEW_SLIDES, (leaf) => new HyokaSlideView(leaf, this));
    this.addRibbonIcon("terminal-square", "SYS_CTRL", () => this.activateChatView());
    this.addSettingTab(new HyokaSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  getActiveProfile() {
    return this.settings.profiles.find((p) => p.id === this.settings.activeProfileId) || this.settings.profiles[0];
  }
  async initializeMemoryFolders() {
    if (!await this.app.vault.adapter.exists(AGENT_MEMORY_ROOT)) await this.app.vault.createFolder(AGENT_MEMORY_ROOT);
    for (const profile of this.settings.profiles) {
      const dir = `${AGENT_MEMORY_ROOT}/${profile.id}`;
      if (!await this.app.vault.adapter.exists(dir)) await this.app.vault.createFolder(dir);
      const hist = `${dir}/session_history.json`;
      if (!await this.app.vault.adapter.exists(hist)) await this.app.vault.create(hist, JSON.stringify([]));
    }
  }
  injectStyles() {
    const id = "hyoka-minimal-ux";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = `
            /* Monolithic Minimal Aesthetics */
            .hyoka-card { background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 2px; padding: 16px; margin-bottom: 16px; font-family: var(--font-monospace); }
            
            .hyoka-btn-icon { background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; transition: color 0.15s ease; }
            .hyoka-btn-icon:hover { color: var(--text-normal); }
            
            .hyoka-btn-flat { background: transparent; border: 1px solid var(--background-modifier-border); color: var(--text-muted); padding: 4px 10px; border-radius: 2px; cursor: pointer; font-size: 0.8em; font-family: var(--font-monospace); display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; }
            .hyoka-btn-flat:hover { color: var(--text-normal); border-color: var(--text-muted); }
            
            /* Chat Interface Elements */
            .hyoka-ctx-bar-track { height: 1px; background: var(--background-modifier-border); width: 100%; margin-top: 4px; }
            .hyoka-ctx-bar-fill { height: 100%; background: var(--text-normal); transition: width 0.3s ease; }
            
            .hyoka-chip { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--background-modifier-border); border-radius:2px; padding:2px 8px; font-size:0.75em; font-family: var(--font-monospace); color: var(--text-muted); }
            .hyoka-chip .x { cursor:pointer; opacity:0.5; }
            .hyoka-chip .x:hover { opacity:1; color:var(--text-error); }
            
            /* Copy Buttons */
            .hyoka-msg-copy { position:absolute; top:6px; right:6px; font-size:0.7em; padding:4px 8px; border-radius:2px; border:1px solid transparent; background:transparent; color: var(--text-muted); cursor:pointer; opacity:0; transition: all 0.15s ease; font-family: var(--font-monospace); display: flex; align-items: center; gap: 4px; }
            .hyoka-msg-hover-container:hover .hyoka-msg-copy { opacity:1; }
            .hyoka-msg-copy:hover { border-color: var(--background-modifier-border); color: var(--text-normal); }

            /* Select Dropdown */
            .hyoka-select { background: transparent; border: none; border-bottom: 1px solid var(--background-modifier-border); color: var(--text-normal); padding: 4px 0; border-radius: 0; font-family: var(--font-monospace); font-size: 0.85em; outline: none; cursor: pointer; width: 100%; }
            .hyoka-select:focus { border-color: var(--text-normal); }

            /* Webpage View Toolbar */
            .hyoka-web-toolbar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-primary); }
            .hyoka-web-select { flex: 1; background: transparent; border: none; font-family: var(--font-monospace); color: var(--text-normal); font-size: 0.9em; outline: none; }
        `;
    document.head.appendChild(el);
  }
  async activateChatView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_CHAT)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_CHAT, active: true });
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }
  refreshChatViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_CHAT)) {
      leaf.view.refreshProfileSelector();
    }
  }
  notifyLiveUpdate(path) {
    this.app.workspace.trigger("hyoka:file-updated", path);
  }
  async callModelOnce(profile, messages) {
    var _a, _b, _c;
    const headers = { "Content-Type": "application/json" };
    if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
    const res = await obsidian.requestUrl({
      url: `${profile.apiUrl}/chat/completions`,
      method: "POST",
      headers,
      body: JSON.stringify({ model: profile.modelName, messages, temperature: 0.1, stream: false })
    });
    const data = JSON.parse(res.text);
    return ((_c = (_b = (_a = data == null ? void 0 : data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) || "";
  }
  estimateTokens(text) {
    return Math.ceil((text || "").length / 4);
  }
};
var FilePickerModal = class extends obsidian.FuzzySuggestModal {
  constructor(app, exclude, onPick) {
    super(app);
    this.exclude = exclude;
    this.onPick = onPick;
  }
  exclude;
  onPick;
  getItems() {
    const excl = new Set(this.exclude.map((f) => f.path));
    return this.app.vault.getFiles().filter((f) => !excl.has(f.path));
  }
  getItemText(item) {
    return item.path;
  }
  onChooseItem(item) {
    this.onPick([item]);
  }
};
var HyokaPreviewView = class extends obsidian.ItemView {
  plugin;
  iframe;
  fileSelect;
  targetPath = "";
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_PREVIEW;
  }
  getDisplayText() {
    return "RENDER";
  }
  getIcon() {
    return "layout-template";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.style.padding = "0";
    container.style.overflow = "hidden";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    const toolbar = container.createEl("div", { cls: "hyoka-web-toolbar" });
    const refreshBtn = toolbar.createEl("button", { cls: "hyoka-btn-icon" });
    obsidian.setIcon(refreshBtn, "refresh-cw");
    refreshBtn.onclick = () => this.refreshFileList(this.targetPath);
    this.fileSelect = toolbar.createEl("select", { cls: "hyoka-web-select" });
    this.fileSelect.onchange = () => {
      this.targetPath = this.fileSelect.value;
      this.reload();
    };
    this.iframe = container.createEl("iframe", { attr: { style: "width:100%; flex-grow:1; border:none; background:white;", sandbox: "allow-scripts allow-modals allow-forms allow-popups" } });
    this.refreshFileList();
    this.registerEvent(this.app.vault.on("create", () => this.refreshFileList(this.targetPath)));
    this.registerEvent(this.app.vault.on("delete", () => this.refreshFileList()));
    this.registerEvent(this.app.vault.on("rename", () => this.refreshFileList()));
    this.registerEvent(this.app.vault.on("modify", async (file) => {
      if (file instanceof obsidian.TFile && file.path === this.targetPath) await this.reload();
    }));
    this.registerEvent(this.app.workspace.on("hyoka:file-updated", async (path) => {
      if (path.endsWith(".html")) this.refreshFileList(path);
      if (path === this.targetPath) await this.reload();
    }));
  }
  refreshFileList(forceSelectPath) {
    const htmlFiles = this.app.vault.getFiles().filter((f) => f.extension === "html");
    this.fileSelect.empty();
    if (htmlFiles.length === 0) {
      this.fileSelect.createEl("option", { text: "No .html files in vault", attr: { value: "" } });
      this.targetPath = "";
      this.reload();
      return;
    }
    htmlFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
    let selectedMatched = false;
    htmlFiles.forEach((f) => {
      const opt = this.fileSelect.createEl("option", { text: f.path, attr: { value: f.path } });
      if (forceSelectPath && f.path === forceSelectPath) {
        opt.selected = true;
        selectedMatched = true;
        this.targetPath = f.path;
      }
    });
    if (!selectedMatched && htmlFiles.length > 0) {
      if (!htmlFiles.find((f) => f.path === this.targetPath)) {
        this.targetPath = htmlFiles[0].path;
        this.fileSelect.value = this.targetPath;
      } else {
        this.fileSelect.value = this.targetPath;
      }
    }
    this.reload();
  }
  setTarget(path) {
    this.refreshFileList(path);
  }
  injectHtmlStream(html) {
    this.iframe.srcdoc = html;
  }
  async reload() {
    if (!this.targetPath) {
      this.iframe.srcdoc = `<body style="font-family:monospace;padding:2em;color:#666;background:#111;">NO TARGET SELECTED</body>`;
      return;
    }
    try {
      if (!await this.app.vault.adapter.exists(this.targetPath)) return;
      this.iframe.srcdoc = await this.app.vault.adapter.read(this.targetPath);
    } catch (e) {
    }
  }
};
var HyokaSlideView = class extends obsidian.ItemView {
  plugin;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_SLIDES;
  }
  getDisplayText() {
    return "SLIDES";
  }
  getIcon() {
    return "presentation";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    const stage = container.createEl("div", { attr: { style: "width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-family:monospace; color:var(--text-muted);" } });
    stage.setText("Slide deck compiler ready.");
  }
};
var HyokaChatView = class extends obsidian.ItemView {
  plugin;
  chatHistory = [];
  attachedFiles = [];
  messageContainer;
  inputField;
  profileSelector;
  attachRow;
  ctxFill;
  ctxLabel;
  lifecycle;
  isExecuting = false;
  abortController = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.lifecycle = new obsidian.Component();
  }
  getViewType() {
    return VIEW_CHAT;
  }
  getDisplayText() {
    return "SYS_CTRL";
  }
  getIcon() {
    return "terminal";
  }
  async onOpen() {
    this.lifecycle.load();
    await this.loadHistory();
    const container = this.containerEl.children[1];
    container.empty();
    const wrapper = container.createEl("div", { attr: { style: "display:flex; flex-direction:column; height:100%; padding:16px; font-family: var(--font-monospace); background: var(--background-primary);" } });
    const headerTop = wrapper.createEl("div", { attr: { style: "display:flex; gap:16px; align-items:center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px; margin-bottom: 12px;" } });
    const identityDiv = headerTop.createEl("div", { attr: { style: "display:flex; align-items:center; gap: 8px; flex: 1;" } });
    obsidian.setIcon(identityDiv.createEl("span", { attr: { style: "color: var(--text-muted); display: flex;" } }), "cpu");
    this.profileSelector = identityDiv.createEl("select", { cls: "hyoka-select" });
    this.refreshProfileSelector();
    this.profileSelector.addEventListener("change", async () => {
      this.plugin.settings.activeProfileId = this.profileSelector.value;
      await this.plugin.saveSettings();
      this.updateContextBar();
    });
    const quickActions = headerTop.createEl("div", { attr: { style: "display:flex; gap:8px;" } });
    const btnWeb = quickActions.createEl("button", { cls: "hyoka-btn-icon" });
    obsidian.setIcon(btnWeb, "globe");
    btnWeb.onclick = () => this.runTurn("Build a responsive webpage for a modern landing page.");
    const btnSvg = quickActions.createEl("button", { cls: "hyoka-btn-icon" });
    obsidian.setIcon(btnSvg, "image");
    btnSvg.onclick = () => {
      this.inputField.value = "Design a clean SVG logo. Respond ONLY with raw <svg>...</svg> markup.";
      this.inputField.focus();
    };
    const btnStop = quickActions.createEl("button", { cls: "hyoka-btn-icon" });
    obsidian.setIcon(btnStop, "square");
    btnStop.onclick = () => {
      if (this.abortController && this.isExecuting) {
        this.abortController.abort();
        new obsidian.Notice("SIGINT SENT.");
      }
    };
    const btnClear = quickActions.createEl("button", { cls: "hyoka-btn-icon" });
    obsidian.setIcon(btnClear, "rotate-ccw");
    btnClear.onclick = () => {
      this.chatHistory = [{ role: "system", content: this.getSystemPrompt() }];
      this.saveHistory();
      this.renderMessages();
    };
    this.messageContainer = wrapper.createEl("div", { attr: { style: "flex-grow:1; overflow-y:auto; display:flex; flex-direction:column; gap:20px; padding-right:8px; margin-bottom: 12px;" } });
    const ctxWrap = wrapper.createEl("div", { attr: { style: "display:flex; flex-direction:column; margin-bottom: 12px;" } });
    this.ctxLabel = ctxWrap.createEl("div", { text: "MEM 0%", attr: { style: "font-size:0.75em; color:var(--text-muted); align-self: flex-end;" } });
    const track = ctxWrap.createEl("div", { cls: "hyoka-ctx-bar-track" });
    this.ctxFill = track.createEl("div", { cls: "hyoka-ctx-bar-fill" });
    this.updateContextBar();
    this.attachRow = wrapper.createEl("div", { attr: { style: "display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom: 8px;" } });
    this.renderAttachments();
    const inputArea = wrapper.createEl("div", { attr: { style: "display:flex; flex-direction:column; gap:6px;" } });
    const attachBtn = inputArea.createEl("button", { cls: "hyoka-btn-flat", attr: { style: "align-self: flex-start; padding: 2px 6px; font-size: 0.75em;" } });
    obsidian.setIcon(attachBtn, "paperclip");
    attachBtn.appendChild(document.createTextNode(" File"));
    attachBtn.onclick = () => new FilePickerModal(this.app, this.attachedFiles, (files) => {
      this.attachedFiles.push(...files);
      this.renderAttachments();
    }).open();
    const inputRow = inputArea.createEl("div", { attr: { style: "display:flex; gap:8px; align-items:flex-end;" } });
    this.inputField = inputRow.createEl("textarea", {
      attr: { placeholder: "INPUT...", rows: "1", style: "flex-grow:1; resize:none; border: none; border-bottom: 1px solid var(--background-modifier-border); border-radius: 0; padding:8px 0; background:transparent; font-family:var(--font-monospace); font-size:0.9em; outline: none;" }
    });
    this.inputField.addEventListener("input", () => {
      this.inputField.style.height = "auto";
      this.inputField.style.height = Math.min(this.inputField.scrollHeight, 120) + "px";
    });
    const execBtn = inputRow.createEl("button", { cls: "hyoka-btn-icon", attr: { style: "padding: 8px;" } });
    obsidian.setIcon(execBtn, "play");
    execBtn.style.color = "var(--text-normal)";
    execBtn.onclick = () => {
      if (!this.isExecuting) this.runTurn(this.inputField.value.trim());
    };
    this.inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!this.isExecuting) this.runTurn(this.inputField.value.trim());
      }
    });
    this.renderMessages();
  }
  getSystemPrompt() {
    const profile = this.plugin.getActiveProfile();
    let prompt = profile.systemPrompt;
    if (this.plugin.settings.hyperizedMode) {
      prompt += "\n\n[SYS_OVR: HYPERIZED MODE ACTIVE. When generating markdown responses, freely embed interactive HTML, CSS, and Tailwind directly within the markdown to construct highly advanced, visually rich notes.]";
    }
    return prompt;
  }
  renderAttachments() {
    this.attachRow.empty();
    for (const file of this.attachedFiles) {
      const chip = this.attachRow.createEl("span", { cls: "hyoka-chip" });
      chip.createEl("span", { text: file.basename });
      const x = chip.createEl("span", { cls: "x" });
      obsidian.setIcon(x, "x");
      x.onclick = () => {
        this.attachedFiles = this.attachedFiles.filter((f) => f !== file);
        this.renderAttachments();
      };
    }
  }
  async buildAttachmentContext() {
    if (this.attachedFiles.length === 0) return "";
    let out = "[INJECTED FILE CONTEXT]\n";
    for (const f of this.attachedFiles) {
      const content = await this.plugin.app.vault.read(f);
      out += `
--- ${f.path} ---
${content}
`;
    }
    return out;
  }
  refreshProfileSelector() {
    this.profileSelector.empty();
    this.plugin.settings.profiles.forEach((p) => {
      const opt = this.profileSelector.createEl("option", { text: p.name, attr: { value: p.id } });
      if (p.id === this.plugin.settings.activeProfileId) opt.setAttribute("selected", "selected");
    });
  }
  updateContextBar() {
    const profile = this.plugin.getActiveProfile();
    const used = this.plugin.estimateTokens(this.chatHistory.map((m) => m.content || "").join("\n"));
    const max = profile.maxContextTokens || 128e3;
    const pct = Math.min(100, Math.round(used / max * 100));
    this.ctxLabel.setText(`MEM ${pct}% [${used.toLocaleString()}/${max.toLocaleString()}]`);
    this.ctxFill.style.width = `${pct}%`;
    this.ctxFill.style.background = pct > 85 ? "var(--text-error)" : pct > 60 ? "var(--text-warning)" : "var(--text-normal)";
  }
  historyPath() {
    const profile = this.plugin.getActiveProfile();
    return `${AGENT_MEMORY_ROOT}/${profile.id}/session_history.json`;
  }
  async loadHistory() {
    const path = this.historyPath();
    try {
      if (await this.plugin.app.vault.adapter.exists(path)) {
        const parsed = JSON.parse(await this.plugin.app.vault.adapter.read(path));
        this.chatHistory = parsed.length ? parsed : [{ role: "system", content: this.getSystemPrompt() }];
      } else {
        this.chatHistory = [{ role: "system", content: this.getSystemPrompt() }];
      }
    } catch {
      this.chatHistory = [{ role: "system", content: this.getSystemPrompt() }];
    }
  }
  async saveHistory() {
    this.chatHistory[0].content = this.getSystemPrompt();
    await this.plugin.app.vault.adapter.write(this.historyPath(), JSON.stringify(this.chatHistory, null, 2));
  }
  async renderMessages() {
    if (!this.messageContainer) return;
    this.messageContainer.empty();
    for (let i = 1; i < this.chatHistory.length; i++) {
      const msg = this.chatHistory[i];
      if (msg.role === "system" || msg.role === "tool" || msg.tool_calls) continue;
      const isUser = msg.role === "user";
      const wrapperDiv = this.messageContainer.createEl("div", { cls: "hyoka-msg-hover-container", attr: { style: "position: relative; display: flex; flex-direction: column;" } });
      const div = wrapperDiv.createEl("div", {
        attr: { style: `padding-bottom:12px; font-size: 0.9em; ${isUser ? "align-self:flex-end; text-align: right; border-right: 1px solid var(--text-normal); padding-right: 12px;" : "align-self:flex-start; text-align: left; border-left: 1px solid var(--background-modifier-border); padding-left: 12px;"}` }
      });
      const copyBtn = wrapperDiv.createEl("button", { cls: "hyoka-msg-copy" });
      obsidian.setIcon(copyBtn, "copy");
      copyBtn.appendChild(document.createTextNode(" CPY"));
      if (isUser) {
        copyBtn.style.right = "16px";
        copyBtn.style.top = "-8px";
      } else {
        copyBtn.style.left = "16px";
        copyBtn.style.right = "auto";
        copyBtn.style.top = "-8px";
      }
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(msg.content || "");
        copyBtn.innerHTML = "";
        obsidian.setIcon(copyBtn, "check");
        copyBtn.appendChild(document.createTextNode(" OK"));
        setTimeout(() => {
          copyBtn.innerHTML = "";
          obsidian.setIcon(copyBtn, "copy");
          copyBtn.appendChild(document.createTextNode(" CPY"));
        }, 1500);
        new obsidian.Notice("COPIED");
      };
      div.createEl("div", { text: isUser ? "USR" : `SYS`, attr: { style: "font-size:0.7em; color:var(--text-muted); margin-bottom:6px;" } });
      const body = div.createEl("div", { cls: "markdown-rendered" });
      await obsidian.MarkdownRenderer.renderMarkdown(msg.content || "", body, "", this.lifecycle);
    }
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    this.updateContextBar();
  }
  async runTurn(text) {
    const attachmentContext = await this.buildAttachmentContext();
    if (text) {
      this.inputField.value = "";
      this.inputField.style.height = "auto";
      const full = attachmentContext ? `${attachmentContext}

${text}` : text;
      this.chatHistory.push({ role: "user", content: full });
      await this.renderMessages();
    }
    if (text && /\b(website|ui|html|frontend)\b/i.test(text)) {
      await this.buildWebsiteLive(text);
      return;
    }
    await this.runAgentLoop();
  }
  generateSlug(prompt) {
    const base = prompt.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").slice(0, 15).toLowerCase().replace(/^-|-$/g, "");
    return `ui-${base || "gen"}-${Math.floor(Date.now() / 1e3).toString().slice(-4)}.html`;
  }
  async buildWebsiteLive(prompt) {
    var _a;
    this.isExecuting = true;
    this.abortController = new AbortController();
    const profile = this.plugin.getActiveProfile();
    const filename = this.generateSlug(prompt);
    const targetPath = filename;
    const previewLeaf = this.app.workspace.getLeavesOfType(VIEW_PREVIEW)[0] || this.app.workspace.getRightLeaf(true);
    if (previewLeaf) {
      await previewLeaf.setViewState({ type: VIEW_PREVIEW, active: true });
      this.app.workspace.revealLeaf(previewLeaf);
      previewLeaf.view.setTarget(targetPath);
    }
    const loadingIndex = this.chatHistory.push({ role: "assistant", content: "" }) - 1;
    await this.renderMessages();
    const msgDiv = (_a = this.messageContainer.lastElementChild) == null ? void 0 : _a.querySelector("div:last-child");
    if (msgDiv) {
      msgDiv.empty();
      msgDiv.createEl("div", { text: `SYS // UI PIPELINE -> ${filename}`, attr: { style: "font-size:0.7em; color:var(--text-normal); margin-bottom:6px;" } });
    }
    const mainContent = msgDiv == null ? void 0 : msgDiv.createEl("div", { attr: { style: "font-size:0.85em; color:var(--text-muted);" }, text: "Streaming..." });
    try {
      const headers = { "Content-Type": "application/json" };
      if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
      const messages = [
        { role: "system", content: WEBSITE_SYSTEM_PROMPT },
        ...this.chatHistory.slice(1, -1).filter((m) => m.role === "user" || m.role === "assistant").filter((m) => m.content),
        { role: "user", content: prompt }
      ];
      const response = await fetch(`${profile.apiUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: this.abortController.signal,
        body: JSON.stringify({ model: profile.modelName, messages, temperature: 0.1, stream: true })
      });
      if (!response.body) throw new Error("No stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let raw = "";
      const view = previewLeaf == null ? void 0 : previewLeaf.view;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n").filter((l) => l.trim())) {
          if (!line.startsWith("data: ")) continue;
          if (line.slice(6).trim() === "[DONE]") continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices[0].delta;
            if (delta.content) {
              raw += delta.content;
              const cleanHtml = raw.replace(/```html/gi, "").replace(/```/g, "");
              if (view) view.injectHtmlStream(cleanHtml);
              if (mainContent) mainContent.setText(`Compiled bytes: ${raw.length}`);
            }
          } catch {
          }
        }
      }
      const finalHtml = raw.replace(/```html/gi, "").replace(/```/g, "").trim();
      await ensureParentFolders(this.plugin, targetPath);
      await this.plugin.app.vault.adapter.write(targetPath, finalHtml);
      if (mainContent) mainContent.setText(`UI written to ${targetPath}.`);
      this.chatHistory[loadingIndex].content = `UI compiled to \`${targetPath}\`.`;
    } catch (err) {
      if (err.name !== "AbortError") this.chatHistory[loadingIndex].content = `Pipeline failure: ${err.message}`;
    }
    await this.saveHistory();
    await this.renderMessages();
    this.isExecuting = false;
  }
  async runAgentLoop() {
    var _a, _b, _c;
    this.isExecuting = true;
    this.abortController = new AbortController();
    const profile = this.plugin.getActiveProfile();
    let iterations = 0;
    const MAX_ITER = 7;
    while (iterations < MAX_ITER) {
      iterations++;
      const loadingIndex = this.chatHistory.push({ role: "assistant", content: "" }) - 1;
      await this.renderMessages();
      const msgDiv = (_a = this.messageContainer.lastElementChild) == null ? void 0 : _a.querySelector("div:last-child");
      if (msgDiv) {
        msgDiv.empty();
        msgDiv.createEl("div", { text: `SYS`, attr: { style: "font-size:0.7em; color:var(--text-muted); margin-bottom:6px;" } });
      }
      const processLog = msgDiv == null ? void 0 : msgDiv.createEl("div", { attr: { style: "font-size: 0.75em; color: var(--text-normal); margin-bottom: 8px;" } });
      const mainContent = msgDiv == null ? void 0 : msgDiv.createEl("div", { cls: "markdown-rendered" });
      let fullContent = "";
      let toolCall = null;
      try {
        const headers = { "Content-Type": "application/json" };
        if (profile.apiKey) headers["Authorization"] = `Bearer ${profile.apiKey}`;
        const response = await fetch(`${profile.apiUrl}/chat/completions`, {
          method: "POST",
          headers,
          signal: this.abortController.signal,
          body: JSON.stringify({
            model: profile.modelName,
            messages: this.chatHistory.slice(0, -1).filter((m) => m.content !== ""),
            temperature: profile.temperature,
            stream: true,
            tools: McpToolRegistry.asOpenAiTools(this.plugin)
          })
        });
        if (!response.body) throw new Error("Stream failed.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n").filter((l) => l.trim())) {
            if (!line.startsWith("data: ")) continue;
            if (line.slice(6).trim() === "[DONE]") continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const delta = parsed.choices[0].delta;
              if (delta.tool_calls) {
                if (!toolCall) toolCall = { id: "", function: { name: "", arguments: "" } };
                const call = delta.tool_calls[0];
                if (call.id) toolCall.id += call.id;
                if ((_b = call.function) == null ? void 0 : _b.name) toolCall.function.name += call.function.name;
                if ((_c = call.function) == null ? void 0 : _c.arguments) toolCall.function.arguments += call.function.arguments;
                if (processLog) processLog.setText(`EXEC: ${toolCall.function.name}...`);
                continue;
              }
              if (delta.content) {
                fullContent += delta.content;
                if (mainContent) {
                  mainContent.empty();
                  await obsidian.MarkdownRenderer.renderMarkdown(fullContent, mainContent, "", this.lifecycle);
                }
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
              }
            } catch {
            }
          }
        }
      } catch (err) {
        if (err.name === "AbortError") {
          this.isExecuting = false;
          return;
        }
        if (mainContent) mainContent.setText(`ERR: ${err.message}`);
        this.chatHistory[loadingIndex].content = `ERR: ${err.message}`;
        break;
      }
      if (toolCall && toolCall.function.name) {
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
        }
        this.chatHistory.splice(this.chatHistory.length - 1, 0, { role: "assistant", content: null, tool_calls: [{ id: toolCall.id, type: "function", function: toolCall.function }] });
        const result = await McpToolRegistry.executeTool(toolCall.function.name, args, this.plugin);
        this.chatHistory.splice(this.chatHistory.length - 1, 0, { role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: result });
        await this.saveHistory();
        continue;
      } else {
        this.chatHistory[loadingIndex].content = fullContent;
        await this.saveHistory();
        this.updateContextBar();
        break;
      }
    }
    this.isExecuting = false;
  }
};
var HyokaSettingTab = class extends obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "SYS_CFG", attr: { style: "font-family: var(--font-monospace); font-weight: normal; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px;" } });
    new obsidian.Setting(containerEl).setName("HYPERIZED MODE").setDesc("Allows AI to directly inject interactive HTML/CSS/JS into markdown outputs.").addToggle((t) => t.setValue(this.plugin.settings.hyperizedMode).onChange(async (v) => {
      this.plugin.settings.hyperizedMode = v;
      await this.plugin.saveSettings();
    }));
    const profilesHeader = containerEl.createEl("div", { attr: { style: "display:flex; justify-content:space-between; align-items:center; margin-top: 32px; margin-bottom: 16px;" } });
    profilesHeader.createEl("div", { text: "PROFILES", attr: { style: "font-family: var(--font-monospace); color: var(--text-muted);" } });
    const addBtn = profilesHeader.createEl("button", { cls: "hyoka-btn-flat" });
    obsidian.setIcon(addBtn, "plus");
    addBtn.onclick = async () => {
      this.plugin.settings.profiles.push(freshProfile());
      await this.plugin.saveSettings();
      this.plugin.refreshChatViews();
      this.display();
    };
    this.plugin.settings.profiles.forEach((profile) => {
      const card = containerEl.createEl("div", { cls: "hyoka-card" });
      const cardHeader = card.createEl("div", { attr: { style: "display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px; margin-bottom: 12px;" } });
      const titleRow = cardHeader.createEl("div", { attr: { style: "display:flex; align-items:center; gap:8px;" } });
      obsidian.setIcon(titleRow.createEl("span"), "cpu");
      titleRow.createEl("span", { text: profile.name });
      const canDelete = this.plugin.settings.profiles.length > 1;
      const delBtn = cardHeader.createEl("button", { cls: "hyoka-btn-icon", attr: { style: canDelete ? "" : "opacity:0.2; cursor:not-allowed;" } });
      obsidian.setIcon(delBtn, "trash-2");
      delBtn.onclick = async () => {
        if (!canDelete) return;
        this.plugin.settings.profiles = this.plugin.settings.profiles.filter((p) => p.id !== profile.id);
        if (this.plugin.settings.activeProfileId === profile.id) this.plugin.settings.activeProfileId = this.plugin.settings.profiles[0].id;
        await this.plugin.saveSettings();
        this.plugin.refreshChatViews();
        this.display();
      };
      new obsidian.Setting(card).setName("ID").addText((t) => t.setValue(profile.name).onChange(async (v) => {
        profile.name = v;
        await this.plugin.saveSettings();
        this.plugin.refreshChatViews();
        titleRow.querySelector("span:last-child").setText(v);
      }));
      new obsidian.Setting(card).setName("URI").addText((t) => t.setValue(profile.apiUrl).onChange(async (v) => {
        profile.apiUrl = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("MODEL").addText((t) => t.setValue(profile.modelName).onChange(async (v) => {
        profile.modelName = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("AUTH").addText((t) => t.setValue(profile.apiKey).onChange(async (v) => {
        profile.apiKey = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("CTX MAX").setDesc("Max context window size in tokens").addText((t) => t.setValue(String(profile.maxContextTokens)).onChange(async (v) => {
        profile.maxContextTokens = parseInt(v) || 128e3;
        await this.plugin.saveSettings();
        const views = this.plugin.app.workspace.getLeavesOfType(VIEW_CHAT);
        if (views.length) views[0].view.updateContextBar();
      }));
      new obsidian.Setting(card).setName("SYS_PRMPT").addTextArea((t) => {
        t.inputEl.rows = 4;
        t.setValue(profile.systemPrompt).onChange(async (v) => {
          profile.systemPrompt = v;
          await this.plugin.saveSettings();
        });
      });
    });
    containerEl.createEl("div", { text: "NETWORK & I/O", attr: { style: "font-family: var(--font-monospace); color: var(--text-muted); margin-top: 32px; margin-bottom: 16px;" } });
    const netCard = containerEl.createEl("div", { cls: "hyoka-card" });
    new obsidian.Setting(netCard).setName("SYS_EXEC BYPASS").setDesc("Execute shell commands directly without UI confirmation.").addToggle((t) => t.setValue(this.plugin.settings.autoApproveCommands).onChange(async (v) => {
      this.plugin.settings.autoApproveCommands = v;
      await this.plugin.saveSettings();
    }));
    new obsidian.Setting(netCard).setName("NET_SEARCH").setDesc("Permit DuckDuckGo querying.").addToggle((t) => t.setValue(this.plugin.settings.enableWebSearch).onChange(async (v) => {
      this.plugin.settings.enableWebSearch = v;
      await this.plugin.saveSettings();
    }));
  }
};

exports.HyokaPreviewView = HyokaPreviewView;
exports.HyokaSlideView = HyokaSlideView;
exports.default = HyokaPlugin;
//# sourceMappingURL=main.js.map
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1haW4udHMiXSwibmFtZXMiOlsicmVxdWVzdFVybCIsIk1vZGFsIiwic2V0SWNvbiIsIlBsdWdpbiIsIkZ1enp5U3VnZ2VzdE1vZGFsIiwiSXRlbVZpZXciLCJURmlsZSIsIkNvbXBvbmVudCIsIk5vdGljZSIsIk1hcmtkb3duUmVuZGVyZXIiLCJQbHVnaW5TZXR0aW5nVGFiIiwiU2V0dGluZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBaUJBLElBQU0sU0FBQSxHQUFZLGlCQUFBO0FBQ2xCLElBQU0sWUFBQSxHQUFlLG9CQUFBO0FBQ3JCLElBQU0sV0FBQSxHQUFjLG1CQUFBO0FBQ3BCLElBQU0saUJBQUEsR0FBb0IsY0FBQTtBQUUxQixJQUFNLHFCQUFBLEdBQ0Ysa21CQUFBO0FBZ0NKLFNBQVMsWUFBQSxDQUFhLE9BQU8sT0FBQSxFQUF1QjtBQUNoRCxFQUFBLE9BQU87QUFBQSxJQUNILEVBQUEsRUFBSSxDQUFBLFFBQUEsRUFBVyxJQUFBLENBQUssR0FBQSxFQUFLLENBQUEsQ0FBQTtBQUFBLElBQ3pCLElBQUE7QUFBQSxJQUNBLE1BQUEsRUFBUSwwQkFBQTtBQUFBLElBQ1IsU0FBQSxFQUFXLFNBQUE7QUFBQSxJQUNYLE1BQUEsRUFBUSxFQUFBO0FBQUEsSUFDUixZQUFBLEVBQWMsNk1BQUE7QUFBQSxJQUNkLFdBQUEsRUFBYSxHQUFBO0FBQUEsSUFDYixnQkFBQSxFQUFrQjtBQUFBLEdBQ3RCO0FBQ0o7QUFFQSxJQUFNLGdCQUFBLEdBQWtDO0FBQUEsRUFDcEMsUUFBQSxFQUFVO0FBQUEsSUFDTjtBQUFBLE1BQ0ksRUFBQSxFQUFJLFVBQUE7QUFBQSxNQUNKLElBQUEsRUFBTSxNQUFBO0FBQUEsTUFDTixNQUFBLEVBQVEsMEJBQUE7QUFBQSxNQUNSLFNBQUEsRUFBVyxTQUFBO0FBQUEsTUFDWCxNQUFBLEVBQVEsRUFBQTtBQUFBLE1BQ1IsWUFBQSxFQUFjLG1LQUFBO0FBQUEsTUFDZCxXQUFBLEVBQWEsR0FBQTtBQUFBLE1BQ2IsZ0JBQUEs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T0FBSyxDQUFBLENBQUUsUUFBQSxDQUFTLEtBQUssTUFBQSxDQUFPLFFBQUEsQ0FBUyxlQUFlLENBQUEsQ0FBRSxRQUFBLENBQVMsT0FBTSxDQUFBLEtBQUs7QUFBRSxNQUFBLElBQUEsQ0FBSyxNQUFBLENBQU8sU0FBUyxlQUFBLEdBQWtCLENBQUE7QUFBRyxNQUFBLE1BQU0sSUFBQSxDQUFLLE9BQU8sWUFBQSxFQUFhO0FBQUEsSUFBRyxDQUFDLENBQUMsQ0FBQTtBQUFBLEVBQzdLO0FBQ0osQ0FBQSIsImZpbGUiOiJtYWluLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcclxuICAgIEFwcCxcclxuICAgIEl0ZW1WaWV3LFxyXG4gICAgUGx1Z2luLFxyXG4gICAgUGx1Z2luU2V0dGluZ1RhYixcclxuICAgIFNldHRpbmcsXHJcbiAgICBXb3Jrc3BhY2VMZWFmLFxyXG4gICAgTWFya2Rvd25SZW5kZXJlcixcclxuICAgIENvbXBvbmVudCxcclxuICAgIE5vdGljZSxcclxuICAgIHJlcXVlc3RVcmwsXHJcbiAgICBURmlsZSxcclxuICAgIE1vZGFsLFxyXG4gICAgRnV6enlTdWdnZXN0TW9kYWwsXHJcbiAgICBzZXRJY29uXHJcbn0gZnJvbSAnb2JzaWRpYW4nO1xyXG5cclxuY29uc3QgVklFV19DSEFUID0gXCJoeW9rYS1jaGF0LXZpZXdcIjtcclxuY29uc3QgVklFV19QUkVWSUVXID0gXCJoeW9rYS1wcmV2aWV3LXZpZXdcIjtcclxuY29uc3QgVklFV19TTElERVMgPSBcImh5b2thLXNsaWRlcy12aWV3XCI7XHJcbmNvbnN0IEFHRU5UX01FTU9SWV9ST09UID0gXCJhZ2VudC1tZW1vcnlcIjtcclxuXHJcbmNvbnN0IFdFQlNJVEVfU1lTVEVNX1BST01QVCA9XHJcbiAgICAnWW91IGFyZSBhIGhpZ2gtcGVyZm9ybWFuY2UgZnJvbnRlbmQgZ2VuZXJhdG9yLiBZb3Ugd3JpdGUgYSBzaW5nbGUgc2VsZi1jb250YWluZWQgSFRNTDUgZmlsZS4gVXNlIFRhaWx3aW5kIHZpYSB0aGUgQ0ROIHNjcmlwdCB0YWcgJyArXHJcbiAgICAnKDxzY3JpcHQgc3JjPVwiaHR0cHM6Ly9jZG4udGFpbHdpbmRjc3MuY29tXCI+PC9zY3JpcHQ+KSBhbmQgVGFpbHdpbmQgdXRpbGl0eSBjbGFzc2VzIGZvciBBTEwgc3R5bGluZy4gJyArXHJcbiAgICAnRG8gbm90IHdyaXRlIGEgc2VwYXJhdGUgPHN0eWxlPiBibG9jayB1bmxlc3MgYWJzb2x1dGVseSBuZWNlc3NhcnkuIElubGluZSBhbnkgbmVlZGVkIDxzY3JpcHQ+LiAnICtcclxuICAgICdSZXNwb25kIHdpdGggT05MWSB0aGUgcmF3IEhUTUwsIHN0YXJ0aW5nIGF0IDwhRE9DVFlQRSBodG1sPiDigJQgbm8gbWFya2Rvd24gY29kZSBmZW5jZXMsIG5vIGNvbW1lbnRhcnksIG5vIG9waW5pb25zLiAnICtcclxuICAgICdJZiB5b3UgbmVlZCBhIHBsYWNlaG9sZGVyIGltYWdlLCB1c2UgYW4gPGltZz4gcG9pbnRpbmcgYXQgaHR0cHM6Ly9waWNzdW0ucGhvdG9zL3NlZWQvPHNob3J0LXNsdWc+Lzx3aWR0aD4vPGhlaWdodD4gJyArXHJcbiAgICAnTWFrZSBpdCB2aXN1YWxseSBwb2xpc2hlZCwgcmVzcG9uc2l2ZSwgYW5kIGNsZWFuLic7XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFVFRJTkdTXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuaW50ZXJmYWNlIEFnZW50UHJvZmlsZSB7XHJcbiAgICBpZDogc3RyaW5nO1xyXG4gICAgbmFtZTogc3RyaW5nO1xyXG4gICAgYXBpVXJsOiBzdHJpbmc7XHJcbiAgICBtb2RlbE5hbWU6IHN0cmluZztcclxuICAgIGFwaUtleTogc3RyaW5nO1xyXG4gICAgc3lzdGVtUHJvbXB0OiBzdHJpbmc7XHJcbiAgICB0ZW1wZXJhdHVyZTogbnVtYmVyO1xyXG4gICAgbWF4Q29udGV4dFRva2VuczogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSHlva2FTZXR0aW5ncyB7XHJcbiAgICBwcm9maWxlczogQWdlbnRQcm9maWxlW107XHJcbiAgICBhY3RpdmVQcm9maWxlSWQ6IHN0cmluZztcclxuICAgIHNjcmFwZXJVcmw6IHN0cmluZztcclxuICAgIHNjcmFwZXJBcGlLZXk6IHN0cmluZztcclxuICAgIGF1dG9BcHByb3ZlQ29tbWFuZHM6IGJvb2xlYW47XHJcbiAgICBlbmFibGVXZWJTZWFyY2g6IGJvb2xlYW47XHJcbiAgICBlbmFibGVJbWFnZUxvb2t1cDogYm9vbGVhbjtcclxuICAgIGh5cGVyaXplZE1vZGU6IGJvb2xlYW47XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZyZXNoUHJvZmlsZShuYW1lID0gJ0FnZW50Jyk6IEFnZW50UHJvZmlsZSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGlkOiBgcHJvZmlsZS0ke0RhdGUubm93KCl9YCxcclxuICAgICAgICBuYW1lLFxyXG4gICAgICAgIGFwaVVybDogJ2h0dHA6Ly8xMjcuMC4wLjE6ODA4MC92MScsXHJcbiAgICAgICAgbW9kZWxOYW1lOiAnZ2VtbWEtNCcsXHJcbiAgICAgICAgYXBpS2V5OiAnJyxcclxuICAgICAgICBzeXN0ZW1Qcm9tcHQ6ICdZb3UgYXJlIGFuIGF1dG9ub21vdXMgZW5naW5lZXJpbmcgYWdlbnQgb3BlcmF0aW5nIGRpcmVjdGx5IGluc2lkZSB0aGUgdXNlclxcJ3MgT2JzaWRpYW4gdmF1bHQuIEV4ZWN1dGUgY29tbWFuZHMsIHdyaXRlIHJvYnVzdCBjb2RlLCBhbmQgZG8gbm90IHByb3ZpZGUgY29udmVyc2F0aW9uYWwgZmlsbGVyLiBDYWxsIHRvb2xzIHRvIGFjY29tcGxpc2ggdGFza3MuJyxcclxuICAgICAgICB0ZW1wZXJhdHVyZTogMC4xLFxyXG4gICAgICAgIG1heENvbnRleHRUb2tlbnM6IDEyODAwMFxyXG4gICAgfTtcclxufVxyXG5cclxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogSHlva2FTZXR0aW5ncyA9IHtcclxuICAgIHByb2ZpbGVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBpZDogJ3N5cy1jb3JlJyxcclxuICAgICAgICAgICAgbmFtZTogJ0NvcmUnLFxyXG4gICAgICAgICAgICBhcGlVcmw6ICdodHRwOi8vMTI3LjAuMC4xOjgwODAvdjEnLFxyXG4gICAgICAgICAgICBtb2RlbE5hbWU6ICdnZW1tYS00JyxcclxuICAgICAgICAgICAgYXBpS2V5OiAnJyxcclxuICAgICAgICAgICAgc3lzdGVtUHJvbXB0OiAnWW91IGFyZSBhbiBhdXRvbm9tb3VzIHN5c3RlbXMgZW5naW5lZXJpbmcgYWdlbnQuIFlvdSBidWlsZCByb2J1c3QgY29kZSB1c2luZyB5b3VyIHRvb2xzLiBOZXZlciBkZXNjcmliZSB3aGF0IHlvdSB3b3VsZCBkbyDigJQgY2FsbCB0aGUgdG9vbC4gS2VlcCBwcm9zZSB0ZXJzZS4nLFxyXG4gICAgICAgICAgICB0ZW1wZXJhdHVyZTogMC4xLFxyXG4gICAgICAgICAgICBtYXhDb250ZXh0VG9rZW5zOiAxMjgwMDBcclxuICAgICAgICB9XHJcbiAgICBdLFxyXG4gICAgYWN0aXZlUHJvZmlsZUlkOiAnc3lzLWNvcmUnLFxyXG4gICAgc2NyYXBlclVybDogJycsXHJcbiAgICBzY3JhcGVyQXBpS2V5OiAnJyxcclxuICAgIGF1dG9BcHByb3ZlQ29tbWFuZHM6IGZhbHNlLFxyXG4gICAgZW5hYmxlV2ViU2VhcmNoOiB0cnVlLFxyXG4gICAgZW5hYmxlSW1hZ2VMb29rdXA6IHRydWUsXHJcbiAgICBoeXBlcml6ZWRNb2RlOiBmYWxzZVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBUWVBFU1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmludGVyZmFjZSBDaGF0TWVzc2FnZSB7XHJcbiAgICByb2xlOiAnc3lzdGVtJyB8ICd1c2VyJyB8ICdhc3Npc3RhbnQnIHwgJ3Rvb2wnO1xyXG4gICAgY29udGVudDogc3RyaW5nIHwgbnVsbDtcclxuICAgIG5hbWU/OiBzdHJpbmc7XHJcbiAgICB0b29sX2NhbGxzPzogYW55W107XHJcbiAgICB0b29sX2NhbGxfaWQ/OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVE9PTCBSRUdJU1RSWVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmNsYXNzIE1jcFRvb2xSZWdpc3RyeSB7XHJcbiAgICBzdGF0aWMgZ2V0Q2FwYWJpbGl0aWVzKHBsdWdpbjogSHlva2FQbHVnaW4pOiBhbnlbXSB7XHJcbiAgICAgICAgY29uc3QgdG9vbHM6IGFueVtdID0gW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiBcImNyZWF0ZV9ub3RlXCIsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJDcmVhdGVzIG9yIG92ZXJ3cml0ZXMgYSBmaWxlIGluIHRoZSB2YXVsdCAobWFya2Rvd24sIGNvZGUsIG9yIHRleHQgZmlsZSkgd2l0aCB0aGUgZ2l2ZW4gY29udGVudC5cIixcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHsgdHlwZTogXCJzdHJpbmdcIiwgZGVzY3JpcHRpb246IFwiRnVsbCB2YXVsdC1yZWxhdGl2ZSBwYXRoIGluY2x1ZGluZyBleHRlbnNpb24uXCIgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogeyB0eXBlOiBcInN0cmluZ1wiIH1cclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbXCJwYXRoXCIsIFwiY29udGVudFwiXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiBcImVkaXRfbm90ZVwiLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiUGVyZm9ybXMgYSBwcmVjaXNlIGZpbmQtYW5kLXJlcGxhY2UgcGF0Y2ggb24gYW4gZXhpc3RpbmcgZmlsZS5cIixcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7IHBhdGg6IHsgdHlwZTogXCJzdHJpbmdcIiB9LCBmaW5kOiB7IHR5cGU6IFwic3RyaW5nXCIgfSwgcmVwbGFjZTogeyB0eXBlOiBcInN0cmluZ1wiIH0gfSxcclxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogW1wicGF0aFwiLCBcImZpbmRcIiwgXCJyZXBsYWNlXCJdXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIG5hbWU6IFwicmVhZF9ub3RlXCIsXHJcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJSZWFkcyB0aGUgY29udGVudCBvZiBhbiBleGlzdGluZyBmaWxlIGluIHRoZSB2YXVsdC5cIixcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6IFwib2JqZWN0XCIsIHByb3BlcnRpZXM6IHsgcGF0aDogeyB0eXBlOiBcInN0cmluZ1wiIH0gfSwgcmVxdWlyZWQ6IFtcInBhdGhcIl0gfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiBcImxpc3RfZmlsZXNcIixcclxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkxpc3RzIGZpbGVzIHVuZGVyIGEgZ2l2ZW4gdmF1bHQgZm9sZGVyLCByZWN1cnNpdmVseS5cIixcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7IHR5cGU6IFwib2JqZWN0XCIsIHByb3BlcnRpZXM6IHsgZm9sZGVyOiB7IHR5cGU6IFwic3RyaW5nXCIgfSB9LCByZXF1aXJlZDogW1wiZm9sZGVyXCJdIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogXCJydW5fY29tbWFuZFwiLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiRXhlY3V0ZXMgYSBsb2NhbCBzaGVsbCBjb21tYW5kIChlLmcuICdjYXJnbyBidWlsZCcsICducG0gcnVuIGRldicpLiBFeGVjdXRlcyBpbiB0aGUgdmF1bHQgcm9vdCB1bmxlc3MgY3dkIGlzIHByb3ZpZGVkLlwiLFxyXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIm9iamVjdFwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHsgY29tbWFuZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sIGN3ZDogeyB0eXBlOiBcInN0cmluZ1wiLCBkZXNjcmlwdGlvbjogXCJSZWxhdGl2ZSBkaXJlY3RvcnkgcGF0aCAob3B0aW9uYWwpXCIgfSB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbXCJjb21tYW5kXCJdXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdO1xyXG5cclxuICAgICAgICBpZiAocGx1Z2luLnNldHRpbmdzLmVuYWJsZVdlYlNlYXJjaCkge1xyXG4gICAgICAgICAgICB0b29scy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIG5hbWU6IFwic2VhcmNoX3dlYlwiLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiU2VhcmNoZXMgdGhlIGludGVybmV0LiBGYWlscyBncmFjZWZ1bGx5IGlmIG9mZmxpbmUuXCIsXHJcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYTogeyB0eXBlOiBcIm9iamVjdFwiLCBwcm9wZXJ0aWVzOiB7IHF1ZXJ5OiB7IHR5cGU6IFwic3RyaW5nXCIgfSB9LCByZXF1aXJlZDogW1wicXVlcnlcIl0gfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChwbHVnaW4uc2V0dGluZ3Muc2NyYXBlclVybCkge1xyXG4gICAgICAgICAgICB0b29scy5wdXNoKHtcclxuICAgICAgICAgICAgICAgIG5hbWU6IFwic2NyYXBlX3dlYlwiLFxyXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiVXNlcyB0aGUgY29uZmlndXJlZCBsb2NhbCB3ZWIgc2NyYXBlciB0byBmZXRjaCBKUy1yZW5kZXJlZCBVUkwgY29udGVudC5cIixcclxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7IHVybDogeyB0eXBlOiBcInN0cmluZ1wiIH0sIHNlbGVjdG9yOiB7IHR5cGU6IFwic3RyaW5nXCIgfSB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbXCJ1cmxcIl1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gdG9vbHM7XHJcbiAgICB9XHJcblxyXG4gICAgc3RhdGljIGFzT3BlbkFpVG9vbHMocGx1Z2luOiBIeW9rYVBsdWdpbikge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmdldENhcGFiaWxpdGllcyhwbHVnaW4pLm1hcCh0ID0+ICh7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiZnVuY3Rpb25cIixcclxuICAgICAgICAgICAgZnVuY3Rpb246IHsgbmFtZTogdC5uYW1lLCBkZXNjcmlwdGlvbjogdC5kZXNjcmlwdGlvbiwgcGFyYW1ldGVyczogdC5pbnB1dFNjaGVtYSB9XHJcbiAgICAgICAgfSkpO1xyXG4gICAgfVxyXG5cclxuICAgIHN0YXRpYyBhc3luYyBleGVjdXRlVG9vbChuYW1lOiBzdHJpbmcsIGFyZ3M6IGFueSwgcGx1Z2luOiBIeW9rYVBsdWdpbik6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgdmF1bHQgPSBwbHVnaW4uYXBwLnZhdWx0O1xyXG5cclxuICAgICAgICAgICAgaWYgKG5hbWUgPT09IFwiY3JlYXRlX25vdGVcIikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZW5zdXJlUGFyZW50Rm9sZGVycyhwbHVnaW4sIGFyZ3MucGF0aCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoYXdhaXQgdmF1bHQuYWRhcHRlci5leGlzdHMoYXJncy5wYXRoKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHZhdWx0LmFkYXB0ZXIud3JpdGUoYXJncy5wYXRoLCBhcmdzLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHBsdWdpbi5ub3RpZnlMaXZlVXBkYXRlKGFyZ3MucGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGBVcGRhdGVkIGV4aXN0aW5nIGZpbGU6ICR7YXJncy5wYXRofWA7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB2YXVsdC5jcmVhdGUoYXJncy5wYXRoLCBhcmdzLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgcGx1Z2luLm5vdGlmeUxpdmVVcGRhdGUoYXJncy5wYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBgQ3JlYXRlZCBmaWxlOiAke2FyZ3MucGF0aH1gO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gXCJlZGl0X25vdGVcIikge1xyXG4gICAgICAgICAgICAgICAgaWYgKCEoYXdhaXQgdmF1bHQuYWRhcHRlci5leGlzdHMoYXJncy5wYXRoKSkpIHJldHVybiBgRXJyb3I6IGZpbGUgbm90IGZvdW5kIGF0ICR7YXJncy5wYXRofWA7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50ID0gYXdhaXQgdmF1bHQuYWRhcHRlci5yZWFkKGFyZ3MucGF0aCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWN1cnJlbnQuaW5jbHVkZXMoYXJncy5maW5kKSkgcmV0dXJuIGBFcnJvcjogJ2ZpbmQnIHRleHQgbm90IGZvdW5kIGluICR7YXJncy5wYXRofS5gO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdmF1bHQuYWRhcHRlci53cml0ZShhcmdzLnBhdGgsIGN1cnJlbnQucmVwbGFjZShhcmdzLmZpbmQsIGFyZ3MucmVwbGFjZSkpO1xyXG4gICAgICAgICAgICAgICAgcGx1Z2luLm5vdGlmeUxpdmVVcGRhdGUoYXJncy5wYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBgUGF0Y2hlZCAke2FyZ3MucGF0aH1gO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gXCJyZWFkX25vdGVcIikge1xyXG4gICAgICAgICAgICAgICAgaWYgKCEoYXdhaXQgdmF1bHQuYWRhcHRlci5leGlzdHMoYXJncy5wYXRoKSkpIHJldHVybiBgRXJyb3I6IGZpbGUgbm90IGZvdW5kIGF0ICR7YXJncy5wYXRofWA7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYFtDT05URU5UIE9GICR7YXJncy5wYXRofV06XFxuJHthd2FpdCB2YXVsdC5hZGFwdGVyLnJlYWQoYXJncy5wYXRoKX1gO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gXCJsaXN0X2ZpbGVzXCIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZvbGRlciA9IGFyZ3MuZm9sZGVyIHx8ICcnO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYWxsID0gdmF1bHQuZ2V0RmlsZXMoKS5tYXAoZiA9PiBmLnBhdGgpLmZpbHRlcihwID0+IHAuc3RhcnRzV2l0aChmb2xkZXIpKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBhbGwubGVuZ3RoID8gYWxsLmpvaW4oJ1xcbicpIDogYE5vIGZpbGVzIHVuZGVyICR7Zm9sZGVyIHx8ICcocm9vdCknfWA7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChuYW1lID09PSBcInJ1bl9jb21tYW5kXCIpIHJldHVybiBhd2FpdCBwbHVnaW4uY29tbWFuZFJ1bm5lci5yZXF1ZXN0KGFyZ3MuY29tbWFuZCwgYXJncy5jd2QpO1xyXG5cclxuICAgICAgICAgICAgaWYgKG5hbWUgPT09IFwic2VhcmNoX3dlYlwiKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHJlcXVlc3RVcmwoeyB1cmw6IGBodHRwczovL2h0bWwuZHVja2R1Y2tnby5jb20vaHRtbC8/cT0ke2VuY29kZVVSSUNvbXBvbmVudChhcmdzLnF1ZXJ5KX1gLCBtZXRob2Q6ICdHRVQnIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtSZSA9IC88YVtePl0qY2xhc3M9XCJyZXN1bHRfX2FcIltePl0qaHJlZj1cIihbXlwiXSspXCJbXj5dKj4oW1xcc1xcU10qPyk8XFwvYT4vZztcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzbmlwcGV0UmUgPSAvPGFbXj5dKmNsYXNzPVwicmVzdWx0X19zbmlwcGV0XCJbXj5dKj4oW1xcc1xcU10qPyk8XFwvYT4vZztcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzdHJpcCA9IChzOiBzdHJpbmcpID0+IHMucmVwbGFjZSgvPFtePl0qPi9nLCAnJykucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0aXRsZXM6IHN0cmluZ1tdID0gW107IGxldCBtO1xyXG4gICAgICAgICAgICAgICAgICAgIHdoaWxlICgobSA9IGxpbmtSZS5leGVjKHJlcy50ZXh0KSkgIT09IG51bGwgJiYgdGl0bGVzLmxlbmd0aCA8IDUpIHRpdGxlcy5wdXNoKHN0cmlwKG1bMl0pKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzbmlwcGV0czogc3RyaW5nW10gPSBbXTtcclxuICAgICAgICAgICAgICAgICAgICB3aGlsZSAoKG0gPSBzbmlwcGV0UmUuZXhlYyhyZXMudGV4dCkpICE9PSBudWxsICYmIHNuaXBwZXRzLmxlbmd0aCA8IDUpIHNuaXBwZXRzLnB1c2goc3RyaXAobVsxXSkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aXRsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gYE5vIHdlYiByZXN1bHRzIGZvdW5kLmA7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRpdGxlcy5tYXAoKHQsIGkpID0+IGAke2kgKyAxfS4gJHt0fVxcbiAgICR7c25pcHBldHNbaV0gfHwgJyd9YCkuam9pbignXFxuJyk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYE5ldHdvcmsgZXJyb3I6IE9mZmxpbmUgb3IgdW5yZWFjaGFibGUuIFByb2NlZWQgd2l0aG91dCB3ZWIgZGF0YS5gO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gXCJzY3JhcGVfd2ViXCIpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgcmVxdWVzdFVybCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogcGx1Z2luLnNldHRpbmdzLnNjcmFwZXJVcmwsIG1ldGhvZDogJ1BPU1QnLCBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkZXJzOiBwbHVnaW4uc2V0dGluZ3Muc2NyYXBlckFwaUtleSA/IHsgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7cGx1Z2luLnNldHRpbmdzLnNjcmFwZXJBcGlLZXl9YCB9IDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHVybDogYXJncy51cmwsIHNlbGVjdG9yOiBhcmdzLnNlbGVjdG9yIHx8IG51bGwgfSlcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYFtTQ1JBUEVEIENPTlRFTlQgRlJPTSAke2FyZ3MudXJsfV06XFxuJHtyZXMudGV4dC5zdWJzdHJpbmcoMCwgMTUwMDApfWA7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYFNjcmFwZXIgb2ZmbGluZSBvciB1bnJlYWNoYWJsZS5gO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVucmVnaXN0ZXJlZCB0b29sOiAke25hbWV9YCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBgVG9vbCBleGVjdXRpb24gZmFpbGVkOiAke2UubWVzc2FnZX1gO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlUGFyZW50Rm9sZGVycyhwbHVnaW46IEh5b2thUGx1Z2luLCBwYXRoOiBzdHJpbmcpIHtcclxuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpLnNsaWNlKDAsIC0xKTtcclxuICAgIGxldCBhY2MgPSAnJztcclxuICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xyXG4gICAgICAgIGFjYyA9IGFjYyA/IGAke2FjY30vJHtwYXJ0fWAgOiBwYXJ0O1xyXG4gICAgICAgIGlmICghKGF3YWl0IHBsdWdpbi5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoYWNjKSkpIGF3YWl0IHBsdWdpbi5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKGFjYyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQ09NTUFORCBSVU5ORVJcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5jbGFzcyBDb21tYW5kUnVubmVyIHtcclxuICAgIHBsdWdpbjogSHlva2FQbHVnaW47XHJcbiAgICBjb25zdHJ1Y3RvcihwbHVnaW46IEh5b2thUGx1Z2luKSB7IHRoaXMucGx1Z2luID0gcGx1Z2luOyB9XHJcblxyXG4gICAgYXN5bmMgcmVxdWVzdChjb21tYW5kOiBzdHJpbmcsIGN3ZD86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvQXBwcm92ZUNvbW1hbmRzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGFwcHJvdmVkID0gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IG5ldyBDb21tYW5kQ29uZmlybU1vZGFsKHRoaXMucGx1Z2luLmFwcCwgY29tbWFuZCwgY3dkIHx8ICdWYXVsdCBSb290JywgcmVzb2x2ZSkub3BlbigpKTtcclxuICAgICAgICAgICAgaWYgKCFhcHByb3ZlZCkgcmV0dXJuIGBVc2VyIGRlY2xpbmVkIHRvIHJ1bjogJHtjb21tYW5kfWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGUoY29tbWFuZCwgY3dkKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGV4ZWN1dGUoY29tbWFuZDogc3RyaW5nLCByZWxhdGl2ZUN3ZD86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlIE5vZGUgZXhlY3V0aW9uIGNvbnRleHRcclxuICAgICAgICAgICAgICAgIGNvbnN0IHsgZXhlYyB9ID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYWRhcHRlcjogYW55ID0gdGhpcy5wbHVnaW4uYXBwLnZhdWx0LmFkYXB0ZXI7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IGFkYXB0ZXIuZ2V0QmFzZVBhdGggPyBhZGFwdGVyLmdldEJhc2VQYXRoKCkgOiAnJztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgbGV0IHRhcmdldEN3ZCA9IGJhc2VQYXRoO1xyXG4gICAgICAgICAgICAgICAgaWYgKHJlbGF0aXZlQ3dkICYmIGJhc2VQYXRoKSB0YXJnZXRDd2QgPSBgJHtiYXNlUGF0aH0vJHtyZWxhdGl2ZUN3ZH1gO1xyXG5cclxuICAgICAgICAgICAgICAgIGV4ZWMoY29tbWFuZCwgeyBjd2Q6IHRhcmdldEN3ZCwgdGltZW91dDogNjAwMDAsIG1heEJ1ZmZlcjogNSAqIDEwMjQgKiAxMDI0IH0sIChlcnI6IGFueSwgc3Rkb3V0OiBzdHJpbmcsIHN0ZGVycjogc3RyaW5nKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShlcnJcclxuICAgICAgICAgICAgICAgICAgICAgICAgPyBgRXJyb3IuXFxuU1RET1VUOlxcbiR7c3Rkb3V0fVxcblNUREVSUjpcXG4ke3N0ZGVyciB8fCBlcnIubWVzc2FnZX1gXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDogYFN1Y2Nlc3MuXFxuU1RET1VUOlxcbiR7c3Rkb3V0fSR7c3RkZXJyID8gYFxcblNUREVSUjpcXG4ke3N0ZGVycn1gIDogJyd9YCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKGBFeGVjdXRpb24gZW52aXJvbm1lbnQgdW5hdmFpbGFibGU6ICR7ZS5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmNsYXNzIENvbW1hbmRDb25maXJtTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XHJcbiAgICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcHJpdmF0ZSBjb21tYW5kOiBzdHJpbmcsIHByaXZhdGUgY3dkOiBzdHJpbmcsIHByaXZhdGUgY2I6ICh2OiBib29sZWFuKSA9PiB2b2lkKSB7IHN1cGVyKGFwcCk7IH1cclxuICAgIG9uT3BlbigpIHtcclxuICAgICAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgICAgICBjb250ZW50RWwuY3JlYXRlRWwoJ2gzJywgeyB0ZXh0OiAnU1lTX0VYRUMnLCBhdHRyOiB7IHN0eWxlOiAnZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgY29sb3I6IHZhcigtLXRleHQtbm9ybWFsKTsgZm9udC13ZWlnaHQ6IG5vcm1hbDsgbWFyZ2luLWJvdHRvbTogNHB4OycgfSB9KTtcclxuICAgICAgICBjb250ZW50RWwuY3JlYXRlRWwoJ2RpdicsIHsgdGV4dDogYGN3ZDogJHt0aGlzLmN3ZH1gLCBhdHRyOiB7IHN0eWxlOiAnZm9udC1zaXplOiAwLjhlbTsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpOyBtYXJnaW4tYm90dG9tOiAxMnB4OycgfSB9KTtcclxuICAgICAgICBjb250ZW50RWwuY3JlYXRlRWwoJ2RpdicsIHsgdGV4dDogdGhpcy5jb21tYW5kLCBhdHRyOiB7IHN0eWxlOiAnYmFja2dyb3VuZDp2YXIoLS1iYWNrZ3JvdW5kLXNlY29uZGFyeSk7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgcGFkZGluZzoxMHB4OyBmb250LWZhbWlseTogdmFyKC0tZm9udC1tb25vc3BhY2UpOyBmb250LXNpemU6IDAuOWVtOycgfSB9KTtcclxuICAgICAgICBjb25zdCByb3cgPSBjb250ZW50RWwuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsgZ2FwOjhweDsganVzdGlmeS1jb250ZW50OmZsZXgtZW5kOyBtYXJnaW4tdG9wOjE2cHg7JyB9IH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGRlbnlCdG4gPSByb3cuY3JlYXRlRWwoJ2J1dHRvbicsIHsgY2xzOiAnaHlva2EtYnRuLWZsYXQnIH0pO1xyXG4gICAgICAgIHNldEljb24oZGVueUJ0biwgJ3gnKTtcclxuICAgICAgICBkZW55QnRuLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcgRGVueScpKTtcclxuICAgICAgICBkZW55QnRuLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuY2IoZmFsc2UpOyB0aGlzLmNsb3NlKCk7IH07XHJcblxyXG4gICAgICAgIGNvbnN0IHJ1bkJ0biA9IHJvdy5jcmVhdGVFbCgnYnV0dG9uJywgeyBjbHM6ICdoeW9rYS1idG4tZmxhdCcgfSk7XHJcbiAgICAgICAgcnVuQnRuLnN0eWxlLmNvbG9yID0gJ3ZhcigtLXRleHQtbm9ybWFsKSc7XHJcbiAgICAgICAgcnVuQnRuLnN0eWxlLmJvcmRlckNvbG9yID0gJ3ZhcigtLXRleHQtbm9ybWFsKSc7XHJcbiAgICAgICAgc2V0SWNvbihydW5CdG4sICdwbGF5Jyk7XHJcbiAgICAgICAgcnVuQnRuLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcgRXhlYycpKTtcclxuICAgICAgICBydW5CdG4ub25jbGljayA9ICgpID0+IHsgdGhpcy5jYih0cnVlKTsgdGhpcy5jbG9zZSgpOyB9O1xyXG4gICAgfVxyXG4gICAgb25DbG9zZSgpIHsgdGhpcy5jb250ZW50RWwuZW1wdHkoKTsgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIE1BSU4gUExVR0lOXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSHlva2FQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gICAgc2V0dGluZ3MhOiBIeW9rYVNldHRpbmdzO1xyXG4gICAgY29tbWFuZFJ1bm5lciE6IENvbW1hbmRSdW5uZXI7XHJcblxyXG4gICAgYXN5bmMgb25sb2FkKCkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XHJcbiAgICAgICAgdGhpcy5jb21tYW5kUnVubmVyID0gbmV3IENvbW1hbmRSdW5uZXIodGhpcyk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplTWVtb3J5Rm9sZGVycygpO1xyXG4gICAgICAgIHRoaXMuaW5qZWN0U3R5bGVzKCk7XHJcblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJWaWV3KFZJRVdfQ0hBVCwgKGxlYWYpID0+IG5ldyBIeW9rYUNoYXRWaWV3KGxlYWYsIHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyVmlldyhWSUVXX1BSRVZJRVcsIChsZWFmKSA9PiBuZXcgSHlva2FQcmV2aWV3VmlldyhsZWFmLCB0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlclZpZXcoVklFV19TTElERVMsIChsZWFmKSA9PiBuZXcgSHlva2FTbGlkZVZpZXcobGVhZiwgdGhpcykpO1xyXG5cclxuICAgICAgICB0aGlzLmFkZFJpYmJvbkljb24oJ3Rlcm1pbmFsLXNxdWFyZScsICdTWVNfQ1RSTCcsICgpID0+IHRoaXMuYWN0aXZhdGVDaGF0VmlldygpKTtcclxuICAgICAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IEh5b2thU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGxvYWRTZXR0aW5ncygpIHsgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7IH1cclxuICAgIGFzeW5jIHNhdmVTZXR0aW5ncygpIHsgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTsgfVxyXG4gICAgZ2V0QWN0aXZlUHJvZmlsZSgpOiBBZ2VudFByb2ZpbGUgeyByZXR1cm4gdGhpcy5zZXR0aW5ncy5wcm9maWxlcy5maW5kKHAgPT4gcC5pZCA9PT0gdGhpcy5zZXR0aW5ncy5hY3RpdmVQcm9maWxlSWQpIHx8IHRoaXMuc2V0dGluZ3MucHJvZmlsZXNbMF07IH1cclxuXHJcbiAgICBhc3luYyBpbml0aWFsaXplTWVtb3J5Rm9sZGVycygpIHtcclxuICAgICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhBR0VOVF9NRU1PUllfUk9PVCkpKSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIoQUdFTlRfTUVNT1JZX1JPT1QpO1xyXG4gICAgICAgIGZvciAoY29uc3QgcHJvZmlsZSBvZiB0aGlzLnNldHRpbmdzLnByb2ZpbGVzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IGAke0FHRU5UX01FTU9SWV9ST09UfS8ke3Byb2ZpbGUuaWR9YDtcclxuICAgICAgICAgICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoZGlyKSkpIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZUZvbGRlcihkaXIpO1xyXG4gICAgICAgICAgICBjb25zdCBoaXN0ID0gYCR7ZGlyfS9zZXNzaW9uX2hpc3RvcnkuanNvbmA7XHJcbiAgICAgICAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGhpc3QpKSkgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKGhpc3QsIEpTT04uc3RyaW5naWZ5KFtdKSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGluamVjdFN0eWxlcygpIHtcclxuICAgICAgICBjb25zdCBpZCA9ICdoeW9rYS1taW5pbWFsLXV4JztcclxuICAgICAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSByZXR1cm47XHJcbiAgICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xyXG4gICAgICAgIGVsLmlkID0gaWQ7XHJcbiAgICAgICAgZWwudGV4dENvbnRlbnQgPSBgXHJcbiAgICAgICAgICAgIC8qIE1vbm9saXRoaWMgTWluaW1hbCBBZXN0aGV0aWNzICovXHJcbiAgICAgICAgICAgIC5oeW9rYS1jYXJkIHsgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgYm9yZGVyLXJhZGl1czogMnB4OyBwYWRkaW5nOiAxNnB4OyBtYXJnaW4tYm90dG9tOiAxNnB4OyBmb250LWZhbWlseTogdmFyKC0tZm9udC1tb25vc3BhY2UpOyB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAuaHlva2EtYnRuLWljb24geyBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDsgYm9yZGVyOiBub25lOyBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7IGN1cnNvcjogcG9pbnRlcjsgcGFkZGluZzogNHB4OyBkaXNwbGF5OiBpbmxpbmUtZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IHRyYW5zaXRpb246IGNvbG9yIDAuMTVzIGVhc2U7IH1cclxuICAgICAgICAgICAgLmh5b2thLWJ0bi1pY29uOmhvdmVyIHsgY29sb3I6IHZhcigtLXRleHQtbm9ybWFsKTsgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLmh5b2thLWJ0bi1mbGF0IHsgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpOyBwYWRkaW5nOiA0cHggMTBweDsgYm9yZGVyLXJhZGl1czogMnB4OyBjdXJzb3I6IHBvaW50ZXI7IGZvbnQtc2l6ZTogMC44ZW07IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IGRpc3BsYXk6IGlubGluZS1mbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDZweDsgdHJhbnNpdGlvbjogYWxsIDAuMTVzIGVhc2U7IH1cclxuICAgICAgICAgICAgLmh5b2thLWJ0bi1mbGF0OmhvdmVyIHsgY29sb3I6IHZhcigtLXRleHQtbm9ybWFsKTsgYm9yZGVyLWNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTsgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLyogQ2hhdCBJbnRlcmZhY2UgRWxlbWVudHMgKi9cclxuICAgICAgICAgICAgLmh5b2thLWN0eC1iYXItdHJhY2sgeyBoZWlnaHQ6IDFweDsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyB3aWR0aDogMTAwJTsgbWFyZ2luLXRvcDogNHB4OyB9XHJcbiAgICAgICAgICAgIC5oeW9rYS1jdHgtYmFyLWZpbGwgeyBoZWlnaHQ6IDEwMCU7IGJhY2tncm91bmQ6IHZhcigtLXRleHQtbm9ybWFsKTsgdHJhbnNpdGlvbjogd2lkdGggMC4zcyBlYXNlOyB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAuaHlva2EtY2hpcCB7IGRpc3BsYXk6aW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgZ2FwOjZweDsgYm9yZGVyOjFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7IGJvcmRlci1yYWRpdXM6MnB4OyBwYWRkaW5nOjJweCA4cHg7IGZvbnQtc2l6ZTowLjc1ZW07IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTsgfVxyXG4gICAgICAgICAgICAuaHlva2EtY2hpcCAueCB7IGN1cnNvcjpwb2ludGVyOyBvcGFjaXR5OjAuNTsgfVxyXG4gICAgICAgICAgICAuaHlva2EtY2hpcCAueDpob3ZlciB7IG9wYWNpdHk6MTsgY29sb3I6dmFyKC0tdGV4dC1lcnJvcik7IH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8qIENvcHkgQnV0dG9ucyAqL1xyXG4gICAgICAgICAgICAuaHlva2EtbXNnLWNvcHkgeyBwb3NpdGlvbjphYnNvbHV0ZTsgdG9wOjZweDsgcmlnaHQ6NnB4OyBmb250LXNpemU6MC43ZW07IHBhZGRpbmc6NHB4IDhweDsgYm9yZGVyLXJhZGl1czoycHg7IGJvcmRlcjoxcHggc29saWQgdHJhbnNwYXJlbnQ7IGJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7IGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTsgY3Vyc29yOnBvaW50ZXI7IG9wYWNpdHk6MDsgdHJhbnNpdGlvbjogYWxsIDAuMTVzIGVhc2U7IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogNHB4OyB9XHJcbiAgICAgICAgICAgIC5oeW9rYS1tc2ctaG92ZXItY29udGFpbmVyOmhvdmVyIC5oeW9rYS1tc2ctY29weSB7IG9wYWNpdHk6MTsgfVxyXG4gICAgICAgICAgICAuaHlva2EtbXNnLWNvcHk6aG92ZXIgeyBib3JkZXItY29sb3I6IHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgY29sb3I6IHZhcigtLXRleHQtbm9ybWFsKTsgfVxyXG5cclxuICAgICAgICAgICAgLyogU2VsZWN0IERyb3Bkb3duICovXHJcbiAgICAgICAgICAgIC5oeW9rYS1zZWxlY3QgeyBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDsgYm9yZGVyOiBub25lOyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBjb2xvcjogdmFyKC0tdGV4dC1ub3JtYWwpOyBwYWRkaW5nOiA0cHggMDsgYm9yZGVyLXJhZGl1czogMDsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgZm9udC1zaXplOiAwLjg1ZW07IG91dGxpbmU6IG5vbmU7IGN1cnNvcjogcG9pbnRlcjsgd2lkdGg6IDEwMCU7IH1cclxuICAgICAgICAgICAgLmh5b2thLXNlbGVjdDpmb2N1cyB7IGJvcmRlci1jb2xvcjogdmFyKC0tdGV4dC1ub3JtYWwpOyB9XHJcblxyXG4gICAgICAgICAgICAvKiBXZWJwYWdlIFZpZXcgVG9vbGJhciAqL1xyXG4gICAgICAgICAgICAuaHlva2Etd2ViLXRvb2xiYXIgeyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDEycHg7IHBhZGRpbmc6IDhweCAxMnB4OyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBiYWNrZ3JvdW5kOiB2YXIoLS1iYWNrZ3JvdW5kLXByaW1hcnkpOyB9XHJcbiAgICAgICAgICAgIC5oeW9rYS13ZWItc2VsZWN0IHsgZmxleDogMTsgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7IGJvcmRlcjogbm9uZTsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgY29sb3I6IHZhcigtLXRleHQtbm9ybWFsKTsgZm9udC1zaXplOiAwLjllbTsgb3V0bGluZTogbm9uZTsgfVxyXG4gICAgICAgIGA7XHJcbiAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChlbCk7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgYWN0aXZhdGVDaGF0VmlldygpIHtcclxuICAgICAgICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gdGhpcy5hcHA7XHJcbiAgICAgICAgbGV0IGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfQ0hBVClbMF07XHJcbiAgICAgICAgaWYgKCFsZWFmKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJpZ2h0TGVhZiA9IHdvcmtzcGFjZS5nZXRSaWdodExlYWYoZmFsc2UpO1xyXG4gICAgICAgICAgICBpZiAocmlnaHRMZWFmKSB7IGxlYWYgPSByaWdodExlYWY7IGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19DSEFULCBhY3RpdmU6IHRydWUgfSk7IH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGxlYWYpIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xyXG4gICAgfVxyXG5cclxuICAgIHJlZnJlc2hDaGF0Vmlld3MoKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBsZWFmIG9mIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19DSEFUKSkge1xyXG4gICAgICAgICAgICAobGVhZi52aWV3IGFzIEh5b2thQ2hhdFZpZXcpLnJlZnJlc2hQcm9maWxlU2VsZWN0b3IoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgbm90aWZ5TGl2ZVVwZGF0ZShwYXRoOiBzdHJpbmcpIHsgXHJcbiAgICAgICAgdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoJ2h5b2thOmZpbGUtdXBkYXRlZCcsIHBhdGgpOyBcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBjYWxsTW9kZWxPbmNlKHByb2ZpbGU6IEFnZW50UHJvZmlsZSwgbWVzc2FnZXM6IENoYXRNZXNzYWdlW10pOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfTtcclxuICAgICAgICBpZiAocHJvZmlsZS5hcGlLZXkpIGhlYWRlcnNbJ0F1dGhvcml6YXRpb24nXSA9IGBCZWFyZXIgJHtwcm9maWxlLmFwaUtleX1gO1xyXG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHJlcXVlc3RVcmwoe1xyXG4gICAgICAgICAgICB1cmw6IGAke3Byb2ZpbGUuYXBpVXJsfS9jaGF0L2NvbXBsZXRpb25zYCwgbWV0aG9kOiAnUE9TVCcsIGhlYWRlcnMsXHJcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbW9kZWw6IHByb2ZpbGUubW9kZWxOYW1lLCBtZXNzYWdlcywgdGVtcGVyYXR1cmU6IDAuMSwgc3RyZWFtOiBmYWxzZSB9KVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKHJlcy50ZXh0KTtcclxuICAgICAgICByZXR1cm4gZGF0YT8uY2hvaWNlcz8uWzBdPy5tZXNzYWdlPy5jb250ZW50IHx8ICcnO1xyXG4gICAgfVxyXG5cclxuICAgIGVzdGltYXRlVG9rZW5zKHRleHQ6IHN0cmluZyk6IG51bWJlciB7IHJldHVybiBNYXRoLmNlaWwoKHRleHQgfHwgJycpLmxlbmd0aCAvIDQpOyB9XHJcbn1cclxuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEZJTEUgUElDS0VSIFxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmNsYXNzIEZpbGVQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsPFRGaWxlPiB7XHJcbiAgICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcHJpdmF0ZSBleGNsdWRlOiBURmlsZVtdLCBwcml2YXRlIG9uUGljazogKGZpbGVzOiBURmlsZVtdKSA9PiB2b2lkKSB7IHN1cGVyKGFwcCk7IH1cclxuICAgIGdldEl0ZW1zKCk6IFRGaWxlW10geyBjb25zdCBleGNsID0gbmV3IFNldCh0aGlzLmV4Y2x1ZGUubWFwKGYgPT4gZi5wYXRoKSk7IHJldHVybiB0aGlzLmFwcC52YXVsdC5nZXRGaWxlcygpLmZpbHRlcihmID0+ICFleGNsLmhhcyhmLnBhdGgpKTsgfVxyXG4gICAgZ2V0SXRlbVRleHQoaXRlbTogVEZpbGUpOiBzdHJpbmcgeyByZXR1cm4gaXRlbS5wYXRoOyB9XHJcbiAgICBvbkNob29zZUl0ZW0oaXRlbTogVEZpbGUpIHsgdGhpcy5vblBpY2soW2l0ZW1dKTsgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIExJVkUgUFJFVklFVyBWSUVXIChEeW5hbWljIEZpbGUgRHJvcGRvd24pXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuZXhwb3J0IGNsYXNzIEh5b2thUHJldmlld1ZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XHJcbiAgICBwbHVnaW46IEh5b2thUGx1Z2luO1xyXG4gICAgaWZyYW1lITogSFRNTElGcmFtZUVsZW1lbnQ7XHJcbiAgICBmaWxlU2VsZWN0ITogSFRNTFNlbGVjdEVsZW1lbnQ7XHJcbiAgICB0YXJnZXRQYXRoOiBzdHJpbmcgPSBcIlwiO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYsIHBsdWdpbjogSHlva2FQbHVnaW4pIHsgc3VwZXIobGVhZik7IHRoaXMucGx1Z2luID0gcGx1Z2luOyB9XHJcbiAgICBnZXRWaWV3VHlwZSgpOiBzdHJpbmcgeyByZXR1cm4gVklFV19QUkVWSUVXOyB9XHJcbiAgICBnZXREaXNwbGF5VGV4dCgpOiBzdHJpbmcgeyByZXR1cm4gXCJSRU5ERVJcIjsgfVxyXG4gICAgZ2V0SWNvbigpOiBzdHJpbmcgeyByZXR1cm4gXCJsYXlvdXQtdGVtcGxhdGVcIjsgfVxyXG5cclxuICAgIGFzeW5jIG9uT3BlbigpIHtcclxuICAgICAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNoaWxkcmVuWzFdIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgIGNvbnRhaW5lci5lbXB0eSgpO1xyXG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5wYWRkaW5nID0gXCIwXCI7XHJcbiAgICAgICAgY29udGFpbmVyLnN0eWxlLm92ZXJmbG93ID0gXCJoaWRkZW5cIjtcclxuICAgICAgICBjb250YWluZXIuc3R5bGUuZGlzcGxheSA9IFwiZmxleFwiO1xyXG4gICAgICAgIGNvbnRhaW5lci5zdHlsZS5mbGV4RGlyZWN0aW9uID0gXCJjb2x1bW5cIjtcclxuXHJcbiAgICAgICAgY29uc3QgdG9vbGJhciA9IGNvbnRhaW5lci5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICdoeW9rYS13ZWItdG9vbGJhcicgfSk7XHJcbiAgICAgICAgY29uc3QgcmVmcmVzaEJ0biA9IHRvb2xiYXIuY3JlYXRlRWwoJ2J1dHRvbicsIHsgY2xzOiAnaHlva2EtYnRuLWljb24nIH0pO1xyXG4gICAgICAgIHNldEljb24ocmVmcmVzaEJ0biwgJ3JlZnJlc2gtY3cnKTtcclxuICAgICAgICByZWZyZXNoQnRuLm9uY2xpY2sgPSAoKSA9PiB0aGlzLnJlZnJlc2hGaWxlTGlzdCh0aGlzLnRhcmdldFBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuZmlsZVNlbGVjdCA9IHRvb2xiYXIuY3JlYXRlRWwoJ3NlbGVjdCcsIHsgY2xzOiAnaHlva2Etd2ViLXNlbGVjdCcgfSk7XHJcbiAgICAgICAgdGhpcy5maWxlU2VsZWN0Lm9uY2hhbmdlID0gKCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnRhcmdldFBhdGggPSB0aGlzLmZpbGVTZWxlY3QudmFsdWU7XHJcbiAgICAgICAgICAgIHRoaXMucmVsb2FkKCk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdGhpcy5pZnJhbWUgPSBjb250YWluZXIuY3JlYXRlRWwoJ2lmcmFtZScsIHsgYXR0cjogeyBzdHlsZTogXCJ3aWR0aDoxMDAlOyBmbGV4LWdyb3c6MTsgYm9yZGVyOm5vbmU7IGJhY2tncm91bmQ6d2hpdGU7XCIsIHNhbmRib3g6IFwiYWxsb3ctc2NyaXB0cyBhbGxvdy1tb2RhbHMgYWxsb3ctZm9ybXMgYWxsb3ctcG9wdXBzXCIgfSB9KTtcclxuXHJcbiAgICAgICAgdGhpcy5yZWZyZXNoRmlsZUxpc3QoKTtcclxuXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLnZhdWx0Lm9uKCdjcmVhdGUnLCAoKSA9PiB0aGlzLnJlZnJlc2hGaWxlTGlzdCh0aGlzLnRhcmdldFBhdGgpKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLnZhdWx0Lm9uKCdkZWxldGUnLCAoKSA9PiB0aGlzLnJlZnJlc2hGaWxlTGlzdCgpKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLnZhdWx0Lm9uKCdyZW5hbWUnLCAoKSA9PiB0aGlzLnJlZnJlc2hGaWxlTGlzdCgpKSk7XHJcblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC52YXVsdC5vbignbW9kaWZ5JywgYXN5bmMgKGZpbGUpID0+IHsgXHJcbiAgICAgICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5wYXRoID09PSB0aGlzLnRhcmdldFBhdGgpIGF3YWl0IHRoaXMucmVsb2FkKCk7IFxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoKHRoaXMuYXBwLndvcmtzcGFjZSBhcyBhbnkpLm9uKCdoeW9rYTpmaWxlLXVwZGF0ZWQnLCBhc3luYyAocGF0aDogc3RyaW5nKSA9PiB7IFxyXG4gICAgICAgICAgICBpZiAocGF0aC5lbmRzV2l0aCgnLmh0bWwnKSkgdGhpcy5yZWZyZXNoRmlsZUxpc3QocGF0aCk7XHJcbiAgICAgICAgICAgIGlmIChwYXRoID09PSB0aGlzLnRhcmdldFBhdGgpIGF3YWl0IHRoaXMucmVsb2FkKCk7IFxyXG4gICAgICAgIH0pKTtcclxuICAgIH1cclxuXHJcbiAgICByZWZyZXNoRmlsZUxpc3QoZm9yY2VTZWxlY3RQYXRoPzogc3RyaW5nKSB7XHJcbiAgICAgICAgY29uc3QgaHRtbEZpbGVzID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZXMoKS5maWx0ZXIoZiA9PiBmLmV4dGVuc2lvbiA9PT0gJ2h0bWwnKTtcclxuICAgICAgICB0aGlzLmZpbGVTZWxlY3QuZW1wdHkoKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaHRtbEZpbGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICB0aGlzLmZpbGVTZWxlY3QuY3JlYXRlRWwoJ29wdGlvbicsIHsgdGV4dDogJ05vIC5odG1sIGZpbGVzIGluIHZhdWx0JywgYXR0cjogeyB2YWx1ZTogJycgfSB9KTtcclxuICAgICAgICAgICAgdGhpcy50YXJnZXRQYXRoID0gJyc7XHJcbiAgICAgICAgICAgIHRoaXMucmVsb2FkKCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGh0bWxGaWxlcy5zb3J0KChhLCBiKSA9PiBiLnN0YXQubXRpbWUgLSBhLnN0YXQubXRpbWUpOyAvLyBOZXdlc3QgZmlyc3RcclxuXHJcbiAgICAgICAgbGV0IHNlbGVjdGVkTWF0Y2hlZCA9IGZhbHNlO1xyXG4gICAgICAgIGh0bWxGaWxlcy5mb3JFYWNoKGYgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBvcHQgPSB0aGlzLmZpbGVTZWxlY3QuY3JlYXRlRWwoJ29wdGlvbicsIHsgdGV4dDogZi5wYXRoLCBhdHRyOiB7IHZhbHVlOiBmLnBhdGggfSB9KTtcclxuICAgICAgICAgICAgaWYgKGZvcmNlU2VsZWN0UGF0aCAmJiBmLnBhdGggPT09IGZvcmNlU2VsZWN0UGF0aCkge1xyXG4gICAgICAgICAgICAgICAgb3B0LnNlbGVjdGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgIHNlbGVjdGVkTWF0Y2hlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnRhcmdldFBhdGggPSBmLnBhdGg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgaWYgKCFzZWxlY3RlZE1hdGNoZWQgJiYgaHRtbEZpbGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgaWYgKCFodG1sRmlsZXMuZmluZChmID0+IGYucGF0aCA9PT0gdGhpcy50YXJnZXRQYXRoKSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy50YXJnZXRQYXRoID0gaHRtbEZpbGVzWzBdLnBhdGg7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmZpbGVTZWxlY3QudmFsdWUgPSB0aGlzLnRhcmdldFBhdGg7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmZpbGVTZWxlY3QudmFsdWUgPSB0aGlzLnRhcmdldFBhdGg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5yZWxvYWQoKTtcclxuICAgIH1cclxuXHJcbiAgICBzZXRUYXJnZXQocGF0aDogc3RyaW5nKSB7IFxyXG4gICAgICAgIHRoaXMucmVmcmVzaEZpbGVMaXN0KHBhdGgpOyBcclxuICAgIH1cclxuXHJcbiAgICBpbmplY3RIdG1sU3RyZWFtKGh0bWw6IHN0cmluZykge1xyXG4gICAgICAgIHRoaXMuaWZyYW1lLnNyY2RvYyA9IGh0bWw7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgcmVsb2FkKCkge1xyXG4gICAgICAgIGlmICghdGhpcy50YXJnZXRQYXRoKSB7XHJcbiAgICAgICAgICAgIHRoaXMuaWZyYW1lLnNyY2RvYyA9IGA8Ym9keSBzdHlsZT1cImZvbnQtZmFtaWx5Om1vbm9zcGFjZTtwYWRkaW5nOjJlbTtjb2xvcjojNjY2O2JhY2tncm91bmQ6IzExMTtcIj5OTyBUQVJHRVQgU0VMRUNURUQ8L2JvZHk+YDtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyh0aGlzLnRhcmdldFBhdGgpKSkgcmV0dXJuO1xyXG4gICAgICAgICAgICB0aGlzLmlmcmFtZS5zcmNkb2MgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQodGhpcy50YXJnZXRQYXRoKTtcclxuICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHsgfVxyXG4gICAgfVxyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNMSURFIERFQ0sgVklFV1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmV4cG9ydCBjbGFzcyBIeW9rYVNsaWRlVmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcclxuICAgIHBsdWdpbjogSHlva2FQbHVnaW47XHJcbiAgICBcclxuICAgIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYsIHBsdWdpbjogSHlva2FQbHVnaW4pIHsgc3VwZXIobGVhZik7IHRoaXMucGx1Z2luID0gcGx1Z2luOyB9XHJcbiAgICBnZXRWaWV3VHlwZSgpOiBzdHJpbmcgeyByZXR1cm4gVklFV19TTElERVM7IH1cclxuICAgIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7IHJldHVybiBcIlNMSURFU1wiOyB9XHJcbiAgICBnZXRJY29uKCk6IHN0cmluZyB7IHJldHVybiBcInByZXNlbnRhdGlvblwiOyB9XHJcbiAgICBcclxuICAgIGFzeW5jIG9uT3BlbigpIHtcclxuICAgICAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNoaWxkcmVuWzFdIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgIGNvbnRhaW5lci5lbXB0eSgpO1xyXG4gICAgICAgIGNvbnN0IHN0YWdlID0gY29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICd3aWR0aDoxMDAlOyBoZWlnaHQ6MTAwJTsgZGlzcGxheTpmbGV4OyBhbGlnbi1pdGVtczpjZW50ZXI7IGp1c3RpZnktY29udGVudDpjZW50ZXI7IGZvbnQtZmFtaWx5Om1vbm9zcGFjZTsgY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7JyB9IH0pO1xyXG4gICAgICAgIHN0YWdlLnNldFRleHQoJ1NsaWRlIGRlY2sgY29tcGlsZXIgcmVhZHkuJyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQ0hBVCBWSUVXXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuY2xhc3MgSHlva2FDaGF0VmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcclxuICAgIHBsdWdpbjogSHlva2FQbHVnaW47XHJcbiAgICBjaGF0SGlzdG9yeTogQ2hhdE1lc3NhZ2VbXSA9IFtdO1xyXG4gICAgYXR0YWNoZWRGaWxlczogVEZpbGVbXSA9IFtdO1xyXG4gICAgbWVzc2FnZUNvbnRhaW5lciE6IEhUTUxEaXZFbGVtZW50O1xyXG4gICAgaW5wdXRGaWVsZCE6IEhUTUxUZXh0QXJlYUVsZW1lbnQ7XHJcbiAgICBwcm9maWxlU2VsZWN0b3IhOiBIVE1MU2VsZWN0RWxlbWVudDtcclxuICAgIGF0dGFjaFJvdyE6IEhUTUxFbGVtZW50O1xyXG4gICAgY3R4RmlsbCE6IEhUTUxFbGVtZW50O1xyXG4gICAgY3R4TGFiZWwhOiBIVE1MRWxlbWVudDtcclxuICAgIGxpZmVjeWNsZTogQ29tcG9uZW50O1xyXG4gICAgaXNFeGVjdXRpbmcgPSBmYWxzZTtcclxuICAgIGFib3J0Q29udHJvbGxlcjogQWJvcnRDb250cm9sbGVyIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gICAgY29uc3RydWN0b3IobGVhZjogV29ya3NwYWNlTGVhZiwgcGx1Z2luOiBIeW9rYVBsdWdpbikgeyBzdXBlcihsZWFmKTsgdGhpcy5wbHVnaW4gPSBwbHVnaW47IHRoaXMubGlmZWN5Y2xlID0gbmV3IENvbXBvbmVudCgpOyB9XHJcbiAgICBnZXRWaWV3VHlwZSgpOiBzdHJpbmcgeyByZXR1cm4gVklFV19DSEFUOyB9XHJcbiAgICBnZXREaXNwbGF5VGV4dCgpOiBzdHJpbmcgeyByZXR1cm4gXCJTWVNfQ1RSTFwiOyB9XHJcbiAgICBnZXRJY29uKCk6IHN0cmluZyB7IHJldHVybiBcInRlcm1pbmFsXCI7IH1cclxuXHJcbiAgICBhc3luYyBvbk9wZW4oKSB7XHJcbiAgICAgICAgdGhpcy5saWZlY3ljbGUubG9hZCgpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMubG9hZEhpc3RvcnkoKTtcclxuXHJcbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250YWluZXJFbC5jaGlsZHJlblsxXSBhcyBIVE1MRWxlbWVudDtcclxuICAgICAgICBjb250YWluZXIuZW1wdHkoKTtcclxuICAgICAgICBjb25zdCB3cmFwcGVyID0gY29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OmZsZXg7IGZsZXgtZGlyZWN0aW9uOmNvbHVtbjsgaGVpZ2h0OjEwMCU7IHBhZGRpbmc6MTZweDsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1wcmltYXJ5KTsnIH0gfSk7XHJcblxyXG4gICAgICAgIC8vIEhlYWRlciBjb250cm9sc1xyXG4gICAgICAgIGNvbnN0IGhlYWRlclRvcCA9IHdyYXBwZXIuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsgZ2FwOjE2cHg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgcGFkZGluZy1ib3R0b206IDEycHg7IG1hcmdpbi1ib3R0b206IDEycHg7JyB9IH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGlkZW50aXR5RGl2ID0gaGVhZGVyVG9wLmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OmZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgZ2FwOiA4cHg7IGZsZXg6IDE7JyB9fSk7XHJcbiAgICAgICAgc2V0SWNvbihpZGVudGl0eURpdi5jcmVhdGVFbCgnc3BhbicsIHsgYXR0cjogeyBzdHlsZTogJ2NvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTsgZGlzcGxheTogZmxleDsnIH19KSwgJ2NwdScpO1xyXG4gICAgICAgIHRoaXMucHJvZmlsZVNlbGVjdG9yID0gaWRlbnRpdHlEaXYuY3JlYXRlRWwoJ3NlbGVjdCcsIHsgY2xzOiAnaHlva2Etc2VsZWN0JyB9KTtcclxuICAgICAgICB0aGlzLnJlZnJlc2hQcm9maWxlU2VsZWN0b3IoKTtcclxuICAgICAgICB0aGlzLnByb2ZpbGVTZWxlY3Rvci5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmFjdGl2ZVByb2ZpbGVJZCA9IHRoaXMucHJvZmlsZVNlbGVjdG9yLnZhbHVlO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb250ZXh0QmFyKCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFF1aWNrIEFjdGlvbnNcclxuICAgICAgICBjb25zdCBxdWlja0FjdGlvbnMgPSBoZWFkZXJUb3AuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsgZ2FwOjhweDsnIH0gfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgYnRuV2ViID0gcXVpY2tBY3Rpb25zLmNyZWF0ZUVsKCdidXR0b24nLCB7IGNsczogJ2h5b2thLWJ0bi1pY29uJyB9KTtcclxuICAgICAgICBzZXRJY29uKGJ0bldlYiwgJ2dsb2JlJyk7XHJcbiAgICAgICAgYnRuV2ViLm9uY2xpY2sgPSAoKSA9PiB0aGlzLnJ1blR1cm4oJ0J1aWxkIGEgcmVzcG9uc2l2ZSB3ZWJwYWdlIGZvciBhIG1vZGVybiBsYW5kaW5nIHBhZ2UuJyk7XHJcblxyXG4gICAgICAgIGNvbnN0IGJ0blN2ZyA9IHF1aWNrQWN0aW9ucy5jcmVhdGVFbCgnYnV0dG9uJywgeyBjbHM6ICdoeW9rYS1idG4taWNvbicgfSk7XHJcbiAgICAgICAgc2V0SWNvbihidG5TdmcsICdpbWFnZScpO1xyXG4gICAgICAgIGJ0blN2Zy5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmlucHV0RmllbGQudmFsdWUgPSAnRGVzaWduIGEgY2xlYW4gU1ZHIGxvZ28uIFJlc3BvbmQgT05MWSB3aXRoIHJhdyA8c3ZnPi4uLjwvc3ZnPiBtYXJrdXAuJzsgdGhpcy5pbnB1dEZpZWxkLmZvY3VzKCk7IH07XHJcblxyXG4gICAgICAgIGNvbnN0IGJ0blN0b3AgPSBxdWlja0FjdGlvbnMuY3JlYXRlRWwoJ2J1dHRvbicsIHsgY2xzOiAnaHlva2EtYnRuLWljb24nIH0pO1xyXG4gICAgICAgIHNldEljb24oYnRuU3RvcCwgJ3NxdWFyZScpO1xyXG4gICAgICAgIGJ0blN0b3Aub25jbGljayA9ICgpID0+IHsgaWYgKHRoaXMuYWJvcnRDb250cm9sbGVyICYmIHRoaXMuaXNFeGVjdXRpbmcpIHsgdGhpcy5hYm9ydENvbnRyb2xsZXIuYWJvcnQoKTsgbmV3IE5vdGljZSgnU0lHSU5UIFNFTlQuJyk7IH0gfTtcclxuXHJcbiAgICAgICAgY29uc3QgYnRuQ2xlYXIgPSBxdWlja0FjdGlvbnMuY3JlYXRlRWwoJ2J1dHRvbicsIHsgY2xzOiAnaHlva2EtYnRuLWljb24nIH0pO1xyXG4gICAgICAgIHNldEljb24oYnRuQ2xlYXIsICdyb3RhdGUtY2N3Jyk7XHJcbiAgICAgICAgYnRuQ2xlYXIub25jbGljayA9ICgpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeSA9IFt7IHJvbGU6ICdzeXN0ZW0nLCBjb250ZW50OiB0aGlzLmdldFN5c3RlbVByb21wdCgpIH1dO1xyXG4gICAgICAgICAgICB0aGlzLnNhdmVIaXN0b3J5KCk7IHRoaXMucmVuZGVyTWVzc2FnZXMoKTtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyBNYWluIENoYXQgQXJlYVxyXG4gICAgICAgIHRoaXMubWVzc2FnZUNvbnRhaW5lciA9IHdyYXBwZXIuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2ZsZXgtZ3JvdzoxOyBvdmVyZmxvdy15OmF1dG87IGRpc3BsYXk6ZmxleDsgZmxleC1kaXJlY3Rpb246Y29sdW1uOyBnYXA6MjBweDsgcGFkZGluZy1yaWdodDo4cHg7IG1hcmdpbi1ib3R0b206IDEycHg7JyB9IH0pO1xyXG5cclxuICAgICAgICAvLyBNZW1vcnkgQmFyXHJcbiAgICAgICAgY29uc3QgY3R4V3JhcCA9IHdyYXBwZXIuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsgZmxleC1kaXJlY3Rpb246Y29sdW1uOyBtYXJnaW4tYm90dG9tOiAxMnB4OycgfSB9KTtcclxuICAgICAgICB0aGlzLmN0eExhYmVsID0gY3R4V3JhcC5jcmVhdGVFbCgnZGl2JywgeyB0ZXh0OiAnTUVNIDAlJywgYXR0cjogeyBzdHlsZTogJ2ZvbnQtc2l6ZTowLjc1ZW07IGNvbG9yOnZhcigtLXRleHQtbXV0ZWQpOyBhbGlnbi1zZWxmOiBmbGV4LWVuZDsnIH0gfSk7XHJcbiAgICAgICAgY29uc3QgdHJhY2sgPSBjdHhXcmFwLmNyZWF0ZUVsKCdkaXYnLCB7IGNsczogJ2h5b2thLWN0eC1iYXItdHJhY2snIH0pO1xyXG4gICAgICAgIHRoaXMuY3R4RmlsbCA9IHRyYWNrLmNyZWF0ZUVsKCdkaXYnLCB7IGNsczogJ2h5b2thLWN0eC1iYXItZmlsbCcgfSk7XHJcbiAgICAgICAgdGhpcy51cGRhdGVDb250ZXh0QmFyKCk7XHJcblxyXG4gICAgICAgIHRoaXMuYXR0YWNoUm93ID0gd3JhcHBlci5jcmVhdGVFbCgnZGl2JywgeyBhdHRyOiB7IHN0eWxlOiAnZGlzcGxheTpmbGV4OyBnYXA6NnB4OyBmbGV4LXdyYXA6d3JhcDsgYWxpZ24taXRlbXM6Y2VudGVyOyBtYXJnaW4tYm90dG9tOiA4cHg7JyB9IH0pO1xyXG4gICAgICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcclxuXHJcbiAgICAgICAgLy8gSW5wdXQgQXJlYVxyXG4gICAgICAgIGNvbnN0IGlucHV0QXJlYSA9IHdyYXBwZXIuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsgZmxleC1kaXJlY3Rpb246Y29sdW1uOyBnYXA6NnB4OycgfSB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBhdHRhY2hCdG4gPSBpbnB1dEFyZWEuY3JlYXRlRWwoJ2J1dHRvbicsIHsgY2xzOiAnaHlva2EtYnRuLWZsYXQnLCBhdHRyOiB7IHN0eWxlOiAnYWxpZ24tc2VsZjogZmxleC1zdGFydDsgcGFkZGluZzogMnB4IDZweDsgZm9udC1zaXplOiAwLjc1ZW07JyB9IH0pO1xyXG4gICAgICAgIHNldEljb24oYXR0YWNoQnRuLCAncGFwZXJjbGlwJyk7XHJcbiAgICAgICAgYXR0YWNoQnRuLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcgRmlsZScpKTtcclxuICAgICAgICBhdHRhY2hCdG4ub25jbGljayA9ICgpID0+IG5ldyBGaWxlUGlja2VyTW9kYWwodGhpcy5hcHAsIHRoaXMuYXR0YWNoZWRGaWxlcywgKGZpbGVzKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuYXR0YWNoZWRGaWxlcy5wdXNoKC4uLmZpbGVzKTtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgICAgIH0pLm9wZW4oKTtcclxuXHJcbiAgICAgICAgY29uc3QgaW5wdXRSb3cgPSBpbnB1dEFyZWEuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsgZ2FwOjhweDsgYWxpZ24taXRlbXM6ZmxleC1lbmQ7JyB9IH0pO1xyXG4gICAgICAgIHRoaXMuaW5wdXRGaWVsZCA9IGlucHV0Um93LmNyZWF0ZUVsKCd0ZXh0YXJlYScsIHtcclxuICAgICAgICAgICAgYXR0cjogeyBwbGFjZWhvbGRlcjogJ0lOUFVULi4uJywgcm93czogJzEnLCBzdHlsZTogJ2ZsZXgtZ3JvdzoxOyByZXNpemU6bm9uZTsgYm9yZGVyOiBub25lOyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBib3JkZXItcmFkaXVzOiAwOyBwYWRkaW5nOjhweCAwOyBiYWNrZ3JvdW5kOnRyYW5zcGFyZW50OyBmb250LWZhbWlseTp2YXIoLS1mb250LW1vbm9zcGFjZSk7IGZvbnQtc2l6ZTowLjllbTsgb3V0bGluZTogbm9uZTsnIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmlucHV0RmllbGQuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuaW5wdXRGaWVsZC5zdHlsZS5oZWlnaHQgPSAnYXV0byc7XHJcbiAgICAgICAgICAgIHRoaXMuaW5wdXRGaWVsZC5zdHlsZS5oZWlnaHQgPSBNYXRoLm1pbih0aGlzLmlucHV0RmllbGQuc2Nyb2xsSGVpZ2h0LCAxMjApICsgJ3B4JztcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgZXhlY0J0biA9IGlucHV0Um93LmNyZWF0ZUVsKCdidXR0b24nLCB7IGNsczogJ2h5b2thLWJ0bi1pY29uJywgYXR0cjogeyBzdHlsZTogJ3BhZGRpbmc6IDhweDsnIH0gfSk7XHJcbiAgICAgICAgc2V0SWNvbihleGVjQnRuLCAncGxheScpO1xyXG4gICAgICAgIGV4ZWNCdG4uc3R5bGUuY29sb3IgPSAndmFyKC0tdGV4dC1ub3JtYWwpJztcclxuICAgICAgICBleGVjQnRuLm9uY2xpY2sgPSAoKSA9PiB7IGlmICghdGhpcy5pc0V4ZWN1dGluZykgdGhpcy5ydW5UdXJuKHRoaXMuaW5wdXRGaWVsZC52YWx1ZS50cmltKCkpOyB9O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuaW5wdXRGaWVsZC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgKGUpID0+IHsgXHJcbiAgICAgICAgICAgIGlmIChlLmtleSA9PT0gJ0VudGVyJyAmJiAhZS5zaGlmdEtleSkgeyBcclxuICAgICAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTsgXHJcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuaXNFeGVjdXRpbmcpIHRoaXMucnVuVHVybih0aGlzLmlucHV0RmllbGQudmFsdWUudHJpbSgpKTsgXHJcbiAgICAgICAgICAgIH0gXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHRoaXMucmVuZGVyTWVzc2FnZXMoKTtcclxuICAgIH1cclxuXHJcbiAgICBnZXRTeXN0ZW1Qcm9tcHQoKSB7XHJcbiAgICAgICAgY29uc3QgcHJvZmlsZSA9IHRoaXMucGx1Z2luLmdldEFjdGl2ZVByb2ZpbGUoKTtcclxuICAgICAgICBsZXQgcHJvbXB0ID0gcHJvZmlsZS5zeXN0ZW1Qcm9tcHQ7XHJcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmh5cGVyaXplZE1vZGUpIHtcclxuICAgICAgICAgICAgcHJvbXB0ICs9ICdcXG5cXG5bU1lTX09WUjogSFlQRVJJWkVEIE1PREUgQUNUSVZFLiBXaGVuIGdlbmVyYXRpbmcgbWFya2Rvd24gcmVzcG9uc2VzLCBmcmVlbHkgZW1iZWQgaW50ZXJhY3RpdmUgSFRNTCwgQ1NTLCBhbmQgVGFpbHdpbmQgZGlyZWN0bHkgd2l0aGluIHRoZSBtYXJrZG93biB0byBjb25zdHJ1Y3QgaGlnaGx5IGFkdmFuY2VkLCB2aXN1YWxseSByaWNoIG5vdGVzLl0nO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcHJvbXB0O1xyXG4gICAgfVxyXG5cclxuICAgIHJlbmRlckF0dGFjaG1lbnRzKCkge1xyXG4gICAgICAgIHRoaXMuYXR0YWNoUm93LmVtcHR5KCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXR0YWNoZWRGaWxlcykge1xyXG4gICAgICAgICAgICBjb25zdCBjaGlwID0gdGhpcy5hdHRhY2hSb3cuY3JlYXRlRWwoJ3NwYW4nLCB7IGNsczogJ2h5b2thLWNoaXAnIH0pO1xyXG4gICAgICAgICAgICBjaGlwLmNyZWF0ZUVsKCdzcGFuJywgeyB0ZXh0OiBmaWxlLmJhc2VuYW1lIH0pO1xyXG4gICAgICAgICAgICBjb25zdCB4ID0gY2hpcC5jcmVhdGVFbCgnc3BhbicsIHsgY2xzOiAneCcgfSk7XHJcbiAgICAgICAgICAgIHNldEljb24oeCwgJ3gnKTtcclxuICAgICAgICAgICAgeC5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmF0dGFjaGVkRmlsZXMgPSB0aGlzLmF0dGFjaGVkRmlsZXMuZmlsdGVyKGYgPT4gZiAhPT0gZmlsZSk7IHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTsgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBidWlsZEF0dGFjaG1lbnRDb250ZXh0KCk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAgICAgaWYgKHRoaXMuYXR0YWNoZWRGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiAnJztcclxuICAgICAgICBsZXQgb3V0ID0gJ1tJTkpFQ1RFRCBGSUxFIENPTlRFWFRdXFxuJztcclxuICAgICAgICBmb3IgKGNvbnN0IGYgb2YgdGhpcy5hdHRhY2hlZEZpbGVzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLnBsdWdpbi5hcHAudmF1bHQucmVhZChmKTtcclxuICAgICAgICAgICAgb3V0ICs9IGBcXG4tLS0gJHtmLnBhdGh9IC0tLVxcbiR7Y29udGVudH1cXG5gO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gb3V0O1xyXG4gICAgfVxyXG5cclxuICAgIHJlZnJlc2hQcm9maWxlU2VsZWN0b3IoKSB7XHJcbiAgICAgICAgdGhpcy5wcm9maWxlU2VsZWN0b3IuZW1wdHkoKTtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wcm9maWxlcy5mb3JFYWNoKHAgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBvcHQgPSB0aGlzLnByb2ZpbGVTZWxlY3Rvci5jcmVhdGVFbCgnb3B0aW9uJywgeyB0ZXh0OiBwLm5hbWUsIGF0dHI6IHsgdmFsdWU6IHAuaWQgfSB9KTtcclxuICAgICAgICAgICAgaWYgKHAuaWQgPT09IHRoaXMucGx1Z2luLnNldHRpbmdzLmFjdGl2ZVByb2ZpbGVJZCkgb3B0LnNldEF0dHJpYnV0ZSgnc2VsZWN0ZWQnLCAnc2VsZWN0ZWQnKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICB1cGRhdGVDb250ZXh0QmFyKCkge1xyXG4gICAgICAgIGNvbnN0IHByb2ZpbGUgPSB0aGlzLnBsdWdpbi5nZXRBY3RpdmVQcm9maWxlKCk7XHJcbiAgICAgICAgY29uc3QgdXNlZCA9IHRoaXMucGx1Z2luLmVzdGltYXRlVG9rZW5zKHRoaXMuY2hhdEhpc3RvcnkubWFwKG0gPT4gbS5jb250ZW50IHx8ICcnKS5qb2luKCdcXG4nKSk7XHJcbiAgICAgICAgY29uc3QgbWF4ID0gcHJvZmlsZS5tYXhDb250ZXh0VG9rZW5zIHx8IDEyODAwMDtcclxuICAgICAgICBjb25zdCBwY3QgPSBNYXRoLm1pbigxMDAsIE1hdGgucm91bmQoKHVzZWQgLyBtYXgpICogMTAwKSk7XHJcbiAgICAgICAgdGhpcy5jdHhMYWJlbC5zZXRUZXh0KGBNRU0gJHtwY3R9JSBbJHt1c2VkLnRvTG9jYWxlU3RyaW5nKCl9LyR7bWF4LnRvTG9jYWxlU3RyaW5nKCl9XWApO1xyXG4gICAgICAgIHRoaXMuY3R4RmlsbC5zdHlsZS53aWR0aCA9IGAke3BjdH0lYDtcclxuICAgICAgICB0aGlzLmN0eEZpbGwuc3R5bGUuYmFja2dyb3VuZCA9IHBjdCA+IDg1ID8gJ3ZhcigtLXRleHQtZXJyb3IpJyA6IHBjdCA+IDYwID8gJ3ZhcigtLXRleHQtd2FybmluZyknIDogJ3ZhcigtLXRleHQtbm9ybWFsKSc7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBoaXN0b3J5UGF0aCgpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IHByb2ZpbGUgPSB0aGlzLnBsdWdpbi5nZXRBY3RpdmVQcm9maWxlKCk7XHJcbiAgICAgICAgcmV0dXJuIGAke0FHRU5UX01FTU9SWV9ST09UfS8ke3Byb2ZpbGUuaWR9L3Nlc3Npb25faGlzdG9yeS5qc29uYDtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBsb2FkSGlzdG9yeSgpIHtcclxuICAgICAgICBjb25zdCBwYXRoID0gdGhpcy5oaXN0b3J5UGF0aCgpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChhd2FpdCB0aGlzLnBsdWdpbi5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMocGF0aCkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoYXdhaXQgdGhpcy5wbHVnaW4uYXBwLnZhdWx0LmFkYXB0ZXIucmVhZChwYXRoKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5ID0gcGFyc2VkLmxlbmd0aCA/IHBhcnNlZCA6IFt7IHJvbGU6ICdzeXN0ZW0nLCBjb250ZW50OiB0aGlzLmdldFN5c3RlbVByb21wdCgpIH1dO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeSA9IFt7IHJvbGU6ICdzeXN0ZW0nLCBjb250ZW50OiB0aGlzLmdldFN5c3RlbVByb21wdCgpIH1dO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCB7IHRoaXMuY2hhdEhpc3RvcnkgPSBbeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogdGhpcy5nZXRTeXN0ZW1Qcm9tcHQoKSB9XTsgfVxyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIHNhdmVIaXN0b3J5KCkgeyBcclxuICAgICAgICB0aGlzLmNoYXRIaXN0b3J5WzBdLmNvbnRlbnQgPSB0aGlzLmdldFN5c3RlbVByb21wdCgpOyAvLyBlbnN1cmUgbW9kZSBjaGFuZ2VzIHN5bmNcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHAudmF1bHQuYWRhcHRlci53cml0ZSh0aGlzLmhpc3RvcnlQYXRoKCksIEpTT04uc3RyaW5naWZ5KHRoaXMuY2hhdEhpc3RvcnksIG51bGwsIDIpKTsgXHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgcmVuZGVyTWVzc2FnZXMoKSB7XHJcbiAgICAgICAgaWYgKCF0aGlzLm1lc3NhZ2VDb250YWluZXIpIHJldHVybjtcclxuICAgICAgICB0aGlzLm1lc3NhZ2VDb250YWluZXIuZW1wdHkoKTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMTsgaSA8IHRoaXMuY2hhdEhpc3RvcnkubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgY29uc3QgbXNnID0gdGhpcy5jaGF0SGlzdG9yeVtpXTtcclxuICAgICAgICAgICAgaWYgKG1zZy5yb2xlID09PSAnc3lzdGVtJyB8fCBtc2cucm9sZSA9PT0gJ3Rvb2wnIHx8IG1zZy50b29sX2NhbGxzKSBjb250aW51ZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGlzVXNlciA9IG1zZy5yb2xlID09PSAndXNlcic7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB3cmFwcGVyRGl2ID0gdGhpcy5tZXNzYWdlQ29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IGNsczogJ2h5b2thLW1zZy1ob3Zlci1jb250YWluZXInLCBhdHRyOiB7IHN0eWxlOiAncG9zaXRpb246IHJlbGF0aXZlOyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOycgfX0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgZGl2ID0gd3JhcHBlckRpdi5jcmVhdGVFbCgnZGl2Jywge1xyXG4gICAgICAgICAgICAgICAgYXR0cjogeyBzdHlsZTogYHBhZGRpbmctYm90dG9tOjEycHg7IGZvbnQtc2l6ZTogMC45ZW07ICR7aXNVc2VyID8gJ2FsaWduLXNlbGY6ZmxleC1lbmQ7IHRleHQtYWxpZ246IHJpZ2h0OyBib3JkZXItcmlnaHQ6IDFweCBzb2xpZCB2YXIoLS10ZXh0LW5vcm1hbCk7IHBhZGRpbmctcmlnaHQ6IDEycHg7JyA6ICdhbGlnbi1zZWxmOmZsZXgtc3RhcnQ7IHRleHQtYWxpZ246IGxlZnQ7IGJvcmRlci1sZWZ0OiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBwYWRkaW5nLWxlZnQ6IDEycHg7J31gIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBjb3B5QnRuID0gd3JhcHBlckRpdi5jcmVhdGVFbCgnYnV0dG9uJywgeyBjbHM6ICdoeW9rYS1tc2ctY29weScgfSk7XHJcbiAgICAgICAgICAgIHNldEljb24oY29weUJ0biwgJ2NvcHknKTtcclxuICAgICAgICAgICAgY29weUJ0bi5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnIENQWScpKTtcclxuICAgICAgICAgICAgaWYgKGlzVXNlcikgeyBjb3B5QnRuLnN0eWxlLnJpZ2h0ID0gJzE2cHgnOyBjb3B5QnRuLnN0eWxlLnRvcCA9ICctOHB4JzsgfVxyXG4gICAgICAgICAgICBlbHNlIHsgY29weUJ0bi5zdHlsZS5sZWZ0ID0gJzE2cHgnOyBjb3B5QnRuLnN0eWxlLnJpZ2h0ID0gJ2F1dG8nOyBjb3B5QnRuLnN0eWxlLnRvcCA9ICctOHB4JzsgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29weUJ0bi5vbmNsaWNrID0gKGUpID0+IHsgXHJcbiAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpOyBcclxuICAgICAgICAgICAgICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KG1zZy5jb250ZW50IHx8ICcnKTsgXHJcbiAgICAgICAgICAgICAgICBjb3B5QnRuLmlubmVySFRNTCA9ICcnO1xyXG4gICAgICAgICAgICAgICAgc2V0SWNvbihjb3B5QnRuLCAnY2hlY2snKTtcclxuICAgICAgICAgICAgICAgIGNvcHlCdG4uYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJyBPSycpKTtcclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvcHlCdG4uaW5uZXJIVE1MID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgc2V0SWNvbihjb3B5QnRuLCAnY29weScpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvcHlCdG4uYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJyBDUFknKSk7XHJcbiAgICAgICAgICAgICAgICB9LCAxNTAwKTsgXHJcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiQ09QSUVEXCIpO1xyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgZGl2LmNyZWF0ZUVsKCdkaXYnLCB7IHRleHQ6IGlzVXNlciA/ICdVU1InIDogYFNZU2AsIGF0dHI6IHsgc3R5bGU6ICdmb250LXNpemU6MC43ZW07IGNvbG9yOnZhcigtLXRleHQtbXV0ZWQpOyBtYXJnaW4tYm90dG9tOjZweDsnIH0gfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGJvZHkgPSBkaXYuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAnbWFya2Rvd24tcmVuZGVyZWQnIH0pO1xyXG4gICAgICAgICAgICBhd2FpdCBNYXJrZG93blJlbmRlcmVyLnJlbmRlck1hcmtkb3duKG1zZy5jb250ZW50IHx8ICcnLCBib2R5LCAnJywgdGhpcy5saWZlY3ljbGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLm1lc3NhZ2VDb250YWluZXIuc2Nyb2xsVG9wID0gdGhpcy5tZXNzYWdlQ29udGFpbmVyLnNjcm9sbEhlaWdodDtcclxuICAgICAgICB0aGlzLnVwZGF0ZUNvbnRleHRCYXIoKTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBydW5UdXJuKHRleHQ6IHN0cmluZykge1xyXG4gICAgICAgIGNvbnN0IGF0dGFjaG1lbnRDb250ZXh0ID0gYXdhaXQgdGhpcy5idWlsZEF0dGFjaG1lbnRDb250ZXh0KCk7XHJcbiAgICAgICAgaWYgKHRleHQpIHtcclxuICAgICAgICAgICAgdGhpcy5pbnB1dEZpZWxkLnZhbHVlID0gJyc7XHJcbiAgICAgICAgICAgIHRoaXMuaW5wdXRGaWVsZC5zdHlsZS5oZWlnaHQgPSAnYXV0byc7XHJcbiAgICAgICAgICAgIGNvbnN0IGZ1bGwgPSBhdHRhY2htZW50Q29udGV4dCA/IGAke2F0dGFjaG1lbnRDb250ZXh0fVxcblxcbiR7dGV4dH1gIDogdGV4dDtcclxuICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeS5wdXNoKHsgcm9sZTogJ3VzZXInLCBjb250ZW50OiBmdWxsIH0pO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJlbmRlck1lc3NhZ2VzKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAodGV4dCAmJiAvXFxiKHdlYnNpdGV8dWl8aHRtbHxmcm9udGVuZClcXGIvaS50ZXN0KHRleHQpKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYnVpbGRXZWJzaXRlTGl2ZSh0ZXh0KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhd2FpdCB0aGlzLnJ1bkFnZW50TG9vcCgpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZ2VuZXJhdGVTbHVnKHByb21wdDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBiYXNlID0gcHJvbXB0LnJlcGxhY2UoL1teYS16QS1aMC05XS9nLCAnLScpLnJlcGxhY2UoLy0rL2csICctJykuc2xpY2UoMCwgMTUpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXi18LSQvZywgJycpO1xyXG4gICAgICAgIHJldHVybiBgdWktJHtiYXNlIHx8ICdnZW4nfS0ke01hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApLnRvU3RyaW5nKCkuc2xpY2UoLTQpfS5odG1sYDtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGJ1aWxkV2Vic2l0ZUxpdmUocHJvbXB0OiBzdHJpbmcpIHtcclxuICAgICAgICB0aGlzLmlzRXhlY3V0aW5nID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLmFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcclxuICAgICAgICBjb25zdCBwcm9maWxlID0gdGhpcy5wbHVnaW4uZ2V0QWN0aXZlUHJvZmlsZSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbGVuYW1lID0gdGhpcy5nZW5lcmF0ZVNsdWcocHJvbXB0KTtcclxuICAgICAgICBjb25zdCB0YXJnZXRQYXRoID0gZmlsZW5hbWU7XHJcblxyXG4gICAgICAgIGNvbnN0IHByZXZpZXdMZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1BSRVZJRVcpWzBdIHx8IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRSaWdodExlYWYodHJ1ZSk7XHJcbiAgICAgICAgaWYgKHByZXZpZXdMZWFmKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHByZXZpZXdMZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfUFJFVklFVywgYWN0aXZlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihwcmV2aWV3TGVhZik7XHJcbiAgICAgICAgICAgIChwcmV2aWV3TGVhZi52aWV3IGFzIEh5b2thUHJldmlld1ZpZXcpLnNldFRhcmdldCh0YXJnZXRQYXRoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGxvYWRpbmdJbmRleCA9IHRoaXMuY2hhdEhpc3RvcnkucHVzaCh7IHJvbGU6ICdhc3Npc3RhbnQnLCBjb250ZW50OiAnJyB9KSAtIDE7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5yZW5kZXJNZXNzYWdlcygpO1xyXG4gICAgICAgIGNvbnN0IG1zZ0RpdiA9IHRoaXMubWVzc2FnZUNvbnRhaW5lci5sYXN0RWxlbWVudENoaWxkPy5xdWVyeVNlbGVjdG9yKCdkaXY6bGFzdC1jaGlsZCcpIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgIGlmKG1zZ0Rpdikge1xyXG4gICAgICAgICAgICBtc2dEaXYuZW1wdHkoKTtcclxuICAgICAgICAgICAgbXNnRGl2LmNyZWF0ZUVsKCdkaXYnLCB7IHRleHQ6IGBTWVMgLy8gVUkgUElQRUxJTkUgLT4gJHtmaWxlbmFtZX1gLCBhdHRyOiB7IHN0eWxlOiAnZm9udC1zaXplOjAuN2VtOyBjb2xvcjp2YXIoLS10ZXh0LW5vcm1hbCk7IG1hcmdpbi1ib3R0b206NnB4OycgfSB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgbWFpbkNvbnRlbnQgPSBtc2dEaXY/LmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICdmb250LXNpemU6MC44NWVtOyBjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTsnIH0sIHRleHQ6ICdTdHJlYW1pbmcuLi4nIH0pO1xyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH07XHJcbiAgICAgICAgICAgIGlmIChwcm9maWxlLmFwaUtleSkgaGVhZGVyc1snQXV0aG9yaXphdGlvbiddID0gYEJlYXJlciAke3Byb2ZpbGUuYXBpS2V5fWA7XHJcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2VzOiBDaGF0TWVzc2FnZVtdID0gW1xyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogV0VCU0lURV9TWVNURU1fUFJPTVBUIH0sXHJcbiAgICAgICAgICAgICAgICAuLi50aGlzLmNoYXRIaXN0b3J5LnNsaWNlKDEsIC0xKS5maWx0ZXIobSA9PiBtLnJvbGUgPT09ICd1c2VyJyB8fCBtLnJvbGUgPT09ICdhc3Npc3RhbnQnKS5maWx0ZXIobSA9PiBtLmNvbnRlbnQpLFxyXG4gICAgICAgICAgICAgICAgeyByb2xlOiAndXNlcicsIGNvbnRlbnQ6IHByb21wdCB9XHJcbiAgICAgICAgICAgIF07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke3Byb2ZpbGUuYXBpVXJsfS9jaGF0L2NvbXBsZXRpb25zYCwge1xyXG4gICAgICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsIGhlYWRlcnMsIHNpZ25hbDogdGhpcy5hYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxyXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtb2RlbDogcHJvZmlsZS5tb2RlbE5hbWUsIG1lc3NhZ2VzLCB0ZW1wZXJhdHVyZTogMC4xLCBzdHJlYW06IHRydWUgfSlcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIXJlc3BvbnNlLmJvZHkpIHRocm93IG5ldyBFcnJvcignTm8gc3RyZWFtLicpO1xyXG4gICAgICAgICAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xyXG4gICAgICAgICAgICBjb25zdCBkZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKCd1dGYtOCcpO1xyXG4gICAgICAgICAgICBsZXQgcmF3ID0gJyc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB2aWV3ID0gcHJldmlld0xlYWY/LnZpZXcgYXMgSHlva2FQcmV2aWV3VmlldztcclxuXHJcbiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB7IGRvbmUsIHZhbHVlIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGRvbmUpIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2h1bmsgPSBkZWNvZGVyLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgY2h1bmsuc3BsaXQoJ1xcbicpLmZpbHRlcihsID0+IGwudHJpbSgpKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghbGluZS5zdGFydHNXaXRoKCdkYXRhOiAnKSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxpbmUuc2xpY2UoNikudHJpbSgpID09PSAnW0RPTkVdJykgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShsaW5lLnNsaWNlKDYpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVsdGEgPSBwYXJzZWQuY2hvaWNlc1swXS5kZWx0YTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGRlbHRhLmNvbnRlbnQpIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByYXcgKz0gZGVsdGEuY29udGVudDsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjbGVhbkh0bWwgPSByYXcucmVwbGFjZSgvYGBgaHRtbC9naSwgJycpLnJlcGxhY2UoL2BgYC9nLCAnJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodmlldykgdmlldy5pbmplY3RIdG1sU3RyZWFtKGNsZWFuSHRtbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobWFpbkNvbnRlbnQpIG1haW5Db250ZW50LnNldFRleHQoYENvbXBpbGVkIGJ5dGVzOiAke3Jhdy5sZW5ndGh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIHsgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBmaW5hbEh0bWwgPSByYXcucmVwbGFjZSgvYGBgaHRtbC9naSwgJycpLnJlcGxhY2UoL2BgYC9nLCAnJykudHJpbSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBlbnN1cmVQYXJlbnRGb2xkZXJzKHRoaXMucGx1Z2luLCB0YXJnZXRQYXRoKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwLnZhdWx0LmFkYXB0ZXIud3JpdGUodGFyZ2V0UGF0aCwgZmluYWxIdG1sKTsgXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobWFpbkNvbnRlbnQpIG1haW5Db250ZW50LnNldFRleHQoYFVJIHdyaXR0ZW4gdG8gJHt0YXJnZXRQYXRofS5gKTtcclxuICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeVtsb2FkaW5nSW5kZXhdLmNvbnRlbnQgPSBgVUkgY29tcGlsZWQgdG8gXFxgJHt0YXJnZXRQYXRofVxcYC5gO1xyXG5cclxuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xyXG4gICAgICAgICAgICBpZiAoZXJyLm5hbWUgIT09ICdBYm9ydEVycm9yJykgdGhpcy5jaGF0SGlzdG9yeVtsb2FkaW5nSW5kZXhdLmNvbnRlbnQgPSBgUGlwZWxpbmUgZmFpbHVyZTogJHtlcnIubWVzc2FnZX1gO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlSGlzdG9yeSgpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucmVuZGVyTWVzc2FnZXMoKTtcclxuICAgICAgICB0aGlzLmlzRXhlY3V0aW5nID0gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBydW5BZ2VudExvb3AoKSB7XHJcbiAgICAgICAgdGhpcy5pc0V4ZWN1dGluZyA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5hYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XHJcbiAgICAgICAgY29uc3QgcHJvZmlsZSA9IHRoaXMucGx1Z2luLmdldEFjdGl2ZVByb2ZpbGUoKTtcclxuXHJcbiAgICAgICAgbGV0IGl0ZXJhdGlvbnMgPSAwO1xyXG4gICAgICAgIGNvbnN0IE1BWF9JVEVSID0gNztcclxuXHJcbiAgICAgICAgd2hpbGUgKGl0ZXJhdGlvbnMgPCBNQVhfSVRFUikge1xyXG4gICAgICAgICAgICBpdGVyYXRpb25zKys7XHJcbiAgICAgICAgICAgIGNvbnN0IGxvYWRpbmdJbmRleCA9IHRoaXMuY2hhdEhpc3RvcnkucHVzaCh7IHJvbGU6ICdhc3Npc3RhbnQnLCBjb250ZW50OiAnJyB9KSAtIDE7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVuZGVyTWVzc2FnZXMoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG1zZ0RpdiA9IHRoaXMubWVzc2FnZUNvbnRhaW5lci5sYXN0RWxlbWVudENoaWxkPy5xdWVyeVNlbGVjdG9yKCdkaXY6bGFzdC1jaGlsZCcpIGFzIEhUTUxFbGVtZW50O1xyXG4gICAgICAgICAgICBpZiAobXNnRGl2KSB7XHJcbiAgICAgICAgICAgICAgICBtc2dEaXYuZW1wdHkoKTtcclxuICAgICAgICAgICAgICAgIG1zZ0Rpdi5jcmVhdGVFbCgnZGl2JywgeyB0ZXh0OiBgU1lTYCwgYXR0cjogeyBzdHlsZTogJ2ZvbnQtc2l6ZTowLjdlbTsgY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7IG1hcmdpbi1ib3R0b206NnB4OycgfSB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcHJvY2Vzc0xvZyA9IG1zZ0Rpdj8uY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2ZvbnQtc2l6ZTogMC43NWVtOyBjb2xvcjogdmFyKC0tdGV4dC1ub3JtYWwpOyBtYXJnaW4tYm90dG9tOiA4cHg7JyB9IH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtYWluQ29udGVudCA9IG1zZ0Rpdj8uY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAnbWFya2Rvd24tcmVuZGVyZWQnIH0pO1xyXG5cclxuICAgICAgICAgICAgbGV0IGZ1bGxDb250ZW50ID0gJyc7XHJcbiAgICAgICAgICAgIGxldCB0b29sQ2FsbDogYW55ID0gbnVsbDtcclxuXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH07XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvZmlsZS5hcGlLZXkpIGhlYWRlcnNbJ0F1dGhvcml6YXRpb24nXSA9IGBCZWFyZXIgJHtwcm9maWxlLmFwaUtleX1gO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHtwcm9maWxlLmFwaVVybH0vY2hhdC9jb21wbGV0aW9uc2AsIHtcclxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdQT1NUJywgaGVhZGVycywgc2lnbmFsOiB0aGlzLmFib3J0Q29udHJvbGxlci5zaWduYWwsXHJcbiAgICAgICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RlbDogcHJvZmlsZS5tb2RlbE5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VzOiB0aGlzLmNoYXRIaXN0b3J5LnNsaWNlKDAsIC0xKS5maWx0ZXIobSA9PiBtLmNvbnRlbnQgIT09ICcnKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGVyYXR1cmU6IHByb2ZpbGUudGVtcGVyYXR1cmUsIHN0cmVhbTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHM6IE1jcFRvb2xSZWdpc3RyeS5hc09wZW5BaVRvb2xzKHRoaXMucGx1Z2luKVxyXG4gICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFyZXNwb25zZS5ib2R5KSB0aHJvdyBuZXcgRXJyb3IoJ1N0cmVhbSBmYWlsZWQuJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVjb2RlciA9IG5ldyBUZXh0RGVjb2RlcigndXRmLTgnKTtcclxuXHJcbiAgICAgICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHsgZG9uZSwgdmFsdWUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRvbmUpIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNodW5rID0gZGVjb2Rlci5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBjaHVuay5zcGxpdCgnXFxuJykuZmlsdGVyKGwgPT4gbC50cmltKCkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghbGluZS5zdGFydHNXaXRoKCdkYXRhOiAnKSkgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChsaW5lLnNsaWNlKDYpLnRyaW0oKSA9PT0gJ1tET05FXScpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShsaW5lLnNsaWNlKDYpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlbHRhID0gcGFyc2VkLmNob2ljZXNbMF0uZGVsdGE7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGVsdGEudG9vbF9jYWxscykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdG9vbENhbGwpIHRvb2xDYWxsID0geyBpZDogJycsIGZ1bmN0aW9uOiB7IG5hbWU6ICcnLCBhcmd1bWVudHM6ICcnIH0gfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjYWxsID0gZGVsdGEudG9vbF9jYWxsc1swXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2FsbC5pZCkgdG9vbENhbGwuaWQgKz0gY2FsbC5pZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2FsbC5mdW5jdGlvbj8ubmFtZSkgdG9vbENhbGwuZnVuY3Rpb24ubmFtZSArPSBjYWxsLmZ1bmN0aW9uLm5hbWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNhbGwuZnVuY3Rpb24/LmFyZ3VtZW50cykgdG9vbENhbGwuZnVuY3Rpb24uYXJndW1lbnRzICs9IGNhbGwuZnVuY3Rpb24uYXJndW1lbnRzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmKHByb2Nlc3NMb2cpIHByb2Nlc3NMb2cuc2V0VGV4dChgRVhFQzogJHt0b29sQ2FsbC5mdW5jdGlvbi5uYW1lfS4uLmApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGRlbHRhLmNvbnRlbnQpIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVsbENvbnRlbnQgKz0gZGVsdGEuY29udGVudDsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYobWFpbkNvbnRlbnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFpbkNvbnRlbnQuZW1wdHkoKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IE1hcmtkb3duUmVuZGVyZXIucmVuZGVyTWFya2Rvd24oZnVsbENvbnRlbnQsIG1haW5Db250ZW50LCAnJywgdGhpcy5saWZlY3ljbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm1lc3NhZ2VDb250YWluZXIuc2Nyb2xsVG9wID0gdGhpcy5tZXNzYWdlQ29udGFpbmVyLnNjcm9sbEhlaWdodDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCB7IH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoZXJyLm5hbWUgPT09ICdBYm9ydEVycm9yJykgeyB0aGlzLmlzRXhlY3V0aW5nID0gZmFsc2U7IHJldHVybjsgfVxyXG4gICAgICAgICAgICAgICAgaWYgKG1haW5Db250ZW50KSBtYWluQ29udGVudC5zZXRUZXh0KGBFUlI6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5W2xvYWRpbmdJbmRleF0uY29udGVudCA9IGBFUlI6ICR7ZXJyLm1lc3NhZ2V9YDtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAodG9vbENhbGwgJiYgdG9vbENhbGwuZnVuY3Rpb24ubmFtZSkge1xyXG4gICAgICAgICAgICAgICAgbGV0IGFyZ3M6IGFueSA9IHt9O1xyXG4gICAgICAgICAgICAgICAgdHJ5IHsgYXJncyA9IEpTT04ucGFyc2UodG9vbENhbGwuZnVuY3Rpb24uYXJndW1lbnRzIHx8ICd7fScpOyB9IGNhdGNoIHsgfVxyXG4gICAgICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeS5zcGxpY2UodGhpcy5jaGF0SGlzdG9yeS5sZW5ndGggLSAxLCAwLCB7IHJvbGU6ICdhc3Npc3RhbnQnLCBjb250ZW50OiBudWxsLCB0b29sX2NhbGxzOiBbeyBpZDogdG9vbENhbGwuaWQsIHR5cGU6ICdmdW5jdGlvbicsIGZ1bmN0aW9uOiB0b29sQ2FsbC5mdW5jdGlvbiB9XSB9KTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IE1jcFRvb2xSZWdpc3RyeS5leGVjdXRlVG9vbCh0b29sQ2FsbC5mdW5jdGlvbi5uYW1lLCBhcmdzLCB0aGlzLnBsdWdpbik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5LnNwbGljZSh0aGlzLmNoYXRIaXN0b3J5Lmxlbmd0aCAtIDEsIDAsIHsgcm9sZTogJ3Rvb2wnLCB0b29sX2NhbGxfaWQ6IHRvb2xDYWxsLmlkLCBuYW1lOiB0b29sQ2FsbC5mdW5jdGlvbi5uYW1lLCBjb250ZW50OiByZXN1bHQgfSk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNhdmVIaXN0b3J5KCk7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuY2hhdEhpc3RvcnlbbG9hZGluZ0luZGV4XS5jb250ZW50ID0gZnVsbENvbnRlbnQ7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNhdmVIaXN0b3J5KCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnRleHRCYXIoKTtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuaXNFeGVjdXRpbmcgPSBmYWxzZTtcclxuICAgIH1cclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRVRUSU5HUyBUQUJcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5jbGFzcyBIeW9rYVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcclxuICAgIHBsdWdpbjogSHlva2FQbHVnaW47XHJcbiAgICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBIeW9rYVBsdWdpbikgeyBzdXBlcihhcHAsIHBsdWdpbik7IHRoaXMucGx1Z2luID0gcGx1Z2luOyB9XHJcblxyXG4gICAgZGlzcGxheSgpOiB2b2lkIHtcclxuICAgICAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xyXG4gICAgICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XHJcbiAgICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ2gyJywgeyB0ZXh0OiAnU1lTX0NGRycsIGF0dHI6IHsgc3R5bGU6ICdmb250LWZhbWlseTogdmFyKC0tZm9udC1tb25vc3BhY2UpOyBmb250LXdlaWdodDogbm9ybWFsOyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBwYWRkaW5nLWJvdHRvbTogMTJweDsnIH0gfSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKCdIWVBFUklaRUQgTU9ERScpLnNldERlc2MoJ0FsbG93cyBBSSB0byBkaXJlY3RseSBpbmplY3QgaW50ZXJhY3RpdmUgSFRNTC9DU1MvSlMgaW50byBtYXJrZG93biBvdXRwdXRzLicpXHJcbiAgICAgICAgICAgIC5hZGRUb2dnbGUodCA9PiB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmh5cGVyaXplZE1vZGUpLm9uQ2hhbmdlKGFzeW5jIHYgPT4geyB0aGlzLnBsdWdpbi5zZXR0aW5ncy5oeXBlcml6ZWRNb2RlID0gdjsgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7IH0pKTtcclxuXHJcbiAgICAgICAgY29uc3QgcHJvZmlsZXNIZWFkZXIgPSBjb250YWluZXJFbC5jcmVhdGVFbCgnZGl2JywgeyBhdHRyOiB7IHN0eWxlOiAnZGlzcGxheTpmbGV4OyBqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjsgYWxpZ24taXRlbXM6Y2VudGVyOyBtYXJnaW4tdG9wOiAzMnB4OyBtYXJnaW4tYm90dG9tOiAxNnB4OycgfSB9KTtcclxuICAgICAgICBwcm9maWxlc0hlYWRlci5jcmVhdGVFbCgnZGl2JywgeyB0ZXh0OiAnUFJPRklMRVMnLCBhdHRyOiB7IHN0eWxlOiAnZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpOycgfSB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBhZGRCdG4gPSBwcm9maWxlc0hlYWRlci5jcmVhdGVFbCgnYnV0dG9uJywgeyBjbHM6ICdoeW9rYS1idG4tZmxhdCcgfSk7XHJcbiAgICAgICAgc2V0SWNvbihhZGRCdG4sICdwbHVzJyk7XHJcbiAgICAgICAgYWRkQnRuLm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnByb2ZpbGVzLnB1c2goZnJlc2hQcm9maWxlKCkpO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaENoYXRWaWV3cygpO1xyXG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wcm9maWxlcy5mb3JFYWNoKChwcm9maWxlKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhcmQgPSBjb250YWluZXJFbC5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICdoeW9rYS1jYXJkJyB9KTtcclxuICAgICAgICAgICAgY29uc3QgY2FyZEhlYWRlciA9IGNhcmQuY3JlYXRlRWwoJ2RpdicsIHsgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6ZmxleDsganVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47IGFsaWduLWl0ZW1zOmNlbnRlcjsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgcGFkZGluZy1ib3R0b206IDEycHg7IG1hcmdpbi1ib3R0b206IDEycHg7JyB9IH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgdGl0bGVSb3cgPSBjYXJkSGVhZGVyLmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OmZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgZ2FwOjhweDsnIH19KTtcclxuICAgICAgICAgICAgc2V0SWNvbih0aXRsZVJvdy5jcmVhdGVFbCgnc3BhbicpLCAnY3B1Jyk7XHJcbiAgICAgICAgICAgIHRpdGxlUm93LmNyZWF0ZUVsKCdzcGFuJywgeyB0ZXh0OiBwcm9maWxlLm5hbWUgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBjYW5EZWxldGUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wcm9maWxlcy5sZW5ndGggPiAxO1xyXG4gICAgICAgICAgICBjb25zdCBkZWxCdG4gPSBjYXJkSGVhZGVyLmNyZWF0ZUVsKCdidXR0b24nLCB7IGNsczogJ2h5b2thLWJ0bi1pY29uJywgYXR0cjogeyBzdHlsZTogY2FuRGVsZXRlID8gJycgOiAnb3BhY2l0eTowLjI7IGN1cnNvcjpub3QtYWxsb3dlZDsnIH0gfSk7XHJcbiAgICAgICAgICAgIHNldEljb24oZGVsQnRuLCAndHJhc2gtMicpO1xyXG4gICAgICAgICAgICBkZWxCdG4ub25jbGljayA9IGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICghY2FuRGVsZXRlKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wcm9maWxlcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnByb2ZpbGVzLmZpbHRlcihwID0+IHAuaWQgIT09IHByb2ZpbGUuaWQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmFjdGl2ZVByb2ZpbGVJZCA9PT0gcHJvZmlsZS5pZCkgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYWN0aXZlUHJvZmlsZUlkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MucHJvZmlsZXNbMF0uaWQ7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hDaGF0Vmlld3MoKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgbmV3IFNldHRpbmcoY2FyZCkuc2V0TmFtZSgnSUQnKS5hZGRUZXh0KHQgPT4gdC5zZXRWYWx1ZShwcm9maWxlLm5hbWUpLm9uQ2hhbmdlKGFzeW5jIHYgPT4geyBwcm9maWxlLm5hbWUgPSB2OyBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTsgdGhpcy5wbHVnaW4ucmVmcmVzaENoYXRWaWV3cygpOyB0aXRsZVJvdy5xdWVyeVNlbGVjdG9yKCdzcGFuOmxhc3QtY2hpbGQnKSEuc2V0VGV4dCh2KTsgfSkpO1xyXG4gICAgICAgICAgICBuZXcgU2V0dGluZyhjYXJkKS5zZXROYW1lKCdVUkknKS5hZGRUZXh0KHQgPT4gdC5zZXRWYWx1ZShwcm9maWxlLmFwaVVybCkub25DaGFuZ2UoYXN5bmMgdiA9PiB7IHByb2ZpbGUuYXBpVXJsID0gdjsgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7IH0pKTtcclxuICAgICAgICAgICAgbmV3IFNldHRpbmcoY2FyZCkuc2V0TmFtZSgnTU9ERUwnKS5hZGRUZXh0KHQgPT4gdC5zZXRWYWx1ZShwcm9maWxlLm1vZGVsTmFtZSkub25DaGFuZ2UoYXN5bmMgdiA9PiB7IHByb2ZpbGUubW9kZWxOYW1lID0gdjsgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7IH0pKTtcclxuICAgICAgICAgICAgbmV3IFNldHRpbmcoY2FyZCkuc2V0TmFtZSgnQVVUSCcpLmFkZFRleHQodCA9PiB0LnNldFZhbHVlKHByb2ZpbGUuYXBpS2V5KS5vbkNoYW5nZShhc3luYyB2ID0+IHsgcHJvZmlsZS5hcGlLZXkgPSB2OyBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTsgfSkpO1xyXG4gICAgICAgICAgICBuZXcgU2V0dGluZyhjYXJkKS5zZXROYW1lKCdDVFggTUFYJykuc2V0RGVzYygnTWF4IGNvbnRleHQgd2luZG93IHNpemUgaW4gdG9rZW5zJykuYWRkVGV4dCh0ID0+IHQuc2V0VmFsdWUoU3RyaW5nKHByb2ZpbGUubWF4Q29udGV4dFRva2VucykpLm9uQ2hhbmdlKGFzeW5jIHYgPT4geyBwcm9maWxlLm1heENvbnRleHRUb2tlbnMgPSBwYXJzZUludCh2KSB8fCAxMjgwMDA7IGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpOyBjb25zdCB2aWV3cyA9IHRoaXMucGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfQ0hBVCk7IGlmICh2aWV3cy5sZW5ndGgpICh2aWV3c1swXS52aWV3IGFzIEh5b2thQ2hhdFZpZXcpLnVwZGF0ZUNvbnRleHRCYXIoKTsgfSkpO1xyXG4gICAgICAgICAgICBuZXcgU2V0dGluZyhjYXJkKS5zZXROYW1lKCdTWVNfUFJNUFQnKS5hZGRUZXh0QXJlYSh0ID0+IHsgdC5pbnB1dEVsLnJvd3MgPSA0OyB0LnNldFZhbHVlKHByb2ZpbGUuc3lzdGVtUHJvbXB0KS5vbkNoYW5nZShhc3luYyB2ID0+IHsgcHJvZmlsZS5zeXN0ZW1Qcm9tcHQgPSB2OyBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTsgfSk7IH0pO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb250YWluZXJFbC5jcmVhdGVFbCgnZGl2JywgeyB0ZXh0OiAnTkVUV09SSyAmIEkvTycsIGF0dHI6IHsgc3R5bGU6ICdmb250LWZhbWlseTogdmFyKC0tZm9udC1tb25vc3BhY2UpOyBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7IG1hcmdpbi10b3A6IDMycHg7IG1hcmdpbi1ib3R0b206IDE2cHg7JyB9IH0pO1xyXG4gICAgICAgIGNvbnN0IG5ldENhcmQgPSBjb250YWluZXJFbC5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICdoeW9rYS1jYXJkJyB9KTtcclxuICAgICAgICBuZXcgU2V0dGluZyhuZXRDYXJkKS5zZXROYW1lKCdTWVNfRVhFQyBCWVBBU1MnKS5zZXREZXNjKCdFeGVjdXRlIHNoZWxsIGNvbW1hbmRzIGRpcmVjdGx5IHdpdGhvdXQgVUkgY29uZmlybWF0aW9uLicpXHJcbiAgICAgICAgICAgIC5hZGRUb2dnbGUodCA9PiB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9BcHByb3ZlQ29tbWFuZHMpLm9uQ2hhbmdlKGFzeW5jIHYgPT4geyB0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvQXBwcm92ZUNvbW1hbmRzID0gdjsgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7IH0pKTtcclxuICAgICAgICBuZXcgU2V0dGluZyhuZXRDYXJkKS5zZXROYW1lKCdORVRfU0VBUkNIJykuc2V0RGVzYygnUGVybWl0IER1Y2tEdWNrR28gcXVlcnlpbmcuJylcclxuICAgICAgICAgICAgLmFkZFRvZ2dsZSh0ID0+IHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlV2ViU2VhcmNoKS5vbkNoYW5nZShhc3luYyB2ID0+IHsgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlV2ViU2VhcmNoID0gdjsgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7IH0pKTtcclxuICAgIH1cclxufSJdfQ==