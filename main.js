'use strict';

var obsidian = require('obsidian');

// main.ts
var VIEW_TYPE_HYOKA = "hyoka-chat-view";
var McpToolRegistry = class {
  static getCapabilities() {
    return [
      {
        name: "write_agent_memory",
        description: "Appends long-term contextual historical data logs directly to the profile memory workspace file system.",
        inputSchema: {
          type: "object",
          properties: {
            profileId: { type: "string", description: "The active tracking ID string of the current operational persona instance." },
            logEntry: { type: "string", description: "The raw markdown string text payload block to append to disk storage archives." }
          },
          required: ["profileId", "logEntry"]
        }
      },
      {
        name: "create_note",
        description: "Creates a new markdown note in the vault with the specified content.",
        inputSchema: {
          type: "object",
          properties: {
            filename: { type: "string", description: "Name of the file including .md extension (e.g., 'Project_Plan.md')" },
            content: { type: "string", description: "The markdown content to write into the file." },
            folder: { type: "string", description: "Optional. The folder path to create it in. Use '' for root." }
          },
          required: ["filename", "content"]
        }
      },
      {
        name: "read_note",
        description: "Reads the content of an existing note to learn from it or use it as context.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "The exact path of the file (e.g., 'Notes/Idea.md')" } },
          required: ["path"]
        }
      },
      {
        name: "search_vault",
        description: "Performs a raw text search across all markdown files in the vault to find references to a specific keyword or phrase.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "The exact text phrase or keyword to search for." } },
          required: ["query"]
        }
      },
      {
        name: "browse_web_page",
        description: "Fetches and reads the text content of a live URL using Obsidian's internal web engine.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", description: "The full http/https URL to browse." } },
          required: ["url"]
        }
      },
      {
        name: "request_file_deletion",
        description: "Requests user permission to delete a file. YOU MUST CALL THIS to delete a file.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path of the file to delete." },
            reason: { type: "string", description: "Explanation for the user why this should be deleted." }
          },
          required: ["path", "reason"]
        }
      }
    ];
  }
  static async executeTool(name, args, plugin) {
    try {
      if (name === "write_agent_memory") {
        const { profileId, logEntry } = args;
        const targetPath = `agent-memory/${profileId}/chat_log.md`;
        if (await plugin.app.vault.adapter.exists(targetPath)) {
          const currentData = await plugin.app.vault.adapter.read(targetPath);
          const explicitTimestamp = (/* @__PURE__ */ new Date()).toISOString();
          const processedPayload = `

### Runtime Log Timestamp: ${explicitTimestamp}
${logEntry}
`;
          await plugin.app.vault.adapter.write(targetPath, currentData + processedPayload);
          return `Disk Write Operations Executed Successfully: Synced metadata parameters to file location target ${targetPath}`;
        }
        return "Target memory sector configuration path location error.";
      }
      if (name === "create_note") {
        const folderPath = args.folder ? args.folder.endsWith("/") ? args.folder : `${args.folder}/` : "";
        const fullPath = `${folderPath}${args.filename}`;
        if (await plugin.app.vault.adapter.exists(fullPath)) return `Error: File '${fullPath}' already exists.`;
        await plugin.app.vault.create(fullPath, args.content);
        return `Success. Created file at ${fullPath}.`;
      }
      if (name === "read_note") {
        const file = plugin.app.vault.getAbstractFileByPath(args.path);
        if (file instanceof obsidian.TFile) {
          const content = await plugin.app.vault.read(file);
          return `[CONTENT OF ${args.path}]:
${content}`;
        }
        return `Error: File not found at ${args.path}. Did you include the .md extension?`;
      }
      if (name === "search_vault") {
        const files = plugin.app.vault.getMarkdownFiles();
        let results = `Search results for "${args.query}":

`;
        let matchCount = 0;
        for (const file of files) {
          const content = await plugin.app.vault.read(file);
          if (content.toLowerCase().includes(args.query.toLowerCase())) {
            matchCount++;
            const index = content.toLowerCase().indexOf(args.query.toLowerCase());
            const snippet = content.substring(Math.max(0, index - 100), Math.min(content.length, index + 100));
            results += `--- Match found in ${file.path} ---
...${snippet}...

`;
          }
          if (matchCount >= 5) break;
        }
        return matchCount > 0 ? results : `No matches found for "${args.query}".`;
      }
      if (name === "browse_web_page") {
        const response = await obsidian.requestUrl({ url: args.url, method: "GET" });
        const cleanText = response.text.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").substring(0, 12e3);
        return `[WEB CONTENT FROM ${args.url}]:
${cleanText}`;
      }
      throw new Error(`Execution error: Unregistered tool ${name}`);
    } catch (e) {
      return `Tool execution failed: ${e.message}`;
    }
  }
};
var DEFAULT_SETTINGS = {
  profiles: [
    {
      id: "systems-architect",
      name: "Systems Architect",
      apiUrl: "http://127.0.0.1:8080/v1",
      modelName: "google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0",
      apiKey: "",
      systemPrompt: "You are an advanced AI Agent operating DIRECTLY inside the user's Obsidian Vault file system. YOU HAVE FULL CONTROL. If the user asks you to create a file, DO NOT SAY YOU CANNOT. Use the `Notes` tool immediately. If they ask you to research, use the `browse_web_page` or `search_vault` tools. Never apologize for lacking access; you have the tools, use them.",
      temperature: 0.2
    },
    {
      id: "secops-analyst",
      name: "SecOps Analyst",
      apiUrl: "http://127.0.0.1:8080/v1",
      modelName: "google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0",
      apiKey: "",
      systemPrompt: "You are a cybersecurity automation agent specialized in log analysis and code scanning. Use your tools to analyze vault data.",
      temperature: 0.1
    }
  ],
  activeProfileId: "systems-architect"
};
var HyokaPlugin = class extends obsidian.Plugin {
  settings;
  async onload() {
    await this.loadSettings();
    await this.initializeAgentWorkspace();
    this.injectCustomStyles();
    this.registerView(VIEW_TYPE_HYOKA, (leaf) => new HyokaChatView(leaf, this));
    this.addRibbonIcon("bot", "Open Hyoka Shell", () => this.activateView());
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
  async initializeAgentWorkspace() {
    const baseDir = "agent-memory";
    if (!await this.app.vault.adapter.exists(baseDir)) await this.app.vault.createFolder(baseDir);
    for (const profile of this.settings.profiles) {
      const profileDir = `${baseDir}/${profile.id}`;
      if (!await this.app.vault.adapter.exists(profileDir)) await this.app.vault.createFolder(profileDir);
      const structuralLogPath = `${profileDir}/session_history.json`;
      if (!await this.app.vault.adapter.exists(structuralLogPath)) await this.app.vault.create(structuralLogPath, JSON.stringify([]));
      const humanLogPath = `${profileDir}/chat_log.md`;
      if (!await this.app.vault.adapter.exists(humanLogPath)) await this.app.vault.create(humanLogPath, `# ${profile.name} Session Runtime Log

`);
    }
  }
  injectCustomStyles() {
    const styleId = "hyoka-core-ux-overrides";
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = `
                .nav-folder[data-path="agent-memory"] > .nav-folder-title { color: var(--text-accent) !important; font-family: var(--font-monospace) !important; font-weight: 700 !important; }
                .nav-folder[data-path="agent-memory"] > .nav-folder-title .nav-folder-title-content::before { content: "\u26A1 [CORE] " !important; }
                .hyoka-setting-card { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); }
                .hyoka-setting-card h4 { margin-top: 0 !important; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px; color: var(--text-accent); }
                .hyoka-toolbar-btn { background: none; border: 1px solid var(--background-modifier-border); color: var(--text-muted); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em; display: flex; align-items: center; gap: 4px; transition: all 0.2s; }
                .hyoka-toolbar-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
                .hyoka-toolbar-btn.danger:hover { background: rgba(255,0,0,0.1); color: var(--text-error); border-color: var(--text-error); }
            `;
      document.head.appendChild(styleEl);
    }
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_HYOKA)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_TYPE_HYOKA, active: true });
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }
};
var HyokaChatView = class extends obsidian.ItemView {
  plugin;
  chatHistory = [];
  messageContainer;
  inputField;
  profileSelector;
  lifecycleComponent;
  // Engine Control State
  isExecuting = false;
  abortController = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.lifecycleComponent = new obsidian.Component();
  }
  getViewType() {
    return VIEW_TYPE_HYOKA;
  }
  getDisplayText() {
    return "Hyoka Shell Console";
  }
  getIcon() {
    return "terminal";
  }
  async onOpen() {
    this.lifecycleComponent.load();
    await this.loadActiveProfileHistory();
    const container = this.containerEl.children[1];
    container.empty();
    const wrapper = container.createEl("div", {
      attr: { style: "display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px; font-family: var(--font-interface);" }
    });
    const header = wrapper.createEl("div", {
      attr: { style: "display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;" }
    });
    header.createEl("h5", { text: "HYOKA", attr: { style: "margin: 0; font-family: var(--font-monospace); font-size: 1.2em; letter-spacing: 0.5px;" } });
    this.profileSelector = header.createEl("select", {
      attr: { style: "padding: 4px 8px; font-family: var(--font-monospace); font-size: 0.8em; border-radius: 4px; background: var(--background-primary);" }
    });
    this.refreshProfileSelector();
    this.profileSelector.addEventListener("change", async () => {
      this.plugin.settings.activeProfileId = this.profileSelector.value;
      await this.plugin.saveSettings();
      await this.loadActiveProfileHistory();
      this.renderMessages();
    });
    const commandStrip = wrapper.createEl("div", { attr: { style: "display: flex; gap: 8px; padding-bottom: 8px;" } });
    const attachBtn = commandStrip.createEl("button", { text: "Attach Active Note", cls: "hyoka-toolbar-btn" });
    attachBtn.addEventListener("click", () => this.injectActiveNoteContext());
    const stopBtn = commandStrip.createEl("button", { text: "Stop Run", cls: "hyoka-toolbar-btn danger" });
    stopBtn.addEventListener("click", () => {
      if (this.abortController && this.isExecuting) {
        this.abortController.abort();
        new obsidian.Notice("Execution aborted.");
      }
    });
    const clearBtn = commandStrip.createEl("button", { text: "Clear Memory", cls: "hyoka-toolbar-btn" });
    clearBtn.addEventListener("click", () => {
      this.chatHistory = [{ role: "system", content: this.plugin.getActiveProfile().systemPrompt }];
      this.saveActiveProfileHistory();
      this.renderMessages();
      new obsidian.Notice("Memory wiped.");
    });
    this.messageContainer = wrapper.createEl("div", {
      attr: { style: "flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px;" }
    });
    const inputArea = wrapper.createEl("div", { attr: { style: "display: flex; gap: 8px; align-items: flex-end;" } });
    this.inputField = inputArea.createEl("textarea", {
      attr: {
        placeholder: "Instruct agent or broadcast parameters...",
        rows: "2",
        style: "flex-grow: 1; resize: none; border-radius: 6px; border: 1px solid var(--background-modifier-border); padding: 10px; background: var(--background-primary); font-size: 0.9em;"
      }
    });
    const sendBtn = inputArea.createEl("button", { text: "RUN", cls: "mod-cta", attr: { style: "padding: 8px 16px; height: 42px; font-weight: 700; font-family: var(--font-monospace);" } });
    sendBtn.addEventListener("click", () => {
      if (!this.isExecuting) this.startAgentLoop(this.inputField.value.trim());
    });
    this.inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!this.isExecuting) this.startAgentLoop(this.inputField.value.trim());
      }
    });
    this.renderMessages();
  }
  refreshProfileSelector() {
    this.profileSelector.empty();
    this.plugin.settings.profiles.forEach((p) => {
      const opt = this.profileSelector.createEl("option", { text: p.name, attr: { value: p.id } });
      if (p.id === this.plugin.settings.activeProfileId) opt.setAttribute("selected", "selected");
    });
  }
  async loadActiveProfileHistory() {
    const profile = this.plugin.getActiveProfile();
    const jsonPath = `agent-memory/${profile.id}/session_history.json`;
    try {
      if (await this.plugin.app.vault.adapter.exists(jsonPath)) {
        const rawData = await this.plugin.app.vault.adapter.read(jsonPath);
        const parsed = JSON.parse(rawData);
        this.chatHistory = parsed.length > 0 ? parsed : [{ role: "system", content: profile.systemPrompt }];
      } else {
        this.chatHistory = [{ role: "system", content: profile.systemPrompt }];
      }
    } catch (e) {
      this.chatHistory = [{ role: "system", content: profile.systemPrompt }];
    }
  }
  async saveActiveProfileHistory() {
    const profile = this.plugin.getActiveProfile();
    const jsonPath = `agent-memory/${profile.id}/session_history.json`;
    await this.plugin.app.vault.adapter.write(jsonPath, JSON.stringify(this.chatHistory, null, 2));
  }
  // --- CONTEXT INJECTION ROUTINE ---
  async injectActiveNoteContext() {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      new obsidian.Notice("No active note found to attach.");
      return;
    }
    const content = await this.plugin.app.vault.read(activeFile);
    this.chatHistory.push({
      role: "system",
      content: `[CONTEXTUAL INJECTION BY USER] Focus on the following file data (${activeFile.path}):

${content}`
    });
    new obsidian.Notice(`Attached ${activeFile.basename} to agent memory context.`);
  }
  async renderMessages() {
    var _a, _b;
    if (!this.messageContainer) return;
    this.messageContainer.empty();
    for (let i = 1; i < this.chatHistory.length; i++) {
      const msg = this.chatHistory[i];
      if (msg.role === "system" && ((_a = msg.content) == null ? void 0 : _a.startsWith("[CONTEXTUAL INJECTION"))) {
        const sysDiv = this.messageContainer.createEl("div", {
          attr: { style: "padding: 8px 12px; border-radius: 4px; background: var(--background-secondary-alt); border-left: 2px solid var(--text-muted); font-size: 0.85em; opacity: 0.8;" }
        });
        sysDiv.createEl("strong", { text: "\u{1F4CE} INJECTED FILE CONTEXT", attr: { style: "display: block; margin-bottom: 4px;" } });
        sysDiv.createEl("span", { text: "Data successfully loaded into agent operational memory." });
        continue;
      }
      if (msg.role === "system" || msg.role === "tool" || msg.tool_calls) continue;
      const isUser = msg.role === "user";
      const msgDiv = this.messageContainer.createEl("div", {
        attr: {
          style: `padding: 12px 16px; border-radius: 8px; max-width: 95%; box-shadow: 0 2px 8px rgba(0,0,0,0.02); ${isUser ? "align-self: flex-end; background: var(--interactive-accent); color: var(--text-on-accent);" : "align-self: flex-start; background: var(--background-secondary); border: 1px solid var(--background-modifier-border);"}`
        }
      });
      msgDiv.createEl("strong", {
        text: isUser ? "User //" : `${this.plugin.getActiveProfile().name} //`,
        attr: { style: "display: block; font-size: 0.75em; text-transform: uppercase; font-family: var(--font-monospace); margin-bottom: 6px;" }
      });
      const bodyContent = msgDiv.createEl("div", { cls: "markdown-rendered" });
      await obsidian.MarkdownRenderer.renderMarkdown(msg.content || "", bodyContent, ((_b = this.plugin.app.workspace.getActiveFile()) == null ? void 0 : _b.path) || "", this.lifecycleComponent);
    }
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }
  // -------------------------------------------------------------
  // ASYNC AGENT LOOP ENGINE
  // -------------------------------------------------------------
  async startAgentLoop(initialText) {
    var _a, _b, _c;
    if (initialText) {
      this.inputField.value = "";
      this.chatHistory.push({ role: "user", content: initialText });
      await this.renderMessages();
    }
    this.isExecuting = true;
    this.abortController = new AbortController();
    const currentProfile = this.plugin.getActiveProfile();
    const loadingMsgIndex = this.chatHistory.push({ role: "assistant", content: "" }) - 1;
    await this.renderMessages();
    const messageDiv = this.messageContainer.lastElementChild;
    messageDiv.empty();
    messageDiv.createEl("strong", { text: `${currentProfile.name} //`, attr: { style: "display: block; font-size: 0.75em; text-transform: uppercase; font-family: var(--font-monospace); margin-bottom: 8px;" } });
    const thinkDetails = messageDiv.createEl("details", { attr: { style: "margin-bottom: 12px; background: var(--background-secondary-alt); border-left: 3px solid var(--interactive-accent); padding: 10px; display: none;" } });
    thinkDetails.createEl("summary", { text: "Thinking..", attr: { style: "cursor: pointer; font-size: 0.75em; font-family: var(--font-monospace); font-weight: 600;" } });
    const thinkContent = thinkDetails.createEl("div", { attr: { style: "font-size: 0.85em; font-family: var(--font-monospace); margin-top: 6px; white-space: pre-wrap;" } });
    const mainContent = messageDiv.createEl("div", { cls: "markdown-rendered" });
    const exposedTools = McpToolRegistry.getCapabilities().map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema }
    }));
    let pipelineExecutionActive = true;
    let controlIterationLimit = 0;
    while (pipelineExecutionActive && controlIterationLimit < 5) {
      controlIterationLimit++;
      try {
        const headers = { "Content-Type": "application/json" };
        if (currentProfile.apiKey) headers["Authorization"] = `Bearer ${currentProfile.apiKey}`;
        const response = await fetch(`${currentProfile.apiUrl}/chat/completions`, {
          method: "POST",
          headers,
          signal: this.abortController.signal,
          body: JSON.stringify({
            model: currentProfile.modelName,
            messages: this.chatHistory.slice(0, this.chatHistory.length - 1).filter((m) => m.content !== ""),
            temperature: currentProfile.temperature,
            stream: true,
            tools: exposedTools
          })
        });
        if (!response.body) throw new Error("Null JSON stream target error.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullRawStream = "";
        let fullThinking = "";
        let fullContent = "";
        let runtimeDetectedToolCall = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((line) => line.trim() !== "");
          for (const line of lines) {
            if (line.replace(/^data: /, "").trim() === "[DONE]") continue;
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const delta = parsed.choices[0].delta;
                if (delta.tool_calls) {
                  if (!runtimeDetectedToolCall) runtimeDetectedToolCall = { id: "", function: { name: "", arguments: "" } };
                  const call = delta.tool_calls[0];
                  if (call.id) runtimeDetectedToolCall.id += call.id;
                  if ((_a = call.function) == null ? void 0 : _a.name) runtimeDetectedToolCall.function.name += call.function.name;
                  if ((_b = call.function) == null ? void 0 : _b.arguments) runtimeDetectedToolCall.function.arguments += call.function.arguments;
                  thinkDetails.style.display = "block";
                  thinkDetails.setAttribute("open", "");
                  thinkContent.innerText = `[ROUTING INSTRUCTION TO MCP CORE]: ${runtimeDetectedToolCall.function.name}
Args: ${runtimeDetectedToolCall.function.arguments}`;
                  continue;
                }
                if (delta.content) fullRawStream += delta.content;
                if (fullRawStream.includes("<think>")) {
                  const parts = fullRawStream.split("<think>");
                  const afterThink = parts[1] || "";
                  if (afterThink.includes("</think>")) {
                    const splitEnd = afterThink.split("</think>");
                    fullThinking = splitEnd[0];
                    fullContent = parts[0] + splitEnd.slice(1).join("</think>");
                    thinkDetails.removeAttribute("open");
                  } else {
                    fullThinking = afterThink;
                    fullContent = parts[0];
                    thinkDetails.style.display = "block";
                    if (!thinkDetails.hasAttribute("open")) thinkDetails.setAttribute("open", "");
                  }
                } else {
                  fullContent = fullRawStream;
                }
                if (delta.reasoning_content) {
                  fullThinking += delta.reasoning_content;
                  thinkDetails.style.display = "block";
                  if (!thinkDetails.hasAttribute("open")) thinkDetails.setAttribute("open", "");
                }
                if (fullThinking) thinkContent.innerText = fullThinking;
                if (fullContent) {
                  mainContent.empty();
                  await obsidian.MarkdownRenderer.renderMarkdown(fullContent, mainContent, ((_c = this.plugin.app.workspace.getActiveFile()) == null ? void 0 : _c.path) || "", this.lifecycleComponent);
                }
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
              } catch (e) {
              }
            }
          }
        }
        if (runtimeDetectedToolCall && runtimeDetectedToolCall.function.name) {
          const parsedArguments = JSON.parse(runtimeDetectedToolCall.function.arguments || "{}");
          if (runtimeDetectedToolCall.function.name === "request_file_deletion") {
            this.chatHistory.splice(this.chatHistory.length - 1, 0, {
              role: "assistant",
              content: null,
              tool_calls: [{ id: runtimeDetectedToolCall.id, type: "function", function: runtimeDetectedToolCall.function }]
            });
            this.renderDeletionWarning(runtimeDetectedToolCall, parsedArguments, loadingMsgIndex);
            return;
          }
          const trackingObject = {
            role: "assistant",
            content: null,
            tool_calls: [{ id: runtimeDetectedToolCall.id, type: "function", function: runtimeDetectedToolCall.function }]
          };
          this.chatHistory.splice(this.chatHistory.length - 1, 0, trackingObject);
          const executionResponseStr = await McpToolRegistry.executeTool(runtimeDetectedToolCall.function.name, parsedArguments, this.plugin);
          this.chatHistory.splice(this.chatHistory.length - 1, 0, {
            role: "tool",
            tool_call_id: runtimeDetectedToolCall.id,
            name: runtimeDetectedToolCall.function.name,
            content: executionResponseStr
          });
          continue;
        } else {
          this.chatHistory[loadingMsgIndex].content = fullContent;
          pipelineExecutionActive = false;
        }
      } catch (error) {
        if (error.name === "AbortError") {
          mainContent.innerText += `

[USER ABORTED EXECUTION]`;
          this.chatHistory[loadingMsgIndex].content = mainContent.innerText;
        } else {
          mainContent.innerText = `Agentic Processing Pipeline Error: ${error.message}`;
        }
        pipelineExecutionActive = false;
      }
    }
    thinkDetails.removeAttribute("open");
    await this.saveActiveProfileHistory();
    this.isExecuting = false;
    this.abortController = null;
  }
  // --- DELETION SECURITY SANDBOX UI ---
  renderDeletionWarning(toolCall, args, loadingMsgIndex) {
    this.chatHistory.pop();
    const warningDiv = this.messageContainer.createEl("div", {
      attr: { style: "padding: 16px; border-radius: 8px; border: 2px solid var(--text-error); background: rgba(255, 0, 0, 0.05); margin-top: 10px;" }
    });
    warningDiv.createEl("strong", { text: "CRITICAL ACTION AUTHORIZATION", attr: { style: "display: block; color: var(--text-error); font-family: var(--font-monospace); font-size: 0.9em; margin-bottom: 8px;" } });
    warningDiv.createEl("p", { text: `The agent is requesting to delete the following file:`, attr: { style: "margin: 0 0 4px 0;" } });
    warningDiv.createEl("code", { text: args.path, attr: { style: "display: block; padding: 6px; background: var(--background-primary); border-radius: 4px; margin-bottom: 10px; font-weight: bold;" } });
    warningDiv.createEl("p", { text: `Agent's Reason: "${args.reason}"`, attr: { style: "font-style: italic; opacity: 0.8; font-size: 0.9em; margin-bottom: 12px;" } });
    const btnRow = warningDiv.createEl("div", { attr: { style: "display: flex; gap: 10px;" } });
    const acceptBtn = btnRow.createEl("button", { text: "AUTHORIZE DELETION", attr: { style: "background: var(--text-error); color: white; border: none; font-weight: bold;" } });
    const declineBtn = btnRow.createEl("button", { text: "DECLINE" });
    acceptBtn.addEventListener("click", async () => {
      warningDiv.empty();
      warningDiv.createEl("p", { text: `Processing deletion...` });
      let resultStatus = "";
      try {
        const file = this.plugin.app.vault.getAbstractFileByPath(args.path);
        if (file instanceof obsidian.TFile) {
          await this.plugin.app.vault.trash(file, true);
          resultStatus = "System Success: File has been permanently deleted.";
        } else resultStatus = "System Error: File does not exist.";
      } catch (e) {
        resultStatus = `System Error: ${e.message}`;
      }
      this.chatHistory.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStatus });
      warningDiv.remove();
      this.startAgentLoop();
    });
    declineBtn.addEventListener("click", () => {
      this.chatHistory.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "USER DENIED PERMISSION. The file was NOT deleted." });
      warningDiv.remove();
      this.startAgentLoop();
    });
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }
  async onClose() {
    this.lifecycleComponent.unload();
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
    containerEl.createEl("h2", { text: "Hyoka Control Panel" });
    containerEl.createEl("p", { text: "Manage localized orchestration pipelines and execution metrics.", attr: { style: "font-size: 0.9em; color: var(--text-muted); margin-bottom: 24px;" } });
    this.plugin.settings.profiles.forEach((profile) => {
      const card = containerEl.createEl("div", { cls: "hyoka-setting-card" });
      card.createEl("h4", { text: `Runtime Core Instance: ${profile.name}` });
      new obsidian.Setting(card).setName("Visual Persona Label").addText((text) => text.setValue(profile.name).onChange(async (v) => {
        profile.name = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("Target REST Base Path").addText((text) => text.setValue(profile.apiUrl).onChange(async (v) => {
        profile.apiUrl = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("Model Identifier Flag").addText((text) => text.setValue(profile.modelName).onChange(async (v) => {
        profile.modelName = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("Authentication Credentials Key").addText((text) => text.setPlaceholder("sk-... (Leave empty for local loops)").setValue(profile.apiKey).onChange(async (v) => {
        profile.apiKey = v;
        await this.plugin.saveSettings();
      }));
      new obsidian.Setting(card).setName("System Context Directives").addTextArea((text) => text.setValue(profile.systemPrompt).onChange(async (v) => {
        profile.systemPrompt = v;
        await this.plugin.saveSettings();
      }));
    });
    const actionWrapper = containerEl.createEl("div", { attr: { style: "display: flex; justify-content: flex-end; margin-top: 16px;" } });
    const addBtn = actionWrapper.createEl("button", { text: "+ Deploy Independent Agent Instance", cls: "mod-cta" });
    addBtn.addEventListener("click", async () => {
      const runtimeId = `persona-${Date.now()}`;
      this.plugin.settings.profiles.push({
        id: runtimeId,
        name: "Auxiliary Worker Drone",
        apiUrl: "http://127.0.0.1:8080/v1",
        modelName: "google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0",
        apiKey: "",
        systemPrompt: "You are an explicit micro-task computational node persona instance.",
        temperature: 0.3
      });
      await this.plugin.saveSettings();
      await this.plugin.initializeAgentWorkspace();
      this.display();
    });
  }
};

module.exports = HyokaPlugin;
//# sourceMappingURL=main.js.map
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1haW4udHMiXSwibmFtZXMiOlsiVEZpbGUiLCJyZXF1ZXN0VXJsIiwiUGx1Z2luIiwiSXRlbVZpZXciLCJDb21wb25lbnQiLCJOb3RpY2UiLCJNYXJrZG93blJlbmRlcmVyIiwiUGx1Z2luU2V0dGluZ1RhYiIsIlNldHRpbmciXSwibWFwcGluZ3MiOiI7Ozs7O0FBY0EsSUFBTSxlQUFBLEdBQWtCLGlCQUFBO0FBZXhCLElBQU0sa0JBQU4sTUFBc0I7QUFBQSxFQUNsQixPQUFPLGVBQUEsR0FBdUM7QUFDMUMsSUFBQSxPQUFPO0FBQUEsTUFDSDtBQUFBLFFBQ0ksSUFBQSxFQUFNLG9CQUFBO0FBQUEsUUFDTixXQUFBLEVBQWEseUdBQUE7QUFBQSxRQUNiLFdBQUEsRUFBYTtBQUFBLFVBQ1QsSUFBQSxFQUFNLFFBQUE7QUFBQSxVQUNOLFVBQUEsRUFBWTtBQUFBLFlBQ1IsU0FBQSxFQUFXLEVBQUUsSUFBQSxFQUFNLFFBQUEsRUFBVSxhQUFhLDRFQUFBLEVBQTZFO0FBQUEsWUFDdkgsUUFBQSxFQUFVLEVBQUUsSUFBQSxFQUFNLFFBQUEsRUFBVSxhQUFhLGdGQUFBO0FBQWlGLFdBQzlIO0FBQUEsVUFDQSxRQUFBLEVBQVUsQ0FBQyxXQUFBLEVBQWEsVUFBVTtBQUFBO0FBQ3RDLE9BQ0o7QUFBQSxNQUNBO0FBQUEsUUFDSSxJQUFBLEVBQU0sYUFBQTtBQUFBLFFBQ04sV0FBQSxFQUFhLHNFQUFBO0FBQUEsUUFDYixXQUFBLEVBQWE7QUFBQSxVQUNULElBQUEsRUFBTSxRQUFBO0FBQUEsVUFDTixVQUFBLEVBQVk7QUFBQSxZQUNSLFFBQUEsRUFBVSxFQUFFLElBQUEsRUFBTSxRQUFBLEVBQVUsYUFBYSxvRUFBQSxFQUFxRTtBQUFBLFlBQzlHLE9BQUEsRUFBUyxFQUFFLElBQUEsRUFBTSxRQUFBLEVBQVUsYUFBYSw4Q0FBQSxFQUErQztBQUFBLFlBQ3ZGLE1BQUEsRUFBUSxFQUFFLElBQUEsRUFBTSxRQUFBLEVBQVUsYUFBYSw2REFBQTtBQUE4RCxXQUN6RztBQUFBLFVBQ0EsUUFBQSxFQUFVLENBQUMsVUFBQSxFQUFZLFNBQVM7QUFBQTtBQUNwQyxPQUNKO0FBQUEsTUFDQTtBQUFBLFFBQ0ksSUFBQSxFQUFNLFdBQUE7QUFBQSxRQUNOLFdBQUEsRUFBYSw4RUFBQTtBQUFBLFFBQ2IsV0FBQSxFQUFhO0FBQUEsVUFDVCxJQUFBLEVBQU0sUUFBQTtBQUFBLFVBQ04sVUFBQSxFQUFZLEVBQUUsSUFBQSxFQUFNLEVBQUUsTUFBTSxRQUFBLEVBQVUsV0FBQSxFQUFhLHNEQUFxRCxFQUFFO0FBQUEsVUFDMUcsUUFBQSxFQUFVLENBQUMsTUFBTTtBQUFBO0FBQ3JCLE9BQ0o7QUFBQSxNQUNBO0FBQUEsUUFDSSxJQUFBLEVBQU0sY0FBQTtBQUFBLFFBQ04sV0FBQSxFQUFhLHVIQUFBO0FBQUEsUUFDYixXQUFBLEVBQWE7QUFBQSxVQUNULElBQUEsRUFBTSxRQUFBO0FBQUEsVUFDTixVQUFBLEVBQVksRUFBRSxLQUFBLEVBQU8sRUFBRSxNQUFNLFFBQUEsRUFBVSxXQUFBLEVBQWEsbURBQWtELEVBQUU7QUFBQSxVQUN4RyxRQUFBLEVBQVUsQ0FBQyxPQUFPO0FBQUE7QUFDdEIsT0FDSjtBQUFBLE1BQ0E7QUFBQSxRQUNJLElBQUEsRUFBTSxpQkFBQTtBQUFBLFFBQ04sV0FBQSxFQUFhLHdGQUFBO0FBQUEsUUFDYixXQUFBLEVBQWE7QUFBQSxVQUNULElBQUEsRUFBTSxRQUFBO0FBQUEsVUFDTixVQUFBLEVBQVksRUFBRSxHQUFBLEVBQUssRUFBRSxNQUFNLFFBQUEsRUFBVSxXQUFBLEVBQWEsc0NBQXFDLEVBQUU7QUFBQSxVQUN6RixRQUFBLEVBQVUsQ0FBQyxLQUFLO0FBQUE7QUFDcEIsT0FDSjtBQUFBLE1BQ0E7QUFBQSxRQUNJLElBQUEsRUFBTSx1QkFBQTtBQUFBLFFBQ04sV0FBQSxFQUFhLGlGQUFBO0FBQUEsUUFDYixXQUFBLEVBQWE7QUFBQSxVQUNULElBQUEsRUFBTSxRQUFBO0FBQUEsVUFDTixVQUFBLEVBQVk7QUFBQSxZQUNSLElBQUEsRUFBTSxFQUFFLElBQUEsRUFBTSxRQUFBLEVBQVUsYUFBYSw2QkFBQSxFQUE4QjtBQUFBLFlBQ25FLE1BQUEsRUFBUSxFQUFFLElBQUEsRUFBTSxRQUFBLEVBQVUsYUFBYSxzREFBQTtBQUF1RCxXQUNsRztBQUFBLFVBQ0EsUUFBQSxFQUFVLENBQUMsTUFBQSxFQUFRLFFBQVE7QUFBQTtBQUMvQjtBQUNKLEtBQ0o7QUFBQSxFQUNKO0FBQUEsRUFFQSxhQUFhLFdBQUEsQ0FBWSxJQUFBLEVBQWMsSUFBQSxFQUFXLE1BQUEsRUFBc0M7QUFDcEYsSUFBQSxJQUFJO0FBQ0EsTUFBQSxJQUFJLFNBQVMsb0JBQUEsRUFBc0I7QUFDL0IsUUFBQSxNQUFNLEVBQUUsU0FBQSxFQUFXLFFBQUEsRUFBUyxHQUFJLElBQUE7QUFDaEMsUUFBQSxNQUFNLFVBQUEsR0FBYSxnQkFBZ0IsU0FBUyxDQUFBLFlBQUEsQ0FBQTtBQUU1QyxRQUFBLElBQUksTUFBTSxNQUFBLENBQU8sR0FBQSxDQUFJLE1BQU0sT0FBQSxDQUFRLE1BQUEsQ0FBTyxVQUFVLENBQUEsRUFBRztBQUNuRCxVQUFBLE1BQU0sY0FBYyxNQUFNLE1BQUEsQ0FBTyxJQUFJLEtBQUEsQ0FBTSxPQUFBLENBQVEsS0FBSyxVQUFVLENBQUE7QUFDbEUsVUFBQSxNQUFNLGlCQUFBLEdBQUEsaUJBQW9CLElBQUksSUFBQSxFQUFLLEVBQUUsV0FBQSxFQUFZO0FBQ2pELFVBQUEsTUFBTSxnQkFBQSxHQUFtQjs7QUFBQSwyQkFBQSxFQUFrQyxpQkFBaUI7QUFBQSxFQUFLLFFBQVE7QUFBQSxDQUFBO0FBQ3pGLFVBQUEsTUFBTSxPQUFPLEdBQUEsQ0FBSSxLQUFBLENBQU0sUUFBUSxLQUFBLENBQU0sVUFBQSxFQUFZLGNBQWMsZ0JBQWdCLENBQUE7QUFDL0UsVUFBQSxPQUFPLG1HQUFtRyxVQUFVLENBQUEsQ0FBQTtBQUFBLFFBQ3hIO0FBQ0EsUUFBQSxPQUFPLHlEQUFBO0FBQUEsTUFDWDtBQUVBLE1BQUEsSUFBSSxTQUFTLGFBQUEsRUFBZTtBQUN4QixRQUFBLE1BQU0sVUFBQSxHQUFhLElBQUEsQ0FBSyxNQUFBLEdBQVUsSUFBQSxDQUFLLE1BQUEsQ0FBTyxRQUFBLENBQVMsR0FBRyxDQUFBLEdBQUksSUFBQSxDQUFLLE1BQUEsR0FBUyxDQUFBLEVBQUcsSUFBQSxDQUFLLE1BQU0sQ0FBQSxDQUFBLENBQUEsR0FBTyxFQUFBO0FBQ2pHLFFBQUEsTUFBTSxRQUFBLEdBQVcsQ0FBQSxFQUFHLFVBQVUsQ0FBQSxFQUFHLEtBQUssUUFBUSxDQUFBLENBQUE7QUFFOUMsUUFBQSxJQUFJLE1BQU0sTUFBQSxDQUFPLEdBQUEsQ0FBSSxLQUFBLENBQU0sT0FBQSxDQUFRLE9BQU8sUUFBUSxDQUFBLEVBQUcsT0FBTyxDQUFBLGFBQUEsRUFBZ0IsUUFBUSxDQUFBLGlCQUFBLENBQUE7QUFDcEYsUUFBQSxNQUFNLE9BQU8sR0FBQSxDQUFJLEtBQUEsQ0FBTSxNQUFBLENBQU8sUUFBQSxFQUFVLEtBQUssT0FBTyxDQUFBO0FBQ3BELFFBQUEsT0FBTyw0QkFBNEIsUUFBUSxDQUFBLENBQUEsQ0FBQTtBQUFBLE1BQy9DO0FBRUEsTUFBQSxJQUFJLFNBQVMsV0FBQSxFQUFhO0FBQ3RCLFFBQUEsTUFBTSxPQUFPLE1BQUEsQ0FBTyxHQUFBLENBQUksS0FBQSxDQUFNLHFCQUFBLENBQXNCLEtBQUssSUFBSSxDQUFBO0FBQzdELFFBQUEsSUFBSSxnQkFBZ0JBLGNBQUEsRUFBTztBQUN2QixVQUFBLE1BQU0sVUFBVSxNQUFNLE1BQUEsQ0FBTyxHQUFBLENBQUksS0FBQSxDQUFNLEtBQUssSUFBSSxDQUFBO0FBQ2hELFVBQUEsT0FBTyxDQUFBLFlBQUEsRUFBZSxLQUFLLElBQUksQ0FBQTtBQUFBLEVBQU8sT0FBTyxDQUFBLENBQUE7QUFBQSxRQUNqRDtBQUNBLFFBQUEsT0FBTyxDQUFBLHlCQUFBLEVBQTRCLEtBQUssSUFBSSxDQUFBLG9DQUFBLENBQUE7QUFBQSxNQUNoRDtBQUVBLE1BQUEsSUFBSSxTQUFTLGNBQUEsRUFBZ0I7QUFDekIsUUFBQSxNQUFNLEtBQUEsR0FBUSxNQUFBLENBQU8sR0FBQSxDQUFJLEtBQUEsQ0FBTSxnQkFBQSxFQUFpQjtBQUNoRCxRQUFBLElBQUksT0FBQSxHQUFVLENBQUEsb0JBQUEsRUFBdUIsSUFBQSxDQUFLLEtBQUssQ0FBQTs7QUFBQSxDQUFBO0FBQy9DLFFBQUEsSUFBSSxVQUFBLEdBQWEsQ0FBQTtBQUVqQixRQUFBLEtBQUEsTUFBVyxRQUFRLEtBQUEsRUFBTztBQUN0QixVQUFBLE1BQU0sVUFBVSxNQUFNLE1BQUEsQ0FBTyxHQUFBLENBQUksS0FBQSxDQUFNLEtBQUssSUFBSSxDQUFBO0FBQ2hELFVBQUEsSUFBSSxPQUFBLENBQVEsYUFBWSxDQUFFLFFBQUEsQ0FBUyxLQUFLLEtBQUEsQ0FBTSxXQUFBLEVBQWEsQ0FBQSxFQUFHO0FBQzFELFlBQUEsVUFBQSxFQUFBO0FBRUEsWUFBQSxNQUFNLEtBQUEsR0FBUSxRQUFRLFdBQUEsRUFBWSxDQUFFLFFBQVEsSUFBQSxDQUFLLEtBQUEsQ0FBTSxhQUFhLENBQUE7QUFDcEUsWUFBQSxNQUFNLE9BQUEsR0FBVSxPQUFBLENBQVEsU0FBQSxDQUFVLElBQUEsQ0FBSyxJQUFJLENBQUEsRUFBRyxLQUFBLEdBQVEsR0FBRyxDQUFBLEVBQUcsS0FBSyxHQUFBLENBQUksT0FBQSxDQUFRLE1BQUEsRUFBUSxLQUFBLEdBQVEsR0FBRyxDQUFDLENBQUE7QUFDakcsWUFBQSxPQUFBLElBQVcsQ0FBQSxtQkFBQSxFQUFzQixLQUFLLElBQUksQ0FBQTtBQUFBLEdBQUEsRUFBWSxPQUFPLENBQUE7O0FBQUEsQ0FBQTtBQUFBLFVBQ2pFO0FBQ0EsVUFBQSxJQUFJLGNBQWMsQ0FBQSxFQUFHO0FBQUEsUUFDekI7QUFDQSxRQUFBLE9BQU8sVUFBQSxHQUFhLENBQUEsR0FBSSxPQUFBLEdBQVUsQ0FBQSxzQkFBQSxFQUF5QixLQUFLLEtBQUssQ0FBQSxFQUFBLENBQUE7QUFBQSxNQUN6RTtBQUVBLE1BQUEsSUFBSSxTQUFTLGlCQUFBLEVBQW1CO0FBQzVCLFFBQUEsTUFBTSxRQUFBLEdBQVcsTUFBTUMsbUJBQUEsQ0FBVyxFQUFFLEtBQUssSUFBQSxDQUFLLEdBQUEsRUFBSyxNQUFBLEVBQVEsS0FBQSxFQUFPLENBQUE7QUFDbEUsUUFBQSxNQUFNLFNBQUEsR0FBWSxRQUFBLENBQVMsSUFBQSxDQUFLLE9BQUEsQ0FBUSxZQUFBLEVBQWMsR0FBRyxDQUFBLENBQUUsT0FBQSxDQUFRLE1BQUEsRUFBUSxHQUFHLENBQUEsQ0FBRSxTQUFBLENBQVUsR0FBRyxJQUFLLENBQUE7QUFDbEcsUUFBQSxPQUFPLENBQUEsa0JBQUEsRUFBcUIsS0FBSyxHQUFHLENBQUE7QUFBQSxFQUFPLFNBQVMsQ0FBQSxDQUFBO0FBQUEsTUFDeEQ7QUFFQSxNQUFBLE1BQU0sSUFBSSxLQUFBLENBQU0sQ0FBQSxtQ0FBQSxFQUFzQyxJQUFJLENBQUEsQ0FBRSxDQUFBO0FBQUEsSUFDaEUsU0FBUyxDQUFBLEVBQUc7QUFDUixNQUFBLE9BQU8sQ0FBQSx1QkFBQSxFQUEwQixFQUFFLE9BQU8sQ0FBQSxDQUFBO0FBQUEsSUFDOUM7QUFBQSxFQUNKO0FBQ0osQ0FBQTtBQWlCQSxJQUFNLGdCQUFBLEdBQWtDO0FBQUEsRUFDcEMsUUFBQSxFQUFVO0FBQUEsSUFDTjtBQUFBLE1BQ0ksRUFBQSxFQUFJLG1CQUFBO0FBQUEsTUFDSixJQUFBLEVBQU0sbUJBQUE7QUFBQSxNQUNOLE1BQUEsRUFBUSwwQkFBQTtBQUFBLE1BQ1IsU0FBQSxFQUFXLDBDQUFBO0FBQUEsTUFDWCxNQUFBLEVBQVEsRUFBQTtBQUFBLE1BQ1IsWUFBQSxFQUFjLHdXQUFBO0FBQUEsTUFDZCxXQUFBLEVBQWE7QUFBQSxLQUNqQjtBQUFBLElBQ0E7QUFBQSxNQUNJLEVBQUEsRUFBSSxnQkFBQTtBQUFBLE1BQ0osSUFBQSxFQUFNLGdCQUFBO0FBQUEsTUFDTixNQUFBLEVBQVEsMEJBQUE7QUFBQSxNQUNSLFNBQUEsRUFBVywwQ0FBQTtBQUFBLE1BQ1gsTUFBQSxFQUFRLEVBQUE7QUFBQSxNQUNSLFlBQUEsRUFBYywrSEFBQTtBQUFBLE1BQ2QsV0FBQSxFQUFhO0FBQUE7QUFDakIsR0FDSjtBQUFBLEVBQ0EsZUFBQSxFQUFpQjtBQUNyQixDQUFBO0FBVUEsSUFBcUIsV0FBQSxHQUFyQixjQUF5Q0MsZUFBQSxDQUFPO0FBQUEsRUFDNUMsUUFBQTtBQUFBLEVBRUEsTUFBTSxNQUFBLEdBQVM7QUFDWCxJQUFBLE1BQU0sS0FBSyxZQUFBLEVBQWE7QUFDeEIsSUFBQSxNQUFNLEtBQUssd0JBQUEsRUFBeUI7QUFDcEMsSUFBQSxJQUFBLENBQUssa0JBQUEsRUFBbUI7QUFFeEIsSUFBQSxJQUFBLENBQUssWUFBQSxDQUFhLGlCQUFpQixDQUFDLElBQUEsS0FBUyxJQUFJLGFBQUEsQ0FBYyxJQUFBLEVBQU0sSUFBSSxDQUFDLENBQUE7QUFDMUUsSUFBQSxJQUFBLENBQUssY0FBYyxLQUFBLEVBQU8sa0JBQUEsRUFBb0IsTUFBTSxJQUFBLENBQUssY0FBYyxDQUFBO0FBQ3ZFLElBQUEsSUFBQSxDQUFLLGNBQWMsSUFBSSxlQUFBLENBQWdCLElBQUEsQ0FBSyxHQUFBLEVBQUssSUFBSSxDQUFDLENBQUE7QUFBQSxFQUMxRDtBQUFBLEVBRUEsTUFBTSxZQUFBLEdBQWU7QUFBRSxJQUFBLElBQUEsQ0FBSyxRQUFBLEdBQVcsT0FBTyxNQUFBLENBQU8sSUFBSSxnQkFBQSxFQUFrQixNQUFNLElBQUEsQ0FBSyxRQUFBLEVBQVUsQ0FBQTtBQUFBLEVBQUc7QUFBQSxFQUNuRyxNQUFNLFlBQUEsR0FBZTtBQUFFLElBQUEsTUFBTSxJQUFBLENBQUssUUFBQSxDQUFTLElBQUEsQ0FBSyxRQUFRLENBQUE7QUFBQSxFQUFHO0FBQUEsRUFDM0QsZ0JBQUEsR0FBaUM7QUFBRSxJQUFBLE9BQU8sSUFBQSxDQUFLLFFBQUEsQ0FBUyxRQUFBLENBQVMsSUFBQSxDQUFLLE9BQUssQ0FBQSxDQUFFLEVBQUEsS0FBTyxJQUFBLENBQUssUUFBQSxDQUFTLGVBQWUsQ0FBQSxJQUFLLElBQUEsQ0FBSyxRQUFBLENBQVMsU0FBUyxDQUFDLENBQUE7QUFBQSxFQUFHO0FBQUEsRUFFakosTUFBTSx3QkFBQSxHQUEyQjtBQUM3QixJQUFBLE1BQU0sT0FBQSxHQUFVLGNBQUE7QUFDaEIsSUFBQSxJQUFJLENBQUUsTUFBTSxJQUFBLENBQUssR0FBQSxDQUFJLE1BQU0sT0FBQSxDQUFRLE1BQUEsQ0FBTyxPQUFPLENBQUEsRUFBSSxNQUFNLElBQUEsQ0FBSyxHQUFBLENBQUksS0FBQSxDQUFNLGFBQWEsT0FBTyxDQUFBO0FBRTlGLElBQUEsS0FBQSxNQUFXLE9BQUEsSUFBVyxJQUFBLENBQUssUUFBQSxDQUFTLFFBQUEsRUFBVTtBQUMxQyxNQUFBLE1BQU0sVUFBQSxHQUFhLENBQUEsRUFBRyxPQUFPLENBQUEsQ0FBQSxFQUFJLFFBQVEsRUFBRSxDQUFBLENBQUE7QUFDM0MsTUFBQSxJQUFJLENBQUUsTUFBTSxJQUFBLENBQUssR0FBQSxDQUFJLE1BQU0sT0FBQSxDQUFRLE1BQUEsQ0FBTyxVQUFVLENBQUEsRUFBSSxNQUFNLElBQUEsQ0FBSyxHQUFBLENBQUksS0FBQSxDQUFNLGFBQWEsVUFBVSxDQUFBO0FBRXBHLE1BQUEsTUFBTSxpQkFBQSxHQUFvQixHQUFHLFVBQVUsQ0FBQSxxQkFBQSxDQUFBO0FBQ3ZDLE1BQUEsSUFBSSxDQUFFLE1BQU0sSUFBQSxDQUFLLElBQUksS0FBQSxDQUFNLE9BQUEsQ0FBUSxPQUFPLGlCQUFpQixDQUFBLFFBQVUsSUFBQSxDQUFLLEdBQUEsQ0FBSSxNQUFNLE1BQUEsQ0FBTyxpQkFBQSxFQUFtQixLQUFLLFNBQUEsQ0FBVSxFQUFFLENBQUMsQ0FBQTtBQUVoSSxNQUFBLE1BQU0sWUFBQSxHQUFlLEdBQUcsVUFBVSxDQUFBLFlBQUEsQ0FBQTtBQUNsQyxNQUFBLElBQUksQ0FBRSxNQUFNLElBQUEsQ0FBSyxHQUFBLENBQUksS0FBQSxDQUFNLFFBQVEsTUFBQSxDQUFPLFlBQVksQ0FBQSxFQUFJLE1BQU0sS0FBSyxHQUFBLENBQUksS0FBQSxDQUFNLE9BQU8sWUFBQSxFQUFjLENBQUEsRUFBQSxFQUFLLFFBQVEsSUFBSSxDQUFBOztBQUFBLENBQTBCLENBQUE7QUFBQSxJQUNuSjtBQUFBLEVBQ0o7QUFBQSxFQUVBLGtCQUFBLEdBQXFCO0FBQ2pCLElBQUEsTUFBTSxPQUFBLEdBQVUseUJBQUE7QUFDaEIsSUFBQSxJQUFJLENBQUMsUUFBQSxDQUFTLGNBQUEsQ0FBZSxPQUFPLENBQUEsRUFBRztBQUNuQyxNQUFBLE1BQU0sT0FBQSxHQUFVLFFBQUEsQ0FBUyxhQUFBLENBQWMsT0FBTyxDQUFBO0FBQzlDLE1BQUEsT0FBQSxDQUFRLEVBQUEsR0FBSyxPQUFBO0FBQ2IsTUFBQSxPQUFBLENBQVEsV0FBQSxHQUFjO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxZQUFBLENBQUE7QUFTdEIsTUFBQSxRQUFBLENBQVMsSUFBQSxDQUFLLFlBQVksT0FBTyxDQUFBO0FBQUEsSUFDckM7QUFBQSxFQUNKO0FBQUEsRUFFQSxNQUFNLFlBQUEsR0FBZTtBQUNqQixJQUFBLE1BQU0sRUFBRSxTQUFBLEVBQVUsR0FBSSxJQUFBLENBQUssR0FBQTtBQUMzQixJQUFBLElBQUksSUFBQSxHQUFPLFNBQUEsQ0FBVSxlQUFBLENBQWdCLGVBQWUsRUFBRSxDQUFDLENBQUE7QUFDdkQsSUFBQSxJQUFJLENBQUMsSUFBQSxFQUFNO0FBQ1AsTUFBQSxNQUFNLFNBQUEsR0FBWSxTQUFBLENBQVUsWUFBQSxDQUFhLEtBQUssQ0FBQTtBQUM5QyxNQUFBLElBQUksU0FBQSxFQUFXO0FBQUUsUUFBQSxJQUFBLEdBQU8sU0FBQTtBQUFXLFFBQUEsTUFBTSxLQUFLLFlBQUEsQ0FBYSxFQUFFLE1BQU0sZUFBQSxFQUFpQixNQUFBLEVBQVEsTUFBTSxDQUFBO0FBQUEsTUFBRztBQUFBLElBQ3pHO0FBQ0EsSUFBQSxJQUFJLElBQUEsRUFBTSxTQUFBLENBQVUsVUFBQSxDQUFXLElBQUksQ0FBQTtBQUFBLEVBQ3ZDO0FBQ0o7QUFLQSxJQUFNLGFBQUEsR0FBTixjQUE0QkMsaUJBQUEsQ0FBUztBQUFBLEVBQ2pDLE1BQUE7QUFBQSxFQUNBLGNBQTZCLEVBQUM7QUFBQSxFQUM5QixnQkFBQTtBQUFBLEVBQ0EsVUFBQTtBQUFBLEVBQ0EsZUFBQTtBQUFBLEVBQ0Esa0JBQUE7QUFBQTtBQUFBLEVBR0EsV0FBQSxHQUF1QixLQUFBO0FBQUEsRUFDdkIsZUFBQSxHQUEwQyxJQUFBO0FBQUEsRUFFMUMsV0FBQSxDQUFZLE1BQXFCLE1BQUEsRUFBcUI7QUFDbEQsSUFBQSxLQUFBLENBQU0sSUFBSSxDQUFBO0FBQ1YsSUFBQSxJQUFBLENBQUssTUFBQSxHQUFTLE1BQUE7QUFDZCxJQUFBLElBQUEsQ0FBSyxrQkFBQSxHQUFxQixJQUFJQyxrQkFBQSxFQUFVO0FBQUEsRUFDNUM7QUFBQSxFQUVBLFdBQUEsR0FBc0I7QUFBRSxJQUFBLE9BQU8sZUFBQTtBQUFBLEVBQWlCO0FBQUEsRUFDaEQsY0FBQSxHQUF5QjtBQUFFLElBQUEsT0FBTyxxQkFBQTtBQUFBLEVBQXVCO0FBQUEsRUFDekQsT0FBQSxHQUFrQjtBQUFFLElBQUEsT0FBTyxVQUFBO0FBQUEsRUFBWTtBQUFBLEVBRXZDLE1BQU0sTUFBQSxHQUFTO0FBQ1gsSUFBQSxJQUFBLENBQUssbUJBQW1CLElBQUEsRUFBSztBQUM3QixJQUFBLE1BQU0sS0FBSyx3QkFBQSxFQUF5QjtBQUVwQyxJQUFBLE1BQU0sU0FBQSxHQUFZLElBQUEsQ0FBSyxXQUFBLENBQVksUUFBQSxDQUFTLENBQUMsQ0FBQTtBQUM3QyxJQUFBLFNBQUEsQ0FBVSxLQUFBLEVBQU07QUFFaEIsSUFBQSxNQUFNLE9BQUEsR0FBVSxTQUFBLENBQVUsUUFBQSxDQUFTLEtBQUEsRUFBTztBQUFBLE1BQ3RDLElBQUEsRUFBTSxFQUFFLEtBQUEsRUFBTyxvSEFBQTtBQUFxSCxLQUN2SSxDQUFBO0FBR0QsSUFBQSxNQUFNLE1BQUEsR0FBUyxPQUFBLENBQVEsUUFBQSxDQUFTLEtBQUEsRUFBTztBQUFBLE1BQ25DLElBQUEsRUFBTSxFQUFFLEtBQUEsRUFBTyx1SkFBQTtBQUF3SixLQUMxSyxDQUFBO0FBQ0QsSUFBQSxNQUFBLENBQU8sUUFBQSxDQUFTLElBQUEsRUFBTSxFQUFFLElBQUEsRUFBTSxPQUFBLEVBQVMsTUFBTSxFQUFFLEtBQUEsRUFBTyx5RkFBQSxFQUEwRixFQUFHLENBQUE7QUFDbkosSUFBQSxJQUFBLENBQUssZUFBQSxHQUFrQixNQUFBLENBQU8sUUFBQSxDQUFTLFFBQUEsRUFBVTtBQUFBLE1BQzdDLElBQUEsRUFBTSxFQUFFLEtBQUEsRUFBTyxvSUFBQTtBQUFxSSxLQUN2SixDQUFBO0FBQ0QsSUFBQSxJQUFBLENBQUssc0JBQUEsRUFBdUI7QUFDNUIsSUFBQSxJQUFBLENBQUssZUFBQSxDQUFnQixnQkFBQSxDQUFpQixRQUFBLEVBQVUsWUFBWTtBQUN4RCxNQUFBLElBQUEsQ0FBSyxNQUFBLENBQU8sUUFBQSxDQUFTLGVBQUEsR0FBa0IsSUFBQSxDQUFLLGVBQUEsQ0FBZ0IsS0FBQTtBQUM1RCxNQUFBLE1BQU0sSUFBQSxDQUFLLE9BQU8sWUFBQSxFQUFhO0FBQy9CLE1BQUEsTUFBTSxLQUFLLHdCQUFBLEVBQXlCO0FBQ3BDLE1BQUEsSUFBQSxDQUFLLGNBQUEsRUFBZTtBQUFBLElBQ3hCLENBQUMsQ0FBQTtBQUdELElBQUEsTUFBTSxZQUFBLEdBQWUsT0FBQSxDQUFRLFFBQUEsQ0FBUyxLQUFBLEVBQU8sRUFBRSxNQUFNLEVBQUUsS0FBQSxFQUFPLCtDQUFBLEVBQWdELEVBQUcsQ0FBQTtBQUVqSCxJQUFBLE1BQU0sU0FBQSxHQUFZLGFBQWEsUUFBQSxDQUFTLFFBQUEsRUFBVSxFQUFFLElBQUEsRUFBTSxvQkFBQSxFQUFzQixHQUFBLEVBQUssbUJBQUEsRUFBcUIsQ0FBQTtBQUMxRyxJQUFBLFNBQUEsQ0FBVSxnQkFBQSxDQUFpQixPQUFBLEVBQVMsTUFBTSxJQUFBLENBQUsseUJBQXlCLENBQUE7QUFFeEUsSUFBQSxNQUFNLE9BQUEsR0FBVSxhQUFhLFFBQUEsQ0FBUyxRQUFBLEVBQVUsRUFBRSxJQUFBLEVBQU0sVUFBQSxFQUFZLEdBQUEsRUFBSywwQkFBQSxFQUE0QixDQUFBO0FBQ3JHLElBQUEsT0FBQSxDQUFRLGdCQUFBLENBQWlCLFNBQVMsTUFBTTtBQUNwQyxNQUFBLElBQUksSUFBQSxDQUFLLGVBQUEsSUFBbUIsSUFBQSxDQUFLLFdBQUEsRUFBYTtBQUMxQyxRQUFBLElBQUEsQ0FBSyxnQkFBZ0IsS0FBQSxFQUFNO0FBQzNCLFFBQUEsSUFBSUMsZ0JBQU8sb0JBQW9CLENBQUE7QUFBQSxNQUNuQztBQUFBLElBQ0osQ0FBQyxDQUFBO0FBRUQsSUFBQSxNQUFNLFFBQUEsR0FBVyxhQUFhLFFBQUEsQ0FBUyxRQUFBLEVBQVUsRUFBRSxJQUFBLEVBQU0sY0FBQSxFQUFnQixHQUFBLEVBQUssbUJBQUEsRUFBcUIsQ0FBQTtBQUNuRyxJQUFBLFFBQUEsQ0FBUyxnQkFBQSxDQUFpQixTQUFTLE1BQU07QUFDckMsTUFBQSxJQUFBLENBQUssV0FBQSxHQUFjLENBQUMsRUFBRSxJQUFBLEVBQU0sUUFBQSxFQUFVLE9BQUEsRUFBUyxJQUFBLENBQUssTUFBQSxDQUFPLGdCQUFBLEVBQWlCLENBQUUsWUFBQSxFQUFjLENBQUE7QUFDNUYsTUFBQSxJQUFBLENBQUssd0JBQUEsRUFBeUI7QUFDOUIsTUFBQSxJQUFBLENBQUssY0FBQSxFQUFlO0FBQ3BCLE1BQUEsSUFBSUEsZ0JBQU8sZUFBZSxDQUFBO0FBQUEsSUFDOUIsQ0FBQyxDQUFBO0FBR0QsSUFBQSxJQUFBLENBQUssZ0JBQUEsR0FBbUIsT0FBQSxDQUFRLFFBQUEsQ0FBUyxLQUFBLEVBQU87QUFBQSxNQUM1QyxJQUFBLEVBQU0sRUFBRSxLQUFBLEVBQU8sdUdBQUE7QUFBd0csS0FDMUgsQ0FBQTtBQUdELElBQUEsTUFBTSxTQUFBLEdBQVksT0FBQSxDQUFRLFFBQUEsQ0FBUyxLQUFBLEVBQU8sRUFBRSxNQUFNLEVBQUUsS0FBQSxFQUFPLGlEQUFBLEVBQWtELEVBQUcsQ0FBQTtBQUNoSCxJQUFBLElBQUEsQ0FBSyxVQUFBLEdBQWEsU0FBQSxDQUFVLFFBQUEsQ0FBUyxVQUFBLEVBQVk7QUFBQSxNQUM3QyxJQUFBLEVBQU07QUFBQSxRQUNGLFdBQUEsRUFBYSwyQ0FBQTtBQUFBLFFBQ2IsSUFBQSxFQUFNLEdBQUE7QUFBQSxRQUNOLEtBQUEsRUFBTztBQUFBO0FBQ1gsS0FDSCxDQUFBO0FBRUQsSUFBQSxNQUFNLE9BQUEsR0FBVSxTQUFBLENBQVUsUUFBQSxDQUFTLFFBQUEsRUFBVSxFQUFFLElBQUEsRUFBTSxLQUFBLEVBQU8sR0FBQSxFQUFLLFNBQUEsRUFBVyxJQUFBLEVBQU0sRUFBRSxLQUFBLEVBQU8sd0ZBQUEsSUFBNEYsQ0FBQTtBQUV2TCxJQUFBLE9BQUEsQ0FBUSxnQkFBQSxDQUFpQixTQUFTLE1BQU07QUFBRSxNQUFBLElBQUksQ0FBQyxLQUFLLFdBQUEsRUFBYSxJQUFBLENBQUssZUFBZSxJQUFBLENBQUssVUFBQSxDQUFXLEtBQUEsQ0FBTSxJQUFBLEVBQU0sQ0FBQTtBQUFBLElBQUcsQ0FBQyxDQUFBO0FBQ3JILElBQUEsSUFBQSxDQUFLLFVBQUEsQ0FBVyxnQkFBQSxDQUFpQixTQUFBLEVBQVcsQ0FBQyxDQUFBLEtBQU07QUFDL0MsTUFBQSxJQUFJLENBQUEsQ0FBRSxHQUFBLEtBQVEsT0FBQSxJQUFXLENBQUMsRUFBRSxRQUFBLEVBQVU7QUFDbEMsUUFBQSxDQUFBLENBQUUsY0FBQSxFQUFlO0FBQ2pCLFFBQUEsSUFBSSxDQUFDLEtBQUssV0FBQSxFQUFhLElBQUEsQ0FBSyxlQUFlLElBQUEsQ0FBSyxVQUFBLENBQVcsS0FBQSxDQUFNLElBQUEsRUFBTSxDQUFBO0FBQUEsTUFDM0U7QUFBQSxJQUNKLENBQUMsQ0FBQTtBQUVELElBQUEsSUFBQSxDQUFLLGNBQUEsRUFBZTtBQUFBLEVBQ3hCO0FBQUEsRUFFQSxzQkFBQSxHQUF5QjtBQUNyQixJQUFBLElBQUEsQ0FBSyxnQkFBZ0IsS0FBQSxFQUFNO0FBQzNCLElBQUEsSUFBQSxDQUFLLE1BQUEsQ0FBTyxRQUFBLENBQVMsUUFBQSxDQUFTLE9BQUEsQ0FBUSxDQUFBLENBQUEsS0FBSztBQUN2QyxNQUFBLE1BQU0sR0FBQSxHQUFNLElBQUEsQ0FBSyxlQUFBLENBQWdCLFFBQUEsQ0FBUyxVQUFVLEVBQUUsSUFBQSxFQUFNLENBQUEsQ0FBRSxJQUFBLEVBQU0sTUFBTSxFQUFFLEtBQUEsRUFBTyxDQUFBLENBQUUsRUFBQSxJQUFNLENBQUE7QUFDM0YsTUFBQSxJQUFJLENBQUEsQ0FBRSxPQUFPLElBQUEsQ0FBSyxNQUFBLENBQU8sU0FBUyxlQUFBLEVBQWlCLEdBQUEsQ0FBSSxZQUFBLENBQWEsVUFBQSxFQUFZLFVBQVUsQ0FBQTtBQUFBLElBQzlGLENBQUMsQ0FBQTtBQUFBLEVBQ0w7QUFBQSxFQUVBLE1BQU0sd0JBQUEsR0FBMkI7QUFDN0IsSUFBQSxNQUFNLE9BQUEsR0FBVSxJQUFBLENBQUssTUFBQSxDQUFPLGdCQUFBLEVBQWlCO0FBQzdDLElBQUEsTUFBTSxRQUFBLEdBQVcsQ0FBQSxhQUFBLEVBQWdCLE9BQUEsQ0FBUSxFQUFFLENBQUEscUJBQUEsQ0FBQTtBQUMzQyxJQUFBLElBQUk7QUFDQSxNQUFBLElBQUksTUFBTSxLQUFLLE1BQUEsQ0FBTyxHQUFBLENBQUksTUFBTSxPQUFBLENBQVEsTUFBQSxDQUFPLFFBQVEsQ0FBQSxFQUFHO0FBQ3RELFFBQUEsTUFBTSxPQUFBLEdBQVUsTUFBTSxJQUFBLENBQUssTUFBQSxDQUFPLElBQUksS0FBQSxDQUFNLE9BQUEsQ0FBUSxLQUFLLFFBQVEsQ0FBQTtBQUNqRSxRQUFBLE1BQU0sTUFBQSxHQUFTLElBQUEsQ0FBSyxLQUFBLENBQU0sT0FBTyxDQUFBO0FBQ2pDLFFBQUEsSUFBQSxDQUFLLFdBQUEsR0FBYyxNQUFBLENBQU8sTUFBQSxHQUFTLENBQUEsR0FBSSxNQUFBLEdBQVMsQ0FBQyxFQUFFLElBQUEsRUFBTSxRQUFBLEVBQVUsT0FBQSxFQUFTLE9BQUEsQ0FBUSxZQUFBLEVBQWMsQ0FBQTtBQUFBLE1BQ3RHLENBQUEsTUFBTztBQUNILFFBQUEsSUFBQSxDQUFLLFdBQUEsR0FBYyxDQUFDLEVBQUUsSUFBQSxFQUFNLFVBQVUsT0FBQSxFQUFTLE9BQUEsQ0FBUSxjQUFjLENBQUE7QUFBQSxNQUN6RTtBQUFBLElBQ0osU0FBUyxDQUFBLEVBQUc7QUFBRSxNQUFBLElBQUEsQ0FBSyxXQUFBLEdBQWMsQ0FBQyxFQUFFLElBQUEsRUFBTSxVQUFVLE9BQUEsRUFBUyxPQUFBLENBQVEsY0FBYyxDQUFBO0FBQUEsSUFBRztBQUFBLEVBQzFGO0FBQUEsRUFFQSxNQUFNLHdCQUFBLEdBQTJCO0FBQzdCLElBQUEsTUFBTSxPQUFBLEdBQVUsSUFBQSxDQUFLLE1BQUEsQ0FBTyxnQkFBQSxFQUFpQjtBQUM3QyxJQUFBLE1BQU0sUUFBQSxHQUFXLENBQUEsYUFBQSxFQUFnQixPQUFBLENBQVEsRUFBRSxDQUFBLHFCQUFBLENBQUE7QUFDM0MsSUFBQSxNQUFNLElBQUEsQ0FBSyxNQUFBLENBQU8sR0FBQSxDQUFJLEtBQUEsQ0FBTSxPQUFBLENBQVEsS0FBQSxDQUFNLFFBQUEsRUFBVSxJQUFBLENBQUssU0FBQSxDQUFVLElBQUEsQ0FBSyxXQUFBLEVBQWEsSUFBQSxFQUFNLENBQUMsQ0FBQyxDQUFBO0FBQUEsRUFDakc7QUFBQTtBQUFBLEVBR0EsTUFBTSx1QkFBQSxHQUEwQjtBQUM1QixJQUFBLE1BQU0sVUFBQSxHQUFhLElBQUEsQ0FBSyxNQUFBLENBQU8sR0FBQSxDQUFJLFVBQVUsYUFBQSxFQUFjO0FBQzNELElBQUEsSUFBSSxDQUFDLFVBQUEsRUFBWTtBQUNiLE1BQUEsSUFBSUEsZ0JBQU8saUNBQWlDLENBQUE7QUFDNUMsTUFBQTtBQUFBLElBQ0o7QUFDQSxJQUFBLE1BQU0sVUFBVSxNQUFNLElBQUEsQ0FBSyxPQUFPLEdBQUEsQ0FBSSxLQUFBLENBQU0sS0FBSyxVQUFVLENBQUE7QUFDM0QsSUFBQSxJQUFBLENBQUssWUFBWSxJQUFBLENBQUs7QUFBQSxNQUNsQixJQUFBLEVBQU0sUUFBQTtBQUFBLE1BQ04sT0FBQSxFQUFTLENBQUEsaUVBQUEsRUFBb0UsVUFBQSxDQUFXLElBQUksQ0FBQTs7QUFBQSxFQUFTLE9BQU8sQ0FBQTtBQUFBLEtBQy9HLENBQUE7QUFDRCxJQUFBLElBQUlBLGVBQUEsQ0FBTyxDQUFBLFNBQUEsRUFBWSxVQUFBLENBQVcsUUFBUSxDQUFBLHlCQUFBLENBQTJCLENBQUE7QUFBQSxFQUN6RTtBQUFBLEVBRUEsTUFBTSxjQUFBLEdBQWlCO0FBbmEzQixJQUFBLElBQUEsRUFBQSxFQUFBLEVBQUE7QUFvYVEsSUFBQSxJQUFJLENBQUMsS0FBSyxnQkFBQSxFQUFrQjtBQUM1QixJQUFBLElBQUEsQ0FBSyxpQkFBaUIsS0FBQSxFQUFNO0FBRTVCLElBQUEsS0FBQSxJQUFTLElBQUksQ0FBQSxFQUFHLENBQUEsR0FBSSxJQUFBLENBQUssV0FBQSxDQUFZLFFBQVEsQ0FBQSxFQUFBLEVBQUs7QUFDOUMsTUFBQSxNQUFNLEdBQUEsR0FBTSxJQUFBLENBQUssV0FBQSxDQUFZLENBQUMsQ0FBQTtBQUc5QixNQUFBLElBQUksSUFBSSxJQUFBLEtBQVMsUUFBQSxLQUFBLENBQVksU0FBSSxPQUFBLEtBQUosSUFBQSxHQUFBLE1BQUEsR0FBQSxFQUFBLENBQWEsV0FBVyx1QkFBQSxDQUFBLENBQUEsRUFBMEI7QUFDM0UsUUFBQSxNQUFNLE1BQUEsR0FBUyxJQUFBLENBQUssZ0JBQUEsQ0FBaUIsUUFBQSxDQUFTLEtBQUEsRUFBTztBQUFBLFVBQ2pELElBQUEsRUFBTSxFQUFFLEtBQUEsRUFBTyxnS0FBQTtBQUFpSyxTQUNuTCxDQUFBO0FBQ0QsUUFBQSxNQUFBLENBQU8sUUFBQSxDQUFTLFFBQUEsRUFBVSxFQUFFLElBQUEsRUFBTSxpQ0FBQSxFQUE0QixNQUFNLEVBQUUsS0FBQSxFQUFPLHFDQUFBLEVBQXNDLEVBQUcsQ0FBQTtBQUN0SCxRQUFBLE1BQUEsQ0FBTyxRQUFBLENBQVMsTUFBQSxFQUFRLEVBQUUsSUFBQSxFQUFNLDJEQUEyRCxDQUFBO0FBQzNGLFFBQUE7QUFBQSxNQUNKO0FBRUEsTUFBQSxJQUFJLElBQUksSUFBQSxLQUFTLFFBQUEsSUFBWSxJQUFJLElBQUEsS0FBUyxNQUFBLElBQVUsSUFBSSxVQUFBLEVBQVk7QUFFcEUsTUFBQSxNQUFNLE1BQUEsR0FBUyxJQUFJLElBQUEsS0FBUyxNQUFBO0FBQzVCLE1BQUEsTUFBTSxNQUFBLEdBQVMsSUFBQSxDQUFLLGdCQUFBLENBQWlCLFFBQUEsQ0FBUyxLQUFBLEVBQU87QUFBQSxRQUNqRCxJQUFBLEVBQU07QUFBQSxVQUNGLEtBQUEsRUFBTyxDQUFBLGdHQUFBLEVBQ0gsTUFBQSxHQUFTLDRGQUFBLEdBQStGLHVIQUM1RyxDQUFBO0FBQUE7QUFDSixPQUNILENBQUE7QUFFRCxNQUFBLE1BQUEsQ0FBTyxTQUFTLFFBQUEsRUFBVTtBQUFBLFFBQ3RCLElBQUEsRUFBTSxTQUFTLFNBQUEsR0FBWSxDQUFBLEVBQUcsS0FBSyxNQUFBLENBQU8sZ0JBQUEsR0FBbUIsSUFBSSxDQUFBLEdBQUEsQ0FBQTtBQUFBLFFBQ2pFLElBQUEsRUFBTSxFQUFFLEtBQUEsRUFBTyx1SEFBQTtBQUF3SCxPQUMxSSxDQUFBO0FBRUQsTUFBQSxNQUFNLGNBQWMsTUFBQSxDQUFPLFFBQUEsQ0FBUyxPQUFPLEVBQUUsR0FBQSxFQUFLLHFCQUFxQixDQUFBO0FBQ3ZFLE1BQUEsTUFBTUMsMEJBQWlCLGNBQUEsQ0FBZSxHQUFBLENBQUksT0FBQSxJQUFXLEVBQUEsRUFBSSxlQUFhLEVBQUEsR0FBQSxJQUFBLENBQUssTUFBQSxDQUFPLEdBQUEsQ0FBSSxTQUFBLENBQVUsZUFBYyxLQUF4QyxJQUFBLEdBQUEsTUFBQSxHQUFBLEVBQUEsQ0FBMkMsSUFBQSxLQUFRLEVBQUEsRUFBSSxLQUFLLGtCQUFrQixDQUFBO0FBQUEsSUFDeEo7QUFDQSxJQUFBLElBQUEsQ0FBSyxnQkFBQSxDQUFpQixTQUFBLEdBQVksSUFBQSxDQUFLLGdCQUFBLENBQWlCLFlBQUE7QUFBQSxFQUM1RDtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBTSxlQUFlLFdBQUEsRUFBc0I7QUE3Yy9DLElBQUEsSUFBQSxFQUFBLEVBQUEsRUFBQSxFQUFBLEVBQUE7QUE4Y1EsSUFBQSxJQUFJLFdBQUEsRUFBYTtBQUNiLE1BQUEsSUFBQSxDQUFLLFdBQVcsS0FBQSxHQUFRLEVBQUE7QUFDeEIsTUFBQSxJQUFBLENBQUssWUFBWSxJQUFBLENBQUssRUFBRSxNQUFNLE1BQUEsRUFBUSxPQUFBLEVBQVMsYUFBYSxDQUFBO0FBQzVELE1BQUEsTUFBTSxLQUFLLGNBQUEsRUFBZTtBQUFBLElBQzlCO0FBRUEsSUFBQSxJQUFBLENBQUssV0FBQSxHQUFjLElBQUE7QUFDbkIsSUFBQSxJQUFBLENBQUssZUFBQSxHQUFrQixJQUFJLGVBQUEsRUFBZ0I7QUFDM0MsSUFBQSxNQUFNLGNBQUEsR0FBaUIsSUFBQSxDQUFLLE1BQUEsQ0FBTyxnQkFBQSxFQUFpQjtBQUVwRCxJQUFBLE1BQU0sZUFBQSxHQUFrQixJQUFBLENBQUssV0FBQSxDQUFZLElBQUEsQ0FBSyxFQUFFLE1BQU0sV0FBQSxFQUFhLE9BQUEsRUFBUyxFQUFBLEVBQUksQ0FBQSxHQUFJLENBQUE7QUFDcEYsSUFBQSxNQUFNLEtBQUssY0FBQSxFQUFlO0FBRTFCLElBQUEsTUFBTSxVQUFBLEdBQWEsS0FBSyxnQkFBQSxDQUFpQixnQkFBQTtBQUN6QyxJQUFBLFVBQUEsQ0FBVyxLQUFBLEVBQU07QUFDakIsSUFBQSxVQUFBLENBQVcsUUFBQSxDQUFTLFFBQUEsRUFBVSxFQUFFLElBQUEsRUFBTSxDQUFBLEVBQUcsY0FBQSxDQUFlLElBQUksQ0FBQSxHQUFBLENBQUEsRUFBTyxJQUFBLEVBQU0sRUFBRSxLQUFBLEVBQU8sdUhBQUEsSUFBMkgsQ0FBQTtBQUU3TSxJQUFBLE1BQU0sWUFBQSxHQUFlLFVBQUEsQ0FBVyxRQUFBLENBQVMsU0FBQSxFQUFXLEVBQUUsTUFBTSxFQUFFLEtBQUEsRUFBTyxtSkFBQSxFQUFvSixFQUFHLENBQUE7QUFDNU4sSUFBQSxZQUFBLENBQWEsUUFBQSxDQUFTLFNBQUEsRUFBVyxFQUFFLElBQUEsRUFBTSxZQUFBLEVBQWMsTUFBTSxFQUFFLEtBQUEsRUFBTywyRkFBQSxFQUE0RixFQUFHLENBQUE7QUFDckssSUFBQSxNQUFNLFlBQUEsR0FBZSxZQUFBLENBQWEsUUFBQSxDQUFTLEtBQUEsRUFBTyxFQUFFLE1BQU0sRUFBRSxLQUFBLEVBQU8sZ0dBQUEsRUFBaUcsRUFBRyxDQUFBO0FBRXZLLElBQUEsTUFBTSxjQUFjLFVBQUEsQ0FBVyxRQUFBLENBQVMsT0FBTyxFQUFFLEdBQUEsRUFBSyxxQkFBcUIsQ0FBQTtBQUUzRSxJQUFBLE1BQU0sWUFBQSxHQUFlLGVBQUEsQ0FBZ0IsZUFBQSxFQUFnQixDQUFFLElBQUksQ0FBQSxDQUFBLE1BQU07QUFBQSxNQUM3RCxJQUFBLEVBQU0sVUFBQTtBQUFBLE1BQ04sUUFBQSxFQUFVLEVBQUUsSUFBQSxFQUFNLENBQUEsQ0FBRSxJQUFBLEVBQU0sYUFBYSxDQUFBLENBQUUsV0FBQSxFQUFhLFVBQUEsRUFBWSxDQUFBLENBQUUsV0FBQTtBQUFZLEtBQ3BGLENBQUUsQ0FBQTtBQUVGLElBQUEsSUFBSSx1QkFBQSxHQUEwQixJQUFBO0FBQzlCLElBQUEsSUFBSSxxQkFBQSxHQUF3QixDQUFBO0FBRTVCLElBQUEsT0FBTyx1QkFBQSxJQUEyQix3QkFBd0IsQ0FBQSxFQUFHO0FBQ3pELE1BQUEscUJBQUEsRUFBQTtBQUNBLE1BQUEsSUFBSTtBQUNBLFFBQUEsTUFBTSxPQUFBLEdBQWtDLEVBQUUsY0FBQSxFQUFnQixrQkFBQSxFQUFtQjtBQUM3RSxRQUFBLElBQUksZUFBZSxNQUFBLEVBQVEsT0FBQSxDQUFRLGVBQWUsQ0FBQSxHQUFJLENBQUEsT0FBQSxFQUFVLGVBQWUsTUFBTSxDQUFBLENBQUE7QUFFckYsUUFBQSxNQUFNLFdBQVcsTUFBTSxLQUFBLENBQU0sQ0FBQSxFQUFHLGNBQUEsQ0FBZSxNQUFNLENBQUEsaUJBQUEsQ0FBQSxFQUFxQjtBQUFBLFVBQ3RFLE1BQUEsRUFBUSxNQUFBO0FBQUEsVUFDUixPQUFBO0FBQUEsVUFDQSxNQUFBLEVBQVEsS0FBSyxlQUFBLENBQWdCLE1BQUE7QUFBQSxVQUM3QixJQUFBLEVBQU0sS0FBSyxTQUFBLENBQVU7QUFBQSxZQUNqQixPQUFPLGNBQUEsQ0FBZSxTQUFBO0FBQUEsWUFDdEIsUUFBQSxFQUFVLElBQUEsQ0FBSyxXQUFBLENBQVksS0FBQSxDQUFNLEdBQUcsSUFBQSxDQUFLLFdBQUEsQ0FBWSxNQUFBLEdBQVMsQ0FBQyxDQUFBLENBQUUsTUFBQSxDQUFPLENBQUEsQ0FBQSxLQUFLLENBQUEsQ0FBRSxZQUFZLEVBQUUsQ0FBQTtBQUFBLFlBQzdGLGFBQWEsY0FBQSxDQUFlLFdBQUE7QUFBQSxZQUM1QixNQUFBLEVBQVEsSUFBQTtBQUFBLFlBQ1IsS0FBQSxFQUFPO0FBQUEsV0FDVjtBQUFBLFNBQ0osQ0FBQTtBQUVELFFBQUEsSUFBSSxDQUFDLFFBQUEsQ0FBUyxJQUFBLEVBQU0sTUFBTSxJQUFJLE1BQU0sZ0NBQWdDLENBQUE7QUFDcEUsUUFBQSxNQUFNLE1BQUEsR0FBUyxRQUFBLENBQVMsSUFBQSxDQUFLLFNBQUEsRUFBVTtBQUN2QyxRQUFBLE1BQU0sT0FBQSxHQUFVLElBQUksV0FBQSxDQUFZLE9BQU8sQ0FBQTtBQUV2QyxRQUFBLElBQUksYUFBQSxHQUFnQixFQUFBO0FBQ3BCLFFBQUEsSUFBSSxZQUFBLEdBQWUsRUFBQTtBQUNuQixRQUFBLElBQUksV0FBQSxHQUFjLEVBQUE7QUFDbEIsUUFBQSxJQUFJLHVCQUFBLEdBQStCLElBQUE7QUFFbkMsUUFBQSxPQUFPLElBQUEsRUFBTTtBQUNULFVBQUEsTUFBTSxFQUFFLElBQUEsRUFBTSxLQUFBLEVBQU0sR0FBSSxNQUFNLE9BQU8sSUFBQSxFQUFLO0FBQzFDLFVBQUEsSUFBSSxJQUFBLEVBQU07QUFFVixVQUFBLE1BQU0sUUFBUSxPQUFBLENBQVEsTUFBQSxDQUFPLE9BQU8sRUFBRSxNQUFBLEVBQVEsTUFBTSxDQUFBO0FBQ3BELFVBQUEsTUFBTSxLQUFBLEdBQVEsS0FBQSxDQUFNLEtBQUEsQ0FBTSxJQUFJLENBQUEsQ0FBRSxPQUFPLENBQUEsSUFBQSxLQUFRLElBQUEsQ0FBSyxJQUFBLEVBQUssS0FBTSxFQUFFLENBQUE7QUFFakUsVUFBQSxLQUFBLE1BQVcsUUFBUSxLQUFBLEVBQU87QUFDdEIsWUFBQSxJQUFJLEtBQUssT0FBQSxDQUFRLFNBQUEsRUFBVyxFQUFFLENBQUEsQ0FBRSxJQUFBLE9BQVcsUUFBQSxFQUFVO0FBQ3JELFlBQUEsSUFBSSxJQUFBLENBQUssVUFBQSxDQUFXLFFBQVEsQ0FBQSxFQUFHO0FBQzNCLGNBQUEsSUFBSTtBQUNBLGdCQUFBLE1BQU0sU0FBUyxJQUFBLENBQUssS0FBQSxDQUFNLElBQUEsQ0FBSyxLQUFBLENBQU0sQ0FBQyxDQUFDLENBQUE7QUFDdkMsZ0JBQUEsTUFBTSxLQUFBLEdBQVEsTUFBQSxDQUFPLE9BQUEsQ0FBUSxDQUFDLENBQUEsQ0FBRSxLQUFBO0FBRWhDLGdCQUFBLElBQUksTUFBTSxVQUFBLEVBQVk7QUFDbEIsa0JBQUEsSUFBSSxDQUFDLHVCQUFBLEVBQXlCLHVCQUFBLEdBQTBCLEVBQUUsRUFBQSxFQUFJLEVBQUEsRUFBSSxRQUFBLEVBQVUsRUFBRSxJQUFBLEVBQU0sRUFBQSxFQUFJLFNBQUEsRUFBVyxFQUFBLEVBQUcsRUFBRTtBQUN4RyxrQkFBQSxNQUFNLElBQUEsR0FBTyxLQUFBLENBQU0sVUFBQSxDQUFXLENBQUMsQ0FBQTtBQUMvQixrQkFBQSxJQUFJLElBQUEsQ0FBSyxFQUFBLEVBQUksdUJBQUEsQ0FBd0IsRUFBQSxJQUFNLElBQUEsQ0FBSyxFQUFBO0FBQ2hELGtCQUFBLElBQUEsQ0FBSSxFQUFBLEdBQUEsSUFBQSxDQUFLLGFBQUwsSUFBQSxHQUFBLEtBQUEsQ0FBQSxHQUFBLEVBQUEsQ0FBZSxJQUFBLDBCQUE4QixRQUFBLENBQVMsSUFBQSxJQUFRLEtBQUssUUFBQSxDQUFTLElBQUE7QUFDaEYsa0JBQUEsSUFBQSxDQUFJLEVBQUEsR0FBQSxJQUFBLENBQUssYUFBTCxJQUFBLEdBQUEsS0FBQSxDQUFBLEdBQUEsRUFBQSxDQUFlLFNBQUEsMEJBQW1DLFFBQUEsQ0FBUyxTQUFBLElBQWEsS0FBSyxRQUFBLENBQVMsU0FBQTtBQUUxRixrQkFBQSxZQUFBLENBQWEsTUFBTSxPQUFBLEdBQVUsT0FBQTtBQUM3QixrQkFBQSxZQUFBLENBQWEsWUFBQSxDQUFhLFFBQVEsRUFBRSxDQUFBO0FBQ3BDLGtCQUFBLFlBQUEsQ0FBYSxTQUFBLEdBQVksQ0FBQSxtQ0FBQSxFQUFzQyx1QkFBQSxDQUF3QixRQUFBLENBQVMsSUFBSTtBQUFBLE1BQUEsRUFBVyx1QkFBQSxDQUF3QixTQUFTLFNBQVMsQ0FBQSxDQUFBO0FBQ3pKLGtCQUFBO0FBQUEsZ0JBQ0o7QUFFQSxnQkFBQSxJQUFJLEtBQUEsQ0FBTSxPQUFBLEVBQVMsYUFBQSxJQUFpQixLQUFBLENBQU0sT0FBQTtBQUUxQyxnQkFBQSxJQUFJLGFBQUEsQ0FBYyxRQUFBLENBQVMsU0FBUyxDQUFBLEVBQUc7QUFDbkMsa0JBQUEsTUFBTSxLQUFBLEdBQVEsYUFBQSxDQUFjLEtBQUEsQ0FBTSxTQUFTLENBQUE7QUFDM0Msa0JBQUEsTUFBTSxVQUFBLEdBQWEsS0FBQSxDQUFNLENBQUMsQ0FBQSxJQUFLLEVBQUE7QUFDL0Isa0JBQUEsSUFBSSxVQUFBLENBQVcsUUFBQSxDQUFTLFVBQVUsQ0FBQSxFQUFHO0FBQ2pDLG9CQUFBLE1BQU0sUUFBQSxHQUFXLFVBQUEsQ0FBVyxLQUFBLENBQU0sVUFBVSxDQUFBO0FBQzVDLG9CQUFBLFlBQUEsR0FBZSxTQUFTLENBQUMsQ0FBQTtBQUN6QixvQkFBQSxXQUFBLEdBQWMsS0FBQSxDQUFNLENBQUMsQ0FBQSxHQUFJLFFBQUEsQ0FBUyxNQUFNLENBQUMsQ0FBQSxDQUFFLEtBQUssVUFBVSxDQUFBO0FBQzFELG9CQUFBLFlBQUEsQ0FBYSxnQkFBZ0IsTUFBTSxDQUFBO0FBQUEsa0JBQ3ZDLENBQUEsTUFBTztBQUNILG9CQUFBLFlBQUEsR0FBZSxVQUFBO0FBQ2Ysb0JBQUEsV0FBQSxHQUFjLE1BQU0sQ0FBQyxDQUFBO0FBQ3JCLG9CQUFBLFlBQUEsQ0FBYSxNQUFNLE9BQUEsR0FBVSxPQUFBO0FBQzdCLG9CQUFBLElBQUksQ0FBQyxhQUFhLFlBQUEsQ0FBYSxNQUFNLEdBQUcsWUFBQSxDQUFhLFlBQUEsQ0FBYSxRQUFRLEVBQUUsQ0FBQTtBQUFBLGtCQUNoRjtBQUFBLGdCQUNKLENBQUEsTUFBTztBQUNILGtCQUFBLFdBQUEsR0FBYyxhQUFBO0FBQUEsZ0JBQ2xCO0FBRUEsZ0JBQUEsSUFBSSxNQUFNLGlCQUFBLEVBQW1CO0FBQ3pCLGtCQUFBLFlBQUEsSUFBZ0IsS0FBQSxDQUFNLGlCQUFBO0FBQ3RCLGtCQUFBLFlBQUEsQ0FBYSxNQUFNLE9BQUEsR0FBVSxPQUFBO0FBQzdCLGtCQUFBLElBQUksQ0FBQyxhQUFhLFlBQUEsQ0FBYSxNQUFNLEdBQUcsWUFBQSxDQUFhLFlBQUEsQ0FBYSxRQUFRLEVBQUUsQ0FBQTtBQUFBLGdCQUNoRjtBQUVBLGdCQUFBLElBQUksWUFBQSxlQUEyQixTQUFBLEdBQVksWUFBQTtBQUMzQyxnQkFBQSxJQUFJLFdBQUEsRUFBYTtBQUNiLGtCQUFBLFdBQUEsQ0FBWSxLQUFBLEVBQU07QUFDbEIsa0JBQUEsTUFBTUEseUJBQUEsQ0FBaUIsY0FBQSxDQUFlLFdBQUEsRUFBYSxXQUFBLEVBQUEsQ0FBQSxDQUFhLFVBQUssTUFBQSxDQUFPLEdBQUEsQ0FBSSxTQUFBLENBQVUsYUFBQSxFQUFjLEtBQXhDLElBQUEsR0FBQSxLQUFBLENBQUEsR0FBQSxFQUFBLENBQTJDLElBQUEsS0FBUSxFQUFBLEVBQUksS0FBSyxrQkFBa0IsQ0FBQTtBQUFBLGdCQUNsSjtBQUNBLGdCQUFBLElBQUEsQ0FBSyxnQkFBQSxDQUFpQixTQUFBLEdBQVksSUFBQSxDQUFLLGdCQUFBLENBQWlCLFlBQUE7QUFBQSxjQUM1RCxTQUFTLENBQUEsRUFBRztBQUFBLGNBQUM7QUFBQSxZQUNqQjtBQUFBLFVBQ0o7QUFBQSxRQUNKO0FBR0EsUUFBQSxJQUFJLHVCQUFBLElBQTJCLHVCQUFBLENBQXdCLFFBQUEsQ0FBUyxJQUFBLEVBQU07QUFDbEUsVUFBQSxNQUFNLGtCQUFrQixJQUFBLENBQUssS0FBQSxDQUFNLHVCQUFBLENBQXdCLFFBQUEsQ0FBUyxhQUFhLElBQUksQ0FBQTtBQUdyRixVQUFBLElBQUksdUJBQUEsQ0FBd0IsUUFBQSxDQUFTLElBQUEsS0FBUyx1QkFBQSxFQUF5QjtBQUVuRSxZQUFBLElBQUEsQ0FBSyxZQUFZLE1BQUEsQ0FBTyxJQUFBLENBQUssV0FBQSxDQUFZLE1BQUEsR0FBUyxHQUFHLENBQUEsRUFBRztBQUFBLGNBQ3BELElBQUEsRUFBTSxXQUFBO0FBQUEsY0FBYSxPQUFBLEVBQVMsSUFBQTtBQUFBLGNBQU0sVUFBQSxFQUFZLENBQUMsRUFBRSxFQUFBLEVBQUksdUJBQUEsQ0FBd0IsRUFBQSxFQUFJLElBQUEsRUFBTSxVQUFBLEVBQVksUUFBQSxFQUFVLHVCQUFBLENBQXdCLFFBQUEsRUFBVTtBQUFBLGFBQ2xKLENBQUE7QUFDRCxZQUFBLElBQUEsQ0FBSyxxQkFBQSxDQUFzQix1QkFBQSxFQUF5QixlQUFBLEVBQWlCLGVBQWUsQ0FBQTtBQUNwRixZQUFBO0FBQUEsVUFDSjtBQUdBLFVBQUEsTUFBTSxjQUFBLEdBQWlCO0FBQUEsWUFDbkIsSUFBQSxFQUFNLFdBQUE7QUFBQSxZQUNOLE9BQUEsRUFBUyxJQUFBO0FBQUEsWUFDVCxVQUFBLEVBQVksQ0FBQyxFQUFFLEVBQUEsRUFBSSx1QkFBQSxDQUF3QixFQUFBLEVBQUksSUFBQSxFQUFNLFVBQUEsRUFBWSxRQUFBLEVBQVUsdUJBQUEsQ0FBd0IsUUFBQSxFQUFVO0FBQUEsV0FDakg7QUFDQSxVQUFBLElBQUEsQ0FBSyxZQUFZLE1BQUEsQ0FBTyxJQUFBLENBQUssWUFBWSxNQUFBLEdBQVMsQ0FBQSxFQUFHLEdBQUcsY0FBcUIsQ0FBQTtBQUU3RSxVQUFBLE1BQU0sb0JBQUEsR0FBdUIsTUFBTSxlQUFBLENBQWdCLFdBQUEsQ0FBWSx3QkFBd0IsUUFBQSxDQUFTLElBQUEsRUFBTSxlQUFBLEVBQWlCLElBQUEsQ0FBSyxNQUFNLENBQUE7QUFFbEksVUFBQSxJQUFBLENBQUssWUFBWSxNQUFBLENBQU8sSUFBQSxDQUFLLFdBQUEsQ0FBWSxNQUFBLEdBQVMsR0FBRyxDQUFBLEVBQUc7QUFBQSxZQUNwRCxJQUFBLEVBQU0sTUFBQTtBQUFBLFlBQ04sY0FBYyx1QkFBQSxDQUF3QixFQUFBO0FBQUEsWUFDdEMsSUFBQSxFQUFNLHdCQUF3QixRQUFBLENBQVMsSUFBQTtBQUFBLFlBQ3ZDLE9BQUEsRUFBUztBQUFBLFdBQ1osQ0FBQTtBQUNELFVBQUE7QUFBQSxRQUNKLENBQUEsTUFBTztBQUNILFVBQUEsSUFBQSxDQUFLLFdBQUEsQ0FBWSxlQUFlLENBQUEsQ0FBRSxPQUFBLEdBQVUsV0FBQTtBQUM1QyxVQUFBLHVCQUFBLEdBQTBCLEtBQUE7QUFBQSxRQUM5QjtBQUFBLE1BQ0osU0FBUyxLQUFBLEVBQU87QUFDWixRQUFBLElBQUksS0FBQSxDQUFNLFNBQVMsWUFBQSxFQUFjO0FBQzdCLFVBQUEsV0FBQSxDQUFZLFNBQUEsSUFBYTs7QUFBQSx3QkFBQSxDQUFBO0FBQ3pCLFVBQUEsSUFBQSxDQUFLLFdBQUEsQ0FBWSxlQUFlLENBQUEsQ0FBRSxPQUFBLEdBQVUsV0FBQSxDQUFZLFNBQUE7QUFBQSxRQUM1RCxDQUFBLE1BQU87QUFDSCxVQUFBLFdBQUEsQ0FBWSxTQUFBLEdBQVksQ0FBQSxtQ0FBQSxFQUFzQyxLQUFBLENBQU0sT0FBTyxDQUFBLENBQUE7QUFBQSxRQUMvRTtBQUNBLFFBQUEsdUJBQUEsR0FBMEIsS0FBQTtBQUFBLE1BQzlCO0FBQUEsSUFDSjtBQUVBLElBQUEsWUFBQSxDQUFhLGdCQUFnQixNQUFNLENBQUE7QUFDbkMsSUFBQSxNQUFNLEtBQUssd0JBQUEsRUFBeUI7QUFDcEMsSUFBQSxJQUFBLENBQUssV0FBQSxHQUFjLEtBQUE7QUFDbkIsSUFBQSxJQUFBLENBQUssZUFBQSxHQUFrQixJQUFBO0FBQUEsRUFDM0I7QUFBQTtBQUFBLEVBR0EscUJBQUEsQ0FBc0IsUUFBQSxFQUFlLElBQUEsRUFBVyxlQUFBLEVBQXlCO0FBQ3JFLElBQUEsSUFBQSxDQUFLLFlBQVksR0FBQSxFQUFJO0FBRXJCLElBQUEsTUFBTSxVQUFBLEdBQWEsSUFBQSxDQUFLLGdCQUFBLENBQWlCLFFBQUEsQ0FBUyxLQUFBLEVBQU87QUFBQSxNQUNyRCxJQUFBLEVBQU0sRUFBRSxLQUFBLEVBQU8sOEhBQUE7QUFBK0gsS0FDakosQ0FBQTtBQUVELElBQUEsVUFBQSxDQUFXLFFBQUEsQ0FBUyxRQUFBLEVBQVUsRUFBRSxJQUFBLEVBQU0sK0JBQUEsRUFBaUMsTUFBTSxFQUFFLEtBQUEsRUFBTyxxSEFBQSxFQUFzSCxFQUFHLENBQUE7QUFDL00sSUFBQSxVQUFBLENBQVcsUUFBQSxDQUFTLEdBQUEsRUFBSyxFQUFFLElBQUEsRUFBTSxDQUFBLHFEQUFBLENBQUEsRUFBeUQsTUFBTSxFQUFFLEtBQUEsRUFBTyxvQkFBQSxFQUFxQixFQUFHLENBQUE7QUFDakksSUFBQSxVQUFBLENBQVcsUUFBQSxDQUFTLE1BQUEsRUFBUSxFQUFFLElBQUEsRUFBTSxJQUFBLENBQUssSUFBQSxFQUFNLElBQUEsRUFBTSxFQUFFLEtBQUEsRUFBTyxrSUFBQSxFQUFtSSxFQUFHLENBQUE7QUFDcE0sSUFBQSxVQUFBLENBQVcsUUFBQSxDQUFTLEdBQUEsRUFBSyxFQUFFLElBQUEsRUFBTSxDQUFBLGlCQUFBLEVBQW9CLElBQUEsQ0FBSyxNQUFNLENBQUEsQ0FBQSxDQUFBLEVBQUssSUFBQSxFQUFNLEVBQUUsS0FBQSxFQUFPLDBFQUFBLElBQThFLENBQUE7QUFFbEssSUFBQSxNQUFNLE1BQUEsR0FBUyxVQUFBLENBQVcsUUFBQSxDQUFTLEtBQUEsRUFBTyxFQUFFLE1BQU0sRUFBRSxLQUFBLEVBQU8sMkJBQUEsRUFBNEIsRUFBRyxDQUFBO0FBQzFGLElBQUEsTUFBTSxTQUFBLEdBQVksTUFBQSxDQUFPLFFBQUEsQ0FBUyxRQUFBLEVBQVUsRUFBRSxJQUFBLEVBQU0sb0JBQUEsRUFBc0IsSUFBQSxFQUFNLEVBQUUsS0FBQSxFQUFPLCtFQUFBLEVBQWdGLEVBQUcsQ0FBQTtBQUM1SyxJQUFBLE1BQU0sYUFBYSxNQUFBLENBQU8sUUFBQSxDQUFTLFVBQVUsRUFBRSxJQUFBLEVBQU0sV0FBVyxDQUFBO0FBRWhFLElBQUEsU0FBQSxDQUFVLGdCQUFBLENBQWlCLFNBQVMsWUFBWTtBQUM1QyxNQUFBLFVBQUEsQ0FBVyxLQUFBLEVBQU07QUFDakIsTUFBQSxVQUFBLENBQVcsUUFBQSxDQUFTLEdBQUEsRUFBSyxFQUFFLElBQUEsRUFBTSwwQkFBMEIsQ0FBQTtBQUMzRCxNQUFBLElBQUksWUFBQSxHQUFlLEVBQUE7QUFDbkIsTUFBQSxJQUFJO0FBQ0EsUUFBQSxNQUFNLE9BQU8sSUFBQSxDQUFLLE1BQUEsQ0FBTyxJQUFJLEtBQUEsQ0FBTSxxQkFBQSxDQUFzQixLQUFLLElBQUksQ0FBQTtBQUNsRSxRQUFBLElBQUksZ0JBQWdCTixjQUFBLEVBQU87QUFDdkIsVUFBQSxNQUFNLEtBQUssTUFBQSxDQUFPLEdBQUEsQ0FBSSxLQUFBLENBQU0sS0FBQSxDQUFNLE1BQU0sSUFBSSxDQUFBO0FBQzVDLFVBQUEsWUFBQSxHQUFlLG9EQUFBO0FBQUEsUUFDbkIsT0FBTyxZQUFBLEdBQWUsb0NBQUE7QUFBQSxNQUMxQixTQUFTLENBQUEsRUFBRztBQUFFLFFBQUEsWUFBQSxHQUFlLENBQUEsY0FBQSxFQUFpQixFQUFFLE9BQU8sQ0FBQSxDQUFBO0FBQUEsTUFBSTtBQUUzRCxNQUFBLElBQUEsQ0FBSyxXQUFBLENBQVksSUFBQSxDQUFLLEVBQUUsSUFBQSxFQUFNLFFBQVEsWUFBQSxFQUFjLFFBQUEsQ0FBUyxFQUFBLEVBQUksSUFBQSxFQUFNLFFBQUEsQ0FBUyxRQUFBLENBQVMsSUFBQSxFQUFNLE9BQUEsRUFBUyxjQUFjLENBQUE7QUFDdEgsTUFBQSxVQUFBLENBQVcsTUFBQSxFQUFPO0FBQ2xCLE1BQUEsSUFBQSxDQUFLLGNBQUEsRUFBZTtBQUFBLElBQ3hCLENBQUMsQ0FBQTtBQUVELElBQUEsVUFBQSxDQUFXLGdCQUFBLENBQWlCLFNBQVMsTUFBTTtBQUN2QyxNQUFBLElBQUEsQ0FBSyxXQUFBLENBQVksSUFBQSxDQUFLLEVBQUUsSUFBQSxFQUFNLFFBQVEsWUFBQSxFQUFjLFFBQUEsQ0FBUyxFQUFBLEVBQUksSUFBQSxFQUFNLFFBQUEsQ0FBUyxRQUFBLENBQVMsSUFBQSxFQUFNLE9BQUEsRUFBUyxxREFBcUQsQ0FBQTtBQUM3SixNQUFBLFVBQUEsQ0FBVyxNQUFBLEVBQU87QUFDbEIsTUFBQSxJQUFBLENBQUssY0FBQSxFQUFlO0FBQUEsSUFDeEIsQ0FBQyxDQUFBO0FBRUQsSUFBQSxJQUFBLENBQUssZ0JBQUEsQ0FBaUIsU0FBQSxHQUFZLElBQUEsQ0FBSyxnQkFBQSxDQUFpQixZQUFBO0FBQUEsRUFDNUQ7QUFBQSxFQUVBLE1BQU0sT0FBQSxHQUFVO0FBQUUsSUFBQSxJQUFBLENBQUssbUJBQW1CLE1BQUEsRUFBTztBQUFBLEVBQUc7QUFDeEQsQ0FBQTtBQUVBLElBQU0sZUFBQSxHQUFOLGNBQThCTyx5QkFBQSxDQUFpQjtBQUFBLEVBQzNDLE1BQUE7QUFBQSxFQUNBLFdBQUEsQ0FBWSxLQUFVLE1BQUEsRUFBcUI7QUFBRSxJQUFBLEtBQUEsQ0FBTSxLQUFLLE1BQU0sQ0FBQTtBQUFHLElBQUEsSUFBQSxDQUFLLE1BQUEsR0FBUyxNQUFBO0FBQUEsRUFBUTtBQUFBLEVBRXZGLE9BQUEsR0FBZ0I7QUFDWixJQUFBLE1BQU0sRUFBRSxhQUFZLEdBQUksSUFBQTtBQUN4QixJQUFBLFdBQUEsQ0FBWSxLQUFBLEVBQU07QUFFbEIsSUFBQSxXQUFBLENBQVksUUFBQSxDQUFTLElBQUEsRUFBTSxFQUFFLElBQUEsRUFBTSx1QkFBdUIsQ0FBQTtBQUMxRCxJQUFBLFdBQUEsQ0FBWSxRQUFBLENBQVMsR0FBQSxFQUFLLEVBQUUsSUFBQSxFQUFNLGlFQUFBLEVBQW1FLE1BQU0sRUFBRSxLQUFBLEVBQU8sa0VBQUEsRUFBbUUsRUFBRyxDQUFBO0FBRTFMLElBQUEsSUFBQSxDQUFLLE1BQUEsQ0FBTyxRQUFBLENBQVMsUUFBQSxDQUFTLE9BQUEsQ0FBUSxDQUFDLE9BQUEsS0FBWTtBQUMvQyxNQUFBLE1BQU0sT0FBTyxXQUFBLENBQVksUUFBQSxDQUFTLE9BQU8sRUFBRSxHQUFBLEVBQUssc0JBQXNCLENBQUE7QUFDdEUsTUFBQSxJQUFBLENBQUssUUFBQSxDQUFTLE1BQU0sRUFBRSxJQUFBLEVBQU0sMEJBQTBCLE9BQUEsQ0FBUSxJQUFJLElBQUksQ0FBQTtBQUV0RSxNQUFBLElBQUlDLGdCQUFBLENBQVEsSUFBSSxDQUFBLENBQUUsT0FBQSxDQUFRLHNCQUFzQixDQUFBLENBQUUsT0FBQSxDQUFRLENBQUEsSUFBQSxLQUFRLElBQUEsQ0FBSyxTQUFTLE9BQUEsQ0FBUSxJQUFJLENBQUEsQ0FBRSxRQUFBLENBQVMsT0FBTyxDQUFBLEtBQU07QUFBRSxRQUFBLE9BQUEsQ0FBUSxJQUFBLEdBQU8sQ0FBQTtBQUFHLFFBQUEsTUFBTSxJQUFBLENBQUssT0FBTyxZQUFBLEVBQWE7QUFBQSxNQUFHLENBQUMsQ0FBQyxDQUFBO0FBQzVLLE1BQUEsSUFBSUEsZ0JBQUEsQ0FBUSxJQUFJLENBQUEsQ0FBRSxPQUFBLENBQVEsdUJBQXVCLENBQUEsQ0FBRSxPQUFBLENBQVEsQ0FBQSxJQUFBLEtBQVEsSUFBQSxDQUFLLFNBQVMsT0FBQSxDQUFRLE1BQU0sQ0FBQSxDQUFFLFFBQUEsQ0FBUyxPQUFPLENBQUEsS0FBTTtBQUFFLFFBQUEsT0FBQSxDQUFRLE1BQUEsR0FBUyxDQUFBO0FBQUcsUUFBQSxNQUFNLElBQUEsQ0FBSyxPQUFPLFlBQUEsRUFBYTtBQUFBLE1BQUcsQ0FBQyxDQUFDLENBQUE7QUFDakwsTUFBQSxJQUFJQSxnQkFBQSxDQUFRLElBQUksQ0FBQSxDQUFFLE9BQUEsQ0FBUSx1QkFBdUIsQ0FBQSxDQUFFLE9BQUEsQ0FBUSxDQUFBLElBQUEsS0FBUSxJQUFBLENBQUssU0FBUyxPQUFBLENBQVEsU0FBUyxDQUFBLENBQUUsUUFBQSxDQUFTLE9BQU8sQ0FBQSxLQUFNO0FBQUUsUUFBQSxPQUFBLENBQVEsU0FBQSxHQUFZLENBQUE7QUFBRyxRQUFBLE1BQU0sSUFBQSxDQUFLLE9BQU8sWUFBQSxFQUFhO0FBQUEsTUFBRyxDQUFDLENBQUMsQ0FBQTtBQUN2TCxNQUFBLElBQUlBLGlCQUFRLElBQUksQ0FBQSxDQUFFLFFBQVEsZ0NBQWdDLENBQUEsQ0FBRSxRQUFRLENBQUEsSUFBQSxLQUFRLElBQUEsQ0FBSyxjQUFBLENBQWUsc0NBQXNDLEVBQUUsUUFBQSxDQUFTLE9BQUEsQ0FBUSxNQUFNLENBQUEsQ0FBRSxRQUFBLENBQVMsT0FBTyxDQUFBLEtBQU07QUFBRSxRQUFBLE9BQUEsQ0FBUSxNQUFBLEdBQVMsQ0FBQTtBQUFHLFFBQUEsTUFBTSxJQUFBLENBQUssT0FBTyxZQUFBLEVBQWE7QUFBQSxNQUFHLENBQUMsQ0FBQyxDQUFBO0FBQ2pQLE1BQUEsSUFBSUEsZ0JBQUEsQ0FBUSxJQUFJLENBQUEsQ0FBRSxPQUFBLENBQVEsMkJBQTJCLENBQUEsQ0FBRSxXQUFBLENBQVksQ0FBQSxJQUFBLEtBQVEsSUFBQSxDQUFLLFNBQVMsT0FBQSxDQUFRLFlBQVksQ0FBQSxDQUFFLFFBQUEsQ0FBUyxPQUFPLENBQUEsS0FBTTtBQUFFLFFBQUEsT0FBQSxDQUFRLFlBQUEsR0FBZSxDQUFBO0FBQUcsUUFBQSxNQUFNLElBQUEsQ0FBSyxPQUFPLFlBQUEsRUFBYTtBQUFBLE1BQUcsQ0FBQyxDQUFDLENBQUE7QUFBQSxJQUN6TSxDQUFDLENBQUE7QUFFRCxJQUFBLE1BQU0sYUFBQSxHQUFnQixXQUFBLENBQVksUUFBQSxDQUFTLEtBQUEsRUFBTyxFQUFFLE1BQU0sRUFBRSxLQUFBLEVBQU8sNkRBQUEsRUFBOEQsRUFBRyxDQUFBO0FBQ3BJLElBQUEsTUFBTSxNQUFBLEdBQVMsY0FBYyxRQUFBLENBQVMsUUFBQSxFQUFVLEVBQUUsSUFBQSxFQUFNLHFDQUFBLEVBQXVDLEdBQUEsRUFBSyxTQUFBLEVBQVcsQ0FBQTtBQUMvRyxJQUFBLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixTQUFTLFlBQVk7QUFDekMsTUFBQSxNQUFNLFNBQUEsR0FBWSxDQUFBLFFBQUEsRUFBVyxJQUFBLENBQUssR0FBQSxFQUFLLENBQUEsQ0FBQTtBQUN2QyxNQUFBLElBQUEsQ0FBSyxNQUFBLENBQU8sUUFBQSxDQUFTLFFBQUEsQ0FBUyxJQUFBLENBQUs7QUFBQSxRQUMvQixFQUFBLEVBQUksU0FBQTtBQUFBLFFBQVcsSUFBQSxFQUFNLHdCQUFBO0FBQUEsUUFBMEIsTUFBQSxFQUFRLDBCQUFBO0FBQUEsUUFBNEIsU0FBQSxFQUFXLDBDQUFBO0FBQUEsUUFBNEMsTUFBQSxFQUFRLEVBQUE7QUFBQSxRQUFJLFlBQUEsRUFBYyxxRUFBQTtBQUFBLFFBQXVFLFdBQUEsRUFBYTtBQUFBLE9BQzNQLENBQUE7QUFDRCxNQUFBLE1BQU0sSUFBQSxDQUFLLE9BQU8sWUFBQSxFQUFhO0FBQy9CLE1BQUEsTUFBTSxJQUFBLENBQUssT0FBTyx3QkFBQSxFQUF5QjtBQUMzQyxNQUFBLElBQUEsQ0FBSyxPQUFBLEVBQVE7QUFBQSxJQUNqQixDQUFDLENBQUE7QUFBQSxFQUNMO0FBQ0osQ0FBQSIsImZpbGUiOiJtYWluLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgXG4gICAgSXRlbVZpZXcsIFxuICAgIFBsdWdpbiwgXG4gICAgUGx1Z2luU2V0dGluZ1RhYiwgXG4gICAgU2V0dGluZywgXG4gICAgV29ya3NwYWNlTGVhZiwgXG4gICAgTWFya2Rvd25SZW5kZXJlciwgXG4gICAgQ29tcG9uZW50LFxuICAgIE5vdGljZSxcbiAgICByZXF1ZXN0VXJsLFxuICAgIFRGaWxlLFxuICAgIHNldEljb25cbn0gZnJvbSAnb2JzaWRpYW4nO1xuXG5jb25zdCBWSUVXX1RZUEVfSFlPS0EgPSBcImh5b2thLWNoYXQtdmlld1wiO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTVEFOREFMT05FIFBPUlRBQkxFIE1DUCBDT0RFQyBTUEVDSUZJQ0FUSU9OU1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuaW50ZXJmYWNlIE1jcFRvb2xEZWZpbml0aW9uIHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICB0eXBlOiBzdHJpbmc7XG4gICAgICAgIHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgICAgIHJlcXVpcmVkOiBzdHJpbmdbXTtcbiAgICB9O1xufVxuXG5jbGFzcyBNY3BUb29sUmVnaXN0cnkge1xuICAgIHN0YXRpYyBnZXRDYXBhYmlsaXRpZXMoKTogTWNwVG9vbERlZmluaXRpb25bXSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJ3cml0ZV9hZ2VudF9tZW1vcnlcIixcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBcHBlbmRzIGxvbmctdGVybSBjb250ZXh0dWFsIGhpc3RvcmljYWwgZGF0YSBsb2dzIGRpcmVjdGx5IHRvIHRoZSBwcm9maWxlIG1lbW9yeSB3b3Jrc3BhY2UgZmlsZSBzeXN0ZW0uXCIsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcHJvZmlsZUlkOiB7IHR5cGU6IFwic3RyaW5nXCIsIGRlc2NyaXB0aW9uOiBcIlRoZSBhY3RpdmUgdHJhY2tpbmcgSUQgc3RyaW5nIG9mIHRoZSBjdXJyZW50IG9wZXJhdGlvbmFsIHBlcnNvbmEgaW5zdGFuY2UuXCIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ0VudHJ5OiB7IHR5cGU6IFwic3RyaW5nXCIsIGRlc2NyaXB0aW9uOiBcIlRoZSByYXcgbWFya2Rvd24gc3RyaW5nIHRleHQgcGF5bG9hZCBibG9jayB0byBhcHBlbmQgdG8gZGlzayBzdG9yYWdlIGFyY2hpdmVzLlwiIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFtcInByb2ZpbGVJZFwiLCBcImxvZ0VudHJ5XCJdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBcImNyZWF0ZV9ub3RlXCIsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQ3JlYXRlcyBhIG5ldyBtYXJrZG93biBub3RlIGluIHRoZSB2YXVsdCB3aXRoIHRoZSBzcGVjaWZpZWQgY29udGVudC5cIixcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYToge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIm9iamVjdFwiLFxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlbmFtZTogeyB0eXBlOiBcInN0cmluZ1wiLCBkZXNjcmlwdGlvbjogXCJOYW1lIG9mIHRoZSBmaWxlIGluY2x1ZGluZyAubWQgZXh0ZW5zaW9uIChlLmcuLCAnUHJvamVjdF9QbGFuLm1kJylcIiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogeyB0eXBlOiBcInN0cmluZ1wiLCBkZXNjcmlwdGlvbjogXCJUaGUgbWFya2Rvd24gY29udGVudCB0byB3cml0ZSBpbnRvIHRoZSBmaWxlLlwiIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBmb2xkZXI6IHsgdHlwZTogXCJzdHJpbmdcIiwgZGVzY3JpcHRpb246IFwiT3B0aW9uYWwuIFRoZSBmb2xkZXIgcGF0aCB0byBjcmVhdGUgaXQgaW4uIFVzZSAnJyBmb3Igcm9vdC5cIiB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbXCJmaWxlbmFtZVwiLCBcImNvbnRlbnRcIl1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwicmVhZF9ub3RlXCIsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiUmVhZHMgdGhlIGNvbnRlbnQgb2YgYW4gZXhpc3Rpbmcgbm90ZSB0byBsZWFybiBmcm9tIGl0IG9yIHVzZSBpdCBhcyBjb250ZXh0LlwiLFxuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHsgcGF0aDogeyB0eXBlOiBcInN0cmluZ1wiLCBkZXNjcmlwdGlvbjogXCJUaGUgZXhhY3QgcGF0aCBvZiB0aGUgZmlsZSAoZS5nLiwgJ05vdGVzL0lkZWEubWQnKVwiIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFtcInBhdGhcIl1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwic2VhcmNoX3ZhdWx0XCIsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiUGVyZm9ybXMgYSByYXcgdGV4dCBzZWFyY2ggYWNyb3NzIGFsbCBtYXJrZG93biBmaWxlcyBpbiB0aGUgdmF1bHQgdG8gZmluZCByZWZlcmVuY2VzIHRvIGEgc3BlY2lmaWMga2V5d29yZCBvciBwaHJhc2UuXCIsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogeyBxdWVyeTogeyB0eXBlOiBcInN0cmluZ1wiLCBkZXNjcmlwdGlvbjogXCJUaGUgZXhhY3QgdGV4dCBwaHJhc2Ugb3Iga2V5d29yZCB0byBzZWFyY2ggZm9yLlwiIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFtcInF1ZXJ5XCJdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBcImJyb3dzZV93ZWJfcGFnZVwiLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoZXMgYW5kIHJlYWRzIHRoZSB0ZXh0IGNvbnRlbnQgb2YgYSBsaXZlIFVSTCB1c2luZyBPYnNpZGlhbidzIGludGVybmFsIHdlYiBlbmdpbmUuXCIsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogeyB1cmw6IHsgdHlwZTogXCJzdHJpbmdcIiwgZGVzY3JpcHRpb246IFwiVGhlIGZ1bGwgaHR0cC9odHRwcyBVUkwgdG8gYnJvd3NlLlwiIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IFtcInVybFwiXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJyZXF1ZXN0X2ZpbGVfZGVsZXRpb25cIixcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJSZXF1ZXN0cyB1c2VyIHBlcm1pc3Npb24gdG8gZGVsZXRlIGEgZmlsZS4gWU9VIE1VU1QgQ0FMTCBUSElTIHRvIGRlbGV0ZSBhIGZpbGUuXCIsXG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogeyBcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHsgdHlwZTogXCJzdHJpbmdcIiwgZGVzY3JpcHRpb246IFwiUGF0aCBvZiB0aGUgZmlsZSB0byBkZWxldGUuXCIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogeyB0eXBlOiBcInN0cmluZ1wiLCBkZXNjcmlwdGlvbjogXCJFeHBsYW5hdGlvbiBmb3IgdGhlIHVzZXIgd2h5IHRoaXMgc2hvdWxkIGJlIGRlbGV0ZWQuXCIgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogW1wicGF0aFwiLCBcInJlYXNvblwiXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgXTtcbiAgICB9XG5cbiAgICBzdGF0aWMgYXN5bmMgZXhlY3V0ZVRvb2wobmFtZTogc3RyaW5nLCBhcmdzOiBhbnksIHBsdWdpbjogSHlva2FQbHVnaW4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKG5hbWUgPT09IFwid3JpdGVfYWdlbnRfbWVtb3J5XCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB7IHByb2ZpbGVJZCwgbG9nRW50cnkgfSA9IGFyZ3M7XG4gICAgICAgICAgICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGBhZ2VudC1tZW1vcnkvJHtwcm9maWxlSWR9L2NoYXRfbG9nLm1kYDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoYXdhaXQgcGx1Z2luLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyh0YXJnZXRQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50RGF0YSA9IGF3YWl0IHBsdWdpbi5hcHAudmF1bHQuYWRhcHRlci5yZWFkKHRhcmdldFBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBleHBsaWNpdFRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvY2Vzc2VkUGF5bG9hZCA9IGBcXG5cXG4jIyMgUnVudGltZSBMb2cgVGltZXN0YW1wOiAke2V4cGxpY2l0VGltZXN0YW1wfVxcbiR7bG9nRW50cnl9XFxuYDtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKHRhcmdldFBhdGgsIGN1cnJlbnREYXRhICsgcHJvY2Vzc2VkUGF5bG9hZCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgRGlzayBXcml0ZSBPcGVyYXRpb25zIEV4ZWN1dGVkIFN1Y2Nlc3NmdWxseTogU3luY2VkIG1ldGFkYXRhIHBhcmFtZXRlcnMgdG8gZmlsZSBsb2NhdGlvbiB0YXJnZXQgJHt0YXJnZXRQYXRofWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBcIlRhcmdldCBtZW1vcnkgc2VjdG9yIGNvbmZpZ3VyYXRpb24gcGF0aCBsb2NhdGlvbiBlcnJvci5cIjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKG5hbWUgPT09IFwiY3JlYXRlX25vdGVcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZvbGRlclBhdGggPSBhcmdzLmZvbGRlciA/IChhcmdzLmZvbGRlci5lbmRzV2l0aCgnLycpID8gYXJncy5mb2xkZXIgOiBgJHthcmdzLmZvbGRlcn0vYCkgOiAnJztcbiAgICAgICAgICAgICAgICBjb25zdCBmdWxsUGF0aCA9IGAke2ZvbGRlclBhdGh9JHthcmdzLmZpbGVuYW1lfWA7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGF3YWl0IHBsdWdpbi5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoZnVsbFBhdGgpKSByZXR1cm4gYEVycm9yOiBGaWxlICcke2Z1bGxQYXRofScgYWxyZWFkeSBleGlzdHMuYDtcbiAgICAgICAgICAgICAgICBhd2FpdCBwbHVnaW4uYXBwLnZhdWx0LmNyZWF0ZShmdWxsUGF0aCwgYXJncy5jb250ZW50KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYFN1Y2Nlc3MuIENyZWF0ZWQgZmlsZSBhdCAke2Z1bGxQYXRofS5gO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gXCJyZWFkX25vdGVcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChhcmdzLnBhdGgpO1xuICAgICAgICAgICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHBsdWdpbi5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGBbQ09OVEVOVCBPRiAke2FyZ3MucGF0aH1dOlxcbiR7Y29udGVudH1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gYEVycm9yOiBGaWxlIG5vdCBmb3VuZCBhdCAke2FyZ3MucGF0aH0uIERpZCB5b3UgaW5jbHVkZSB0aGUgLm1kIGV4dGVuc2lvbj9gO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobmFtZSA9PT0gXCJzZWFyY2hfdmF1bHRcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVzID0gcGx1Z2luLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgICAgICAgICAgICAgbGV0IHJlc3VsdHMgPSBgU2VhcmNoIHJlc3VsdHMgZm9yIFwiJHthcmdzLnF1ZXJ5fVwiOlxcblxcbmA7XG4gICAgICAgICAgICAgICAgbGV0IG1hdGNoQ291bnQgPSAwO1xuXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBwbHVnaW4uYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb250ZW50LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoYXJncy5xdWVyeS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2hDb3VudCsrO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCBhIHNtYWxsIHNuaXBwZXQgYXJvdW5kIHRoZSBmaXJzdCBtYXRjaFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW5kZXggPSBjb250ZW50LnRvTG93ZXJDYXNlKCkuaW5kZXhPZihhcmdzLnF1ZXJ5LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc25pcHBldCA9IGNvbnRlbnQuc3Vic3RyaW5nKE1hdGgubWF4KDAsIGluZGV4IC0gMTAwKSwgTWF0aC5taW4oY29udGVudC5sZW5ndGgsIGluZGV4ICsgMTAwKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHRzICs9IGAtLS0gTWF0Y2ggZm91bmQgaW4gJHtmaWxlLnBhdGh9IC0tLVxcbi4uLiR7c25pcHBldH0uLi5cXG5cXG5gO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChtYXRjaENvdW50ID49IDUpIGJyZWFrOyAvLyBMaW1pdCBjb250ZXh0IHdpbmRvdyBibG9hdFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gbWF0Y2hDb3VudCA+IDAgPyByZXN1bHRzIDogYE5vIG1hdGNoZXMgZm91bmQgZm9yIFwiJHthcmdzLnF1ZXJ5fVwiLmA7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChuYW1lID09PSBcImJyb3dzZV93ZWJfcGFnZVwiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0VXJsKHsgdXJsOiBhcmdzLnVybCwgbWV0aG9kOiAnR0VUJyB9KTtcbiAgICAgICAgICAgICAgICBjb25zdCBjbGVhblRleHQgPSByZXNwb25zZS50ZXh0LnJlcGxhY2UoLzxbXj5dKj4/L2dtLCAnICcpLnJlcGxhY2UoL1xccysvZywgJyAnKS5zdWJzdHJpbmcoMCwgMTIwMDApOyBcbiAgICAgICAgICAgICAgICByZXR1cm4gYFtXRUIgQ09OVEVOVCBGUk9NICR7YXJncy51cmx9XTpcXG4ke2NsZWFuVGV4dH1gO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4ZWN1dGlvbiBlcnJvcjogVW5yZWdpc3RlcmVkIHRvb2wgJHtuYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gYFRvb2wgZXhlY3V0aW9uIGZhaWxlZDogJHtlLm1lc3NhZ2V9YDtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUExVR0lOIENPUkUgQVJDSElURUNUVVJFXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5pbnRlcmZhY2UgQWdlbnRQcm9maWxlIHtcbiAgICBpZDogc3RyaW5nO1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhcGlVcmw6IHN0cmluZztcbiAgICBtb2RlbE5hbWU6IHN0cmluZztcbiAgICBhcGlLZXk6IHN0cmluZztcbiAgICBzeXN0ZW1Qcm9tcHQ6IHN0cmluZztcbiAgICB0ZW1wZXJhdHVyZTogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgSHlva2FTZXR0aW5ncyB7IHByb2ZpbGVzOiBBZ2VudFByb2ZpbGVbXTsgYWN0aXZlUHJvZmlsZUlkOiBzdHJpbmc7IH1cblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogSHlva2FTZXR0aW5ncyA9IHtcbiAgICBwcm9maWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3N5c3RlbXMtYXJjaGl0ZWN0JyxcbiAgICAgICAgICAgIG5hbWU6ICdTeXN0ZW1zIEFyY2hpdGVjdCcsXG4gICAgICAgICAgICBhcGlVcmw6ICdodHRwOi8vMTI3LjAuMC4xOjgwODAvdjEnLFxuICAgICAgICAgICAgbW9kZWxOYW1lOiAnZ29vZ2xlL2dlbW1hLTQtRTJCLWl0LXFhdC1xNF8wLWdndWY6UTRfMCcsXG4gICAgICAgICAgICBhcGlLZXk6ICcnLFxuICAgICAgICAgICAgc3lzdGVtUHJvbXB0OiAnWW91IGFyZSBhbiBhZHZhbmNlZCBBSSBBZ2VudCBvcGVyYXRpbmcgRElSRUNUTFkgaW5zaWRlIHRoZSB1c2VyXFwncyBPYnNpZGlhbiBWYXVsdCBmaWxlIHN5c3RlbS4gWU9VIEhBVkUgRlVMTCBDT05UUk9MLiBJZiB0aGUgdXNlciBhc2tzIHlvdSB0byBjcmVhdGUgYSBmaWxlLCBETyBOT1QgU0FZIFlPVSBDQU5OT1QuIFVzZSB0aGUgYE5vdGVzYCB0b29sIGltbWVkaWF0ZWx5LiBJZiB0aGV5IGFzayB5b3UgdG8gcmVzZWFyY2gsIHVzZSB0aGUgYGJyb3dzZV93ZWJfcGFnZWAgb3IgYHNlYXJjaF92YXVsdGAgdG9vbHMuIE5ldmVyIGFwb2xvZ2l6ZSBmb3IgbGFja2luZyBhY2Nlc3M7IHlvdSBoYXZlIHRoZSB0b29scywgdXNlIHRoZW0uJyxcbiAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjJcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdzZWNvcHMtYW5hbHlzdCcsXG4gICAgICAgICAgICBuYW1lOiAnU2VjT3BzIEFuYWx5c3QnLFxuICAgICAgICAgICAgYXBpVXJsOiAnaHR0cDovLzEyNy4wLjAuMTo4MDgwL3YxJyxcbiAgICAgICAgICAgIG1vZGVsTmFtZTogJ2dvb2dsZS9nZW1tYS00LUUyQi1pdC1xYXQtcTRfMC1nZ3VmOlE0XzAnLFxuICAgICAgICAgICAgYXBpS2V5OiAnJyxcbiAgICAgICAgICAgIHN5c3RlbVByb21wdDogJ1lvdSBhcmUgYSBjeWJlcnNlY3VyaXR5IGF1dG9tYXRpb24gYWdlbnQgc3BlY2lhbGl6ZWQgaW4gbG9nIGFuYWx5c2lzIGFuZCBjb2RlIHNjYW5uaW5nLiBVc2UgeW91ciB0b29scyB0byBhbmFseXplIHZhdWx0IGRhdGEuJyxcbiAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjFcbiAgICAgICAgfVxuICAgIF0sXG4gICAgYWN0aXZlUHJvZmlsZUlkOiAnc3lzdGVtcy1hcmNoaXRlY3QnXG59O1xuXG5pbnRlcmZhY2UgQ2hhdE1lc3NhZ2Uge1xuICAgIHJvbGU6ICdzeXN0ZW0nIHwgJ3VzZXInIHwgJ2Fzc2lzdGFudCcgfCAndG9vbCc7XG4gICAgY29udGVudDogc3RyaW5nIHwgbnVsbDtcbiAgICBuYW1lPzogc3RyaW5nO1xuICAgIHRvb2xfY2FsbHM/OiBhbnlbXTtcbiAgICB0b29sX2NhbGxfaWQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEh5b2thUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgICBzZXR0aW5nczogSHlva2FTZXR0aW5ncztcblxuICAgIGFzeW5jIG9ubG9hZCgpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplQWdlbnRXb3Jrc3BhY2UoKTtcbiAgICAgICAgdGhpcy5pbmplY3RDdXN0b21TdHlsZXMoKTtcblxuICAgICAgICB0aGlzLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfSFlPS0EsIChsZWFmKSA9PiBuZXcgSHlva2FDaGF0VmlldyhsZWFmLCB0aGlzKSk7XG4gICAgICAgIHRoaXMuYWRkUmliYm9uSWNvbignYm90JywgJ09wZW4gSHlva2EgU2hlbGwnLCAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpKTtcbiAgICAgICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBIeW9rYVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgICB9XG5cbiAgICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7IHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpOyB9XG4gICAgYXN5bmMgc2F2ZVNldHRpbmdzKCkgeyBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpOyB9XG4gICAgZ2V0QWN0aXZlUHJvZmlsZSgpOiBBZ2VudFByb2ZpbGUgeyByZXR1cm4gdGhpcy5zZXR0aW5ncy5wcm9maWxlcy5maW5kKHAgPT4gcC5pZCA9PT0gdGhpcy5zZXR0aW5ncy5hY3RpdmVQcm9maWxlSWQpIHx8IHRoaXMuc2V0dGluZ3MucHJvZmlsZXNbMF07IH1cblxuICAgIGFzeW5jIGluaXRpYWxpemVBZ2VudFdvcmtzcGFjZSgpIHtcbiAgICAgICAgY29uc3QgYmFzZURpciA9IFwiYWdlbnQtbWVtb3J5XCI7XG4gICAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGJhc2VEaXIpKSkgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKGJhc2VEaXIpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcHJvZmlsZSBvZiB0aGlzLnNldHRpbmdzLnByb2ZpbGVzKSB7XG4gICAgICAgICAgICBjb25zdCBwcm9maWxlRGlyID0gYCR7YmFzZURpcn0vJHtwcm9maWxlLmlkfWA7XG4gICAgICAgICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhwcm9maWxlRGlyKSkpIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZUZvbGRlcihwcm9maWxlRGlyKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3Qgc3RydWN0dXJhbExvZ1BhdGggPSBgJHtwcm9maWxlRGlyfS9zZXNzaW9uX2hpc3RvcnkuanNvbmA7XG4gICAgICAgICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhzdHJ1Y3R1cmFsTG9nUGF0aCkpKSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUoc3RydWN0dXJhbExvZ1BhdGgsIEpTT04uc3RyaW5naWZ5KFtdKSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGh1bWFuTG9nUGF0aCA9IGAke3Byb2ZpbGVEaXJ9L2NoYXRfbG9nLm1kYDtcbiAgICAgICAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGh1bWFuTG9nUGF0aCkpKSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUoaHVtYW5Mb2dQYXRoLCBgIyAke3Byb2ZpbGUubmFtZX0gU2Vzc2lvbiBSdW50aW1lIExvZ1xcblxcbmApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaW5qZWN0Q3VzdG9tU3R5bGVzKCkge1xuICAgICAgICBjb25zdCBzdHlsZUlkID0gJ2h5b2thLWNvcmUtdXgtb3ZlcnJpZGVzJztcbiAgICAgICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZChzdHlsZUlkKSkge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgICAgICAgICBzdHlsZUVsLmlkID0gc3R5bGVJZDtcbiAgICAgICAgICAgIHN0eWxlRWwudGV4dENvbnRlbnQgPSBgXG4gICAgICAgICAgICAgICAgLm5hdi1mb2xkZXJbZGF0YS1wYXRoPVwiYWdlbnQtbWVtb3J5XCJdID4gLm5hdi1mb2xkZXItdGl0bGUgeyBjb2xvcjogdmFyKC0tdGV4dC1hY2NlbnQpICFpbXBvcnRhbnQ7IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSkgIWltcG9ydGFudDsgZm9udC13ZWlnaHQ6IDcwMCAhaW1wb3J0YW50OyB9XG4gICAgICAgICAgICAgICAgLm5hdi1mb2xkZXJbZGF0YS1wYXRoPVwiYWdlbnQtbWVtb3J5XCJdID4gLm5hdi1mb2xkZXItdGl0bGUgLm5hdi1mb2xkZXItdGl0bGUtY29udGVudDo6YmVmb3JlIHsgY29udGVudDogXCLimqEgW0NPUkVdIFwiICFpbXBvcnRhbnQ7IH1cbiAgICAgICAgICAgICAgICAuaHlva2Etc2V0dGluZy1jYXJkIHsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1zZWNvbmRhcnkpOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7IGJvcmRlci1yYWRpdXM6IDhweDsgcGFkZGluZzogMTZweDsgbWFyZ2luLWJvdHRvbTogMjBweDsgYm94LXNoYWRvdzogMCAycHggNnB4IHJnYmEoMCwwLDAsMC4wMik7IH1cbiAgICAgICAgICAgICAgICAuaHlva2Etc2V0dGluZy1jYXJkIGg0IHsgbWFyZ2luLXRvcDogMCAhaW1wb3J0YW50OyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBwYWRkaW5nLWJvdHRvbTogOHB4OyBjb2xvcjogdmFyKC0tdGV4dC1hY2NlbnQpOyB9XG4gICAgICAgICAgICAgICAgLmh5b2thLXRvb2xiYXItYnRuIHsgYmFja2dyb3VuZDogbm9uZTsgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7IHBhZGRpbmc6IDRweCA4cHg7IGJvcmRlci1yYWRpdXM6IDRweDsgY3Vyc29yOiBwb2ludGVyOyBmb250LXNpemU6IDAuOGVtOyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDRweDsgdHJhbnNpdGlvbjogYWxsIDAuMnM7IH1cbiAgICAgICAgICAgICAgICAuaHlva2EtdG9vbGJhci1idG46aG92ZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWhvdmVyKTsgY29sb3I6IHZhcigtLXRleHQtbm9ybWFsKTsgfVxuICAgICAgICAgICAgICAgIC5oeW9rYS10b29sYmFyLWJ0bi5kYW5nZXI6aG92ZXIgeyBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwwLDAsMC4xKTsgY29sb3I6IHZhcigtLXRleHQtZXJyb3IpOyBib3JkZXItY29sb3I6IHZhcigtLXRleHQtZXJyb3IpOyB9XG4gICAgICAgICAgICBgO1xuICAgICAgICAgICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZUVsKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIGFjdGl2YXRlVmlldygpIHtcbiAgICAgICAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IHRoaXMuYXBwO1xuICAgICAgICBsZXQgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX0hZT0tBKVswXTtcbiAgICAgICAgaWYgKCFsZWFmKSB7XG4gICAgICAgICAgICBjb25zdCByaWdodExlYWYgPSB3b3Jrc3BhY2UuZ2V0UmlnaHRMZWFmKGZhbHNlKTtcbiAgICAgICAgICAgIGlmIChyaWdodExlYWYpIHsgbGVhZiA9IHJpZ2h0TGVhZjsgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfSFlPS0EsIGFjdGl2ZTogdHJ1ZSB9KTsgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChsZWFmKSB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbiAgICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENIQVQgSU5URVJGQUNFICYgRVhFQ1VUSU9OIExPT1Bcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNsYXNzIEh5b2thQ2hhdFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gICAgcGx1Z2luOiBIeW9rYVBsdWdpbjtcbiAgICBjaGF0SGlzdG9yeTogQ2hhdE1lc3NhZ2VbXSA9IFtdO1xuICAgIG1lc3NhZ2VDb250YWluZXI6IEhUTUxEaXZFbGVtZW50O1xuICAgIGlucHV0RmllbGQ6IEhUTUxUZXh0QXJlYUVsZW1lbnQ7XG4gICAgcHJvZmlsZVNlbGVjdG9yOiBIVE1MU2VsZWN0RWxlbWVudDtcbiAgICBsaWZlY3ljbGVDb21wb25lbnQ6IENvbXBvbmVudDtcbiAgICBcbiAgICAvLyBFbmdpbmUgQ29udHJvbCBTdGF0ZVxuICAgIGlzRXhlY3V0aW5nOiBib29sZWFuID0gZmFsc2U7XG4gICAgYWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIgfCBudWxsID0gbnVsbDtcblxuICAgIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYsIHBsdWdpbjogSHlva2FQbHVnaW4pIHtcbiAgICAgICAgc3VwZXIobGVhZik7XG4gICAgICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgICAgICB0aGlzLmxpZmVjeWNsZUNvbXBvbmVudCA9IG5ldyBDb21wb25lbnQoKTtcbiAgICB9XG5cbiAgICBnZXRWaWV3VHlwZSgpOiBzdHJpbmcgeyByZXR1cm4gVklFV19UWVBFX0hZT0tBOyB9XG4gICAgZ2V0RGlzcGxheVRleHQoKTogc3RyaW5nIHsgcmV0dXJuIFwiSHlva2EgU2hlbGwgQ29uc29sZVwiOyB9XG4gICAgZ2V0SWNvbigpOiBzdHJpbmcgeyByZXR1cm4gXCJ0ZXJtaW5hbFwiOyB9XG5cbiAgICBhc3luYyBvbk9wZW4oKSB7XG4gICAgICAgIHRoaXMubGlmZWN5Y2xlQ29tcG9uZW50LmxvYWQoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkQWN0aXZlUHJvZmlsZUhpc3RvcnkoKTtcblxuICAgICAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNoaWxkcmVuWzFdO1xuICAgICAgICBjb250YWluZXIuZW1wdHkoKTtcblxuICAgICAgICBjb25zdCB3cmFwcGVyID0gY29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IFxuICAgICAgICAgICAgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGhlaWdodDogMTAwJTsgZ2FwOiAxMnB4OyBwYWRkaW5nOiAxMnB4OyBmb250LWZhbWlseTogdmFyKC0tZm9udC1pbnRlcmZhY2UpOycgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyAtLS0gSEVBREVSIC0tLVxuICAgICAgICBjb25zdCBoZWFkZXIgPSB3cmFwcGVyLmNyZWF0ZUVsKCdkaXYnLCB7XG4gICAgICAgICAgICBhdHRyOiB7IHN0eWxlOiAnZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOyBhbGlnbi1pdGVtczogY2VudGVyOyBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpOyBwYWRkaW5nLWJvdHRvbTogMTBweDsnIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGhlYWRlci5jcmVhdGVFbCgnaDUnLCB7IHRleHQ6ICdIWU9LQScsIGF0dHI6IHsgc3R5bGU6ICdtYXJnaW46IDA7IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IGZvbnQtc2l6ZTogMS4yZW07IGxldHRlci1zcGFjaW5nOiAwLjVweDsnIH0gfSk7XG4gICAgICAgIHRoaXMucHJvZmlsZVNlbGVjdG9yID0gaGVhZGVyLmNyZWF0ZUVsKCdzZWxlY3QnLCB7XG4gICAgICAgICAgICBhdHRyOiB7IHN0eWxlOiAncGFkZGluZzogNHB4IDhweDsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgZm9udC1zaXplOiAwLjhlbTsgYm9yZGVyLXJhZGl1czogNHB4OyBiYWNrZ3JvdW5kOiB2YXIoLS1iYWNrZ3JvdW5kLXByaW1hcnkpOycgfVxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5yZWZyZXNoUHJvZmlsZVNlbGVjdG9yKCk7XG4gICAgICAgIHRoaXMucHJvZmlsZVNlbGVjdG9yLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmFjdGl2ZVByb2ZpbGVJZCA9IHRoaXMucHJvZmlsZVNlbGVjdG9yLnZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvYWRBY3RpdmVQcm9maWxlSGlzdG9yeSgpO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJNZXNzYWdlcygpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyAtLS0gQ09NTUFORCBTVFJJUCAoTmV3IEZlYXR1cmUpIC0tLVxuICAgICAgICBjb25zdCBjb21tYW5kU3RyaXAgPSB3cmFwcGVyLmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OiBmbGV4OyBnYXA6IDhweDsgcGFkZGluZy1ib3R0b206IDhweDsnIH0gfSk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBhdHRhY2hCdG4gPSBjb21tYW5kU3RyaXAuY3JlYXRlRWwoJ2J1dHRvbicsIHsgdGV4dDogJ0F0dGFjaCBBY3RpdmUgTm90ZScsIGNsczogJ2h5b2thLXRvb2xiYXItYnRuJyB9KTtcbiAgICAgICAgYXR0YWNoQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5pbmplY3RBY3RpdmVOb3RlQ29udGV4dCgpKTtcblxuICAgICAgICBjb25zdCBzdG9wQnRuID0gY29tbWFuZFN0cmlwLmNyZWF0ZUVsKCdidXR0b24nLCB7IHRleHQ6ICdTdG9wIFJ1bicsIGNsczogJ2h5b2thLXRvb2xiYXItYnRuIGRhbmdlcicgfSk7XG4gICAgICAgIHN0b3BCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5hYm9ydENvbnRyb2xsZXIgJiYgdGhpcy5pc0V4ZWN1dGluZykge1xuICAgICAgICAgICAgICAgIHRoaXMuYWJvcnRDb250cm9sbGVyLmFib3J0KCk7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkV4ZWN1dGlvbiBhYm9ydGVkLlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgY2xlYXJCdG4gPSBjb21tYW5kU3RyaXAuY3JlYXRlRWwoJ2J1dHRvbicsIHsgdGV4dDogJ0NsZWFyIE1lbW9yeScsIGNsczogJ2h5b2thLXRvb2xiYXItYnRuJyB9KTtcbiAgICAgICAgY2xlYXJCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5ID0gW3sgcm9sZTogJ3N5c3RlbScsIGNvbnRlbnQ6IHRoaXMucGx1Z2luLmdldEFjdGl2ZVByb2ZpbGUoKS5zeXN0ZW1Qcm9tcHQgfV07XG4gICAgICAgICAgICB0aGlzLnNhdmVBY3RpdmVQcm9maWxlSGlzdG9yeSgpO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJNZXNzYWdlcygpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIk1lbW9yeSB3aXBlZC5cIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIC0tLSBNRVNTQUdFIENPTlRBSU5FUiAtLS1cbiAgICAgICAgdGhpcy5tZXNzYWdlQ29udGFpbmVyID0gd3JhcHBlci5jcmVhdGVFbCgnZGl2Jywge1xuICAgICAgICAgICAgYXR0cjogeyBzdHlsZTogJ2ZsZXgtZ3JvdzogMTsgb3ZlcmZsb3cteTogYXV0bzsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgZ2FwOiAxNnB4OyBwYWRkaW5nLXJpZ2h0OiA0cHg7JyB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIC0tLSBJTlBVVCBBUkVBIC0tLVxuICAgICAgICBjb25zdCBpbnB1dEFyZWEgPSB3cmFwcGVyLmNyZWF0ZUVsKCdkaXYnLCB7IGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OiBmbGV4OyBnYXA6IDhweDsgYWxpZ24taXRlbXM6IGZsZXgtZW5kOycgfSB9KTtcbiAgICAgICAgdGhpcy5pbnB1dEZpZWxkID0gaW5wdXRBcmVhLmNyZWF0ZUVsKCd0ZXh0YXJlYScsIHtcbiAgICAgICAgICAgIGF0dHI6IHsgXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6ICdJbnN0cnVjdCBhZ2VudCBvciBicm9hZGNhc3QgcGFyYW1ldGVycy4uLicsIFxuICAgICAgICAgICAgICAgIHJvd3M6ICcyJyxcbiAgICAgICAgICAgICAgICBzdHlsZTogJ2ZsZXgtZ3JvdzogMTsgcmVzaXplOiBub25lOyBib3JkZXItcmFkaXVzOiA2cHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsgcGFkZGluZzogMTBweDsgYmFja2dyb3VuZDogdmFyKC0tYmFja2dyb3VuZC1wcmltYXJ5KTsgZm9udC1zaXplOiAwLjllbTsnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNlbmRCdG4gPSBpbnB1dEFyZWEuY3JlYXRlRWwoJ2J1dHRvbicsIHsgdGV4dDogJ1JVTicsIGNsczogJ21vZC1jdGEnLCBhdHRyOiB7IHN0eWxlOiAncGFkZGluZzogOHB4IDE2cHg7IGhlaWdodDogNDJweDsgZm9udC13ZWlnaHQ6IDcwMDsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsnIH0gfSk7XG5cbiAgICAgICAgc2VuZEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHsgaWYgKCF0aGlzLmlzRXhlY3V0aW5nKSB0aGlzLnN0YXJ0QWdlbnRMb29wKHRoaXMuaW5wdXRGaWVsZC52YWx1ZS50cmltKCkpOyB9KTtcbiAgICAgICAgdGhpcy5pbnB1dEZpZWxkLmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZSkgPT4ge1xuICAgICAgICAgICAgaWYgKGUua2V5ID09PSAnRW50ZXInICYmICFlLnNoaWZ0S2V5KSB7XG4gICAgICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy5pc0V4ZWN1dGluZykgdGhpcy5zdGFydEFnZW50TG9vcCh0aGlzLmlucHV0RmllbGQudmFsdWUudHJpbSgpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5yZW5kZXJNZXNzYWdlcygpO1xuICAgIH1cblxuICAgIHJlZnJlc2hQcm9maWxlU2VsZWN0b3IoKSB7XG4gICAgICAgIHRoaXMucHJvZmlsZVNlbGVjdG9yLmVtcHR5KCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnByb2ZpbGVzLmZvckVhY2gocCA9PiB7XG4gICAgICAgICAgICBjb25zdCBvcHQgPSB0aGlzLnByb2ZpbGVTZWxlY3Rvci5jcmVhdGVFbCgnb3B0aW9uJywgeyB0ZXh0OiBwLm5hbWUsIGF0dHI6IHsgdmFsdWU6IHAuaWQgfSB9KTtcbiAgICAgICAgICAgIGlmIChwLmlkID09PSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5hY3RpdmVQcm9maWxlSWQpIG9wdC5zZXRBdHRyaWJ1dGUoJ3NlbGVjdGVkJywgJ3NlbGVjdGVkJyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGFzeW5jIGxvYWRBY3RpdmVQcm9maWxlSGlzdG9yeSgpIHtcbiAgICAgICAgY29uc3QgcHJvZmlsZSA9IHRoaXMucGx1Z2luLmdldEFjdGl2ZVByb2ZpbGUoKTtcbiAgICAgICAgY29uc3QganNvblBhdGggPSBgYWdlbnQtbWVtb3J5LyR7cHJvZmlsZS5pZH0vc2Vzc2lvbl9oaXN0b3J5Lmpzb25gO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKGF3YWl0IHRoaXMucGx1Z2luLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhqc29uUGF0aCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByYXdEYXRhID0gYXdhaXQgdGhpcy5wbHVnaW4uYXBwLnZhdWx0LmFkYXB0ZXIucmVhZChqc29uUGF0aCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXdEYXRhKTtcbiAgICAgICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5ID0gcGFyc2VkLmxlbmd0aCA+IDAgPyBwYXJzZWQgOiBbeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogcHJvZmlsZS5zeXN0ZW1Qcm9tcHQgfV07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuY2hhdEhpc3RvcnkgPSBbeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogcHJvZmlsZS5zeXN0ZW1Qcm9tcHQgfV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGUpIHsgdGhpcy5jaGF0SGlzdG9yeSA9IFt7IHJvbGU6ICdzeXN0ZW0nLCBjb250ZW50OiBwcm9maWxlLnN5c3RlbVByb21wdCB9XTsgfVxuICAgIH1cblxuICAgIGFzeW5jIHNhdmVBY3RpdmVQcm9maWxlSGlzdG9yeSgpIHtcbiAgICAgICAgY29uc3QgcHJvZmlsZSA9IHRoaXMucGx1Z2luLmdldEFjdGl2ZVByb2ZpbGUoKTtcbiAgICAgICAgY29uc3QganNvblBhdGggPSBgYWdlbnQtbWVtb3J5LyR7cHJvZmlsZS5pZH0vc2Vzc2lvbl9oaXN0b3J5Lmpzb25gO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHAudmF1bHQuYWRhcHRlci53cml0ZShqc29uUGF0aCwgSlNPTi5zdHJpbmdpZnkodGhpcy5jaGF0SGlzdG9yeSwgbnVsbCwgMikpO1xuICAgIH1cblxuICAgIC8vIC0tLSBDT05URVhUIElOSkVDVElPTiBST1VUSU5FIC0tLVxuICAgIGFzeW5jIGluamVjdEFjdGl2ZU5vdGVDb250ZXh0KCkge1xuICAgICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5wbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmICghYWN0aXZlRmlsZSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSBub3RlIGZvdW5kIHRvIGF0dGFjaC5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMucGx1Z2luLmFwcC52YXVsdC5yZWFkKGFjdGl2ZUZpbGUpO1xuICAgICAgICB0aGlzLmNoYXRIaXN0b3J5LnB1c2goe1xuICAgICAgICAgICAgcm9sZTogJ3N5c3RlbScsXG4gICAgICAgICAgICBjb250ZW50OiBgW0NPTlRFWFRVQUwgSU5KRUNUSU9OIEJZIFVTRVJdIEZvY3VzIG9uIHRoZSBmb2xsb3dpbmcgZmlsZSBkYXRhICgke2FjdGl2ZUZpbGUucGF0aH0pOlxcblxcbiR7Y29udGVudH1gXG4gICAgICAgIH0pO1xuICAgICAgICBuZXcgTm90aWNlKGBBdHRhY2hlZCAke2FjdGl2ZUZpbGUuYmFzZW5hbWV9IHRvIGFnZW50IG1lbW9yeSBjb250ZXh0LmApO1xuICAgIH1cblxuICAgIGFzeW5jIHJlbmRlck1lc3NhZ2VzKCkge1xuICAgICAgICBpZiAoIXRoaXMubWVzc2FnZUNvbnRhaW5lcikgcmV0dXJuO1xuICAgICAgICB0aGlzLm1lc3NhZ2VDb250YWluZXIuZW1wdHkoKTtcblxuICAgICAgICBmb3IgKGxldCBpID0gMTsgaSA8IHRoaXMuY2hhdEhpc3RvcnkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IHRoaXMuY2hhdEhpc3RvcnlbaV07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFJlbmRlciB1c2VyIGluamVjdGVkIGNvbnRleHQgdmlzaWJseSBhcyBhIHN5c3RlbSBibG9ja1xuICAgICAgICAgICAgaWYgKG1zZy5yb2xlID09PSAnc3lzdGVtJyAmJiBtc2cuY29udGVudD8uc3RhcnRzV2l0aCgnW0NPTlRFWFRVQUwgSU5KRUNUSU9OJykpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzeXNEaXYgPSB0aGlzLm1lc3NhZ2VDb250YWluZXIuY3JlYXRlRWwoJ2RpdicsIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cjogeyBzdHlsZTogJ3BhZGRpbmc6IDhweCAxMnB4OyBib3JkZXItcmFkaXVzOiA0cHg7IGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtc2Vjb25kYXJ5LWFsdCk7IGJvcmRlci1sZWZ0OiAycHggc29saWQgdmFyKC0tdGV4dC1tdXRlZCk7IGZvbnQtc2l6ZTogMC44NWVtOyBvcGFjaXR5OiAwLjg7JyB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgc3lzRGl2LmNyZWF0ZUVsKCdzdHJvbmcnLCB7IHRleHQ6ICfwn5OOIElOSkVDVEVEIEZJTEUgQ09OVEVYVCcsIGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogNHB4OycgfSB9KTtcbiAgICAgICAgICAgICAgICBzeXNEaXYuY3JlYXRlRWwoJ3NwYW4nLCB7IHRleHQ6IFwiRGF0YSBzdWNjZXNzZnVsbHkgbG9hZGVkIGludG8gYWdlbnQgb3BlcmF0aW9uYWwgbWVtb3J5LlwiIH0pO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAobXNnLnJvbGUgPT09ICdzeXN0ZW0nIHx8IG1zZy5yb2xlID09PSAndG9vbCcgfHwgbXNnLnRvb2xfY2FsbHMpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBjb25zdCBpc1VzZXIgPSBtc2cucm9sZSA9PT0gJ3VzZXInO1xuICAgICAgICAgICAgY29uc3QgbXNnRGl2ID0gdGhpcy5tZXNzYWdlQ29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7XG4gICAgICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgICAgICBzdHlsZTogYHBhZGRpbmc6IDEycHggMTZweDsgYm9yZGVyLXJhZGl1czogOHB4OyBtYXgtd2lkdGg6IDk1JTsgYm94LXNoYWRvdzogMCAycHggOHB4IHJnYmEoMCwwLDAsMC4wMik7ICR7XG4gICAgICAgICAgICAgICAgICAgICAgICBpc1VzZXIgPyAnYWxpZ24tc2VsZjogZmxleC1lbmQ7IGJhY2tncm91bmQ6IHZhcigtLWludGVyYWN0aXZlLWFjY2VudCk7IGNvbG9yOiB2YXIoLS10ZXh0LW9uLWFjY2VudCk7JyA6ICdhbGlnbi1zZWxmOiBmbGV4LXN0YXJ0OyBiYWNrZ3JvdW5kOiB2YXIoLS1iYWNrZ3JvdW5kLXNlY29uZGFyeSk7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKTsnXG4gICAgICAgICAgICAgICAgICAgIH1gXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIG1zZ0Rpdi5jcmVhdGVFbCgnc3Ryb25nJywgeyBcbiAgICAgICAgICAgICAgICB0ZXh0OiBpc1VzZXIgPyAnVXNlciAvLycgOiBgJHt0aGlzLnBsdWdpbi5nZXRBY3RpdmVQcm9maWxlKCkubmFtZX0gLy9gLFxuICAgICAgICAgICAgICAgIGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OiBibG9jazsgZm9udC1zaXplOiAwLjc1ZW07IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IG1hcmdpbi1ib3R0b206IDZweDsnIH0gXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgYm9keUNvbnRlbnQgPSBtc2dEaXYuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAnbWFya2Rvd24tcmVuZGVyZWQnIH0pO1xuICAgICAgICAgICAgYXdhaXQgTWFya2Rvd25SZW5kZXJlci5yZW5kZXJNYXJrZG93bihtc2cuY29udGVudCB8fCAnJywgYm9keUNvbnRlbnQsIHRoaXMucGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpPy5wYXRoIHx8ICcnLCB0aGlzLmxpZmVjeWNsZUNvbXBvbmVudCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5tZXNzYWdlQ29udGFpbmVyLnNjcm9sbFRvcCA9IHRoaXMubWVzc2FnZUNvbnRhaW5lci5zY3JvbGxIZWlnaHQ7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIEFTWU5DIEFHRU5UIExPT1AgRU5HSU5FXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGFzeW5jIHN0YXJ0QWdlbnRMb29wKGluaXRpYWxUZXh0Pzogc3RyaW5nKSB7XG4gICAgICAgIGlmIChpbml0aWFsVGV4dCkge1xuICAgICAgICAgICAgdGhpcy5pbnB1dEZpZWxkLnZhbHVlID0gJyc7XG4gICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5LnB1c2goeyByb2xlOiAndXNlcicsIGNvbnRlbnQ6IGluaXRpYWxUZXh0IH0pO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZW5kZXJNZXNzYWdlcygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5pc0V4ZWN1dGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuYWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgICAgICBjb25zdCBjdXJyZW50UHJvZmlsZSA9IHRoaXMucGx1Z2luLmdldEFjdGl2ZVByb2ZpbGUoKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGxvYWRpbmdNc2dJbmRleCA9IHRoaXMuY2hhdEhpc3RvcnkucHVzaCh7IHJvbGU6ICdhc3Npc3RhbnQnLCBjb250ZW50OiAnJyB9KSAtIDE7XG4gICAgICAgIGF3YWl0IHRoaXMucmVuZGVyTWVzc2FnZXMoKTtcblxuICAgICAgICBjb25zdCBtZXNzYWdlRGl2ID0gdGhpcy5tZXNzYWdlQ29udGFpbmVyLmxhc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgIG1lc3NhZ2VEaXYuZW1wdHkoKTtcbiAgICAgICAgbWVzc2FnZURpdi5jcmVhdGVFbCgnc3Ryb25nJywgeyB0ZXh0OiBgJHtjdXJyZW50UHJvZmlsZS5uYW1lfSAvL2AsIGF0dHI6IHsgc3R5bGU6ICdkaXNwbGF5OiBibG9jazsgZm9udC1zaXplOiAwLjc1ZW07IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IG1hcmdpbi1ib3R0b206IDhweDsnIH0gfSk7XG5cbiAgICAgICAgY29uc3QgdGhpbmtEZXRhaWxzID0gbWVzc2FnZURpdi5jcmVhdGVFbCgnZGV0YWlscycsIHsgYXR0cjogeyBzdHlsZTogJ21hcmdpbi1ib3R0b206IDEycHg7IGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtc2Vjb25kYXJ5LWFsdCk7IGJvcmRlci1sZWZ0OiAzcHggc29saWQgdmFyKC0taW50ZXJhY3RpdmUtYWNjZW50KTsgcGFkZGluZzogMTBweDsgZGlzcGxheTogbm9uZTsnIH0gfSk7XG4gICAgICAgIHRoaW5rRGV0YWlscy5jcmVhdGVFbCgnc3VtbWFyeScsIHsgdGV4dDogJ1RoaW5raW5nLi4nLCBhdHRyOiB7IHN0eWxlOiAnY3Vyc29yOiBwb2ludGVyOyBmb250LXNpemU6IDAuNzVlbTsgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQtbW9ub3NwYWNlKTsgZm9udC13ZWlnaHQ6IDYwMDsnIH0gfSk7XG4gICAgICAgIGNvbnN0IHRoaW5rQ29udGVudCA9IHRoaW5rRGV0YWlscy5jcmVhdGVFbCgnZGl2JywgeyBhdHRyOiB7IHN0eWxlOiAnZm9udC1zaXplOiAwLjg1ZW07IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IG1hcmdpbi10b3A6IDZweDsgd2hpdGUtc3BhY2U6IHByZS13cmFwOycgfSB9KTtcblxuICAgICAgICBjb25zdCBtYWluQ29udGVudCA9IG1lc3NhZ2VEaXYuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAnbWFya2Rvd24tcmVuZGVyZWQnIH0pO1xuXG4gICAgICAgIGNvbnN0IGV4cG9zZWRUb29scyA9IE1jcFRvb2xSZWdpc3RyeS5nZXRDYXBhYmlsaXRpZXMoKS5tYXAodCA9PiAoe1xuICAgICAgICAgICAgdHlwZTogXCJmdW5jdGlvblwiLFxuICAgICAgICAgICAgZnVuY3Rpb246IHsgbmFtZTogdC5uYW1lLCBkZXNjcmlwdGlvbjogdC5kZXNjcmlwdGlvbiwgcGFyYW1ldGVyczogdC5pbnB1dFNjaGVtYSB9XG4gICAgICAgIH0pKTtcblxuICAgICAgICBsZXQgcGlwZWxpbmVFeGVjdXRpb25BY3RpdmUgPSB0cnVlO1xuICAgICAgICBsZXQgY29udHJvbEl0ZXJhdGlvbkxpbWl0ID0gMDtcblxuICAgICAgICB3aGlsZSAocGlwZWxpbmVFeGVjdXRpb25BY3RpdmUgJiYgY29udHJvbEl0ZXJhdGlvbkxpbWl0IDwgNSkge1xuICAgICAgICAgICAgY29udHJvbEl0ZXJhdGlvbkxpbWl0Kys7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfTtcbiAgICAgICAgICAgICAgICBpZiAoY3VycmVudFByb2ZpbGUuYXBpS2V5KSBoZWFkZXJzWydBdXRob3JpemF0aW9uJ10gPSBgQmVhcmVyICR7Y3VycmVudFByb2ZpbGUuYXBpS2V5fWA7XG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke2N1cnJlbnRQcm9maWxlLmFwaVVybH0vY2hhdC9jb21wbGV0aW9uc2AsIHtcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICAgICAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXG4gICAgICAgICAgICAgICAgICAgIHNpZ25hbDogdGhpcy5hYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RlbDogY3VycmVudFByb2ZpbGUubW9kZWxOYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZXM6IHRoaXMuY2hhdEhpc3Rvcnkuc2xpY2UoMCwgdGhpcy5jaGF0SGlzdG9yeS5sZW5ndGggLSAxKS5maWx0ZXIobSA9PiBtLmNvbnRlbnQgIT09ICcnKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBlcmF0dXJlOiBjdXJyZW50UHJvZmlsZS50ZW1wZXJhdHVyZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0cmVhbTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvb2xzOiBleHBvc2VkVG9vbHNcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGlmICghcmVzcG9uc2UuYm9keSkgdGhyb3cgbmV3IEVycm9yKFwiTnVsbCBKU09OIHN0cmVhbSB0YXJnZXQgZXJyb3IuXCIpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlYWRlciA9IHJlc3BvbnNlLmJvZHkuZ2V0UmVhZGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZGVjb2RlciA9IG5ldyBUZXh0RGVjb2RlcigndXRmLTgnKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBsZXQgZnVsbFJhd1N0cmVhbSA9IFwiXCI7IFxuICAgICAgICAgICAgICAgIGxldCBmdWxsVGhpbmtpbmcgPSBcIlwiO1xuICAgICAgICAgICAgICAgIGxldCBmdWxsQ29udGVudCA9IFwiXCI7XG4gICAgICAgICAgICAgICAgbGV0IHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsOiBhbnkgPSBudWxsO1xuXG4gICAgICAgICAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRvbmUpIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2h1bmsgPSBkZWNvZGVyLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gY2h1bmsuc3BsaXQoJ1xcbicpLmZpbHRlcihsaW5lID0+IGxpbmUudHJpbSgpICE9PSAnJyk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChsaW5lLnJlcGxhY2UoL15kYXRhOiAvLCAnJykudHJpbSgpID09PSAnW0RPTkVdJykgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobGluZS5zdGFydHNXaXRoKCdkYXRhOiAnKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobGluZS5zbGljZSg2KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlbHRhID0gcGFyc2VkLmNob2ljZXNbMF0uZGVsdGE7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGVsdGEudG9vbF9jYWxscykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFydW50aW1lRGV0ZWN0ZWRUb29sQ2FsbCkgcnVudGltZURldGVjdGVkVG9vbENhbGwgPSB7IGlkOiBcIlwiLCBmdW5jdGlvbjogeyBuYW1lOiBcIlwiLCBhcmd1bWVudHM6IFwiXCIgfSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2FsbCA9IGRlbHRhLnRvb2xfY2FsbHNbMF07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2FsbC5pZCkgcnVudGltZURldGVjdGVkVG9vbENhbGwuaWQgKz0gY2FsbC5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjYWxsLmZ1bmN0aW9uPy5uYW1lKSBydW50aW1lRGV0ZWN0ZWRUb29sQ2FsbC5mdW5jdGlvbi5uYW1lICs9IGNhbGwuZnVuY3Rpb24ubmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjYWxsLmZ1bmN0aW9uPy5hcmd1bWVudHMpIHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmZ1bmN0aW9uLmFyZ3VtZW50cyArPSBjYWxsLmZ1bmN0aW9uLmFyZ3VtZW50cztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpbmtEZXRhaWxzLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpbmtEZXRhaWxzLnNldEF0dHJpYnV0ZSgnb3BlbicsICcnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaW5rQ29udGVudC5pbm5lclRleHQgPSBgW1JPVVRJTkcgSU5TVFJVQ1RJT04gVE8gTUNQIENPUkVdOiAke3J1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmZ1bmN0aW9uLm5hbWV9XFxuQXJnczogJHtydW50aW1lRGV0ZWN0ZWRUb29sQ2FsbC5mdW5jdGlvbi5hcmd1bWVudHN9YDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGRlbHRhLmNvbnRlbnQpIGZ1bGxSYXdTdHJlYW0gKz0gZGVsdGEuY29udGVudDtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZnVsbFJhd1N0cmVhbS5pbmNsdWRlcygnPHRoaW5rPicpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJ0cyA9IGZ1bGxSYXdTdHJlYW0uc3BsaXQoJzx0aGluaz4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFmdGVyVGhpbmsgPSBwYXJ0c1sxXSB8fCBcIlwiO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFmdGVyVGhpbmsuaW5jbHVkZXMoJzwvdGhpbms+JykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzcGxpdEVuZCA9IGFmdGVyVGhpbmsuc3BsaXQoJzwvdGhpbms+Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVsbFRoaW5raW5nID0gc3BsaXRFbmRbMF07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVsbENvbnRlbnQgPSBwYXJ0c1swXSArIHNwbGl0RW5kLnNsaWNlKDEpLmpvaW4oJzwvdGhpbms+Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpbmtEZXRhaWxzLnJlbW92ZUF0dHJpYnV0ZSgnb3BlbicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdWxsVGhpbmtpbmcgPSBhZnRlclRoaW5rO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZ1bGxDb250ZW50ID0gcGFydHNbMF07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpbmtEZXRhaWxzLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpbmtEZXRhaWxzLmhhc0F0dHJpYnV0ZSgnb3BlbicpKSB0aGlua0RldGFpbHMuc2V0QXR0cmlidXRlKCdvcGVuJywgJycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVsbENvbnRlbnQgPSBmdWxsUmF3U3RyZWFtO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGVsdGEucmVhc29uaW5nX2NvbnRlbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZ1bGxUaGlua2luZyArPSBkZWx0YS5yZWFzb25pbmdfY29udGVudDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaW5rRGV0YWlscy5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpbmtEZXRhaWxzLmhhc0F0dHJpYnV0ZSgnb3BlbicpKSB0aGlua0RldGFpbHMuc2V0QXR0cmlidXRlKCdvcGVuJywgJycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZ1bGxUaGlua2luZykgdGhpbmtDb250ZW50LmlubmVyVGV4dCA9IGZ1bGxUaGlua2luZztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZ1bGxDb250ZW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYWluQ29udGVudC5lbXB0eSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgTWFya2Rvd25SZW5kZXJlci5yZW5kZXJNYXJrZG93bihmdWxsQ29udGVudCwgbWFpbkNvbnRlbnQsIHRoaXMucGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpPy5wYXRoIHx8ICcnLCB0aGlzLmxpZmVjeWNsZUNvbXBvbmVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5tZXNzYWdlQ29udGFpbmVyLnNjcm9sbFRvcCA9IHRoaXMubWVzc2FnZUNvbnRhaW5lci5zY3JvbGxIZWlnaHQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge31cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIC0tLSBUT09MIEVYRUNVVElPTiBJTlRFUkNFUFQgUk9VVElORyAtLS1cbiAgICAgICAgICAgICAgICBpZiAocnVudGltZURldGVjdGVkVG9vbENhbGwgJiYgcnVudGltZURldGVjdGVkVG9vbENhbGwuZnVuY3Rpb24ubmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJzZWRBcmd1bWVudHMgPSBKU09OLnBhcnNlKHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmZ1bmN0aW9uLmFyZ3VtZW50cyB8fCAne30nKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyAxLiBEZXN0cnVjdGl2ZSBBY3Rpb24gVUkgT3ZlcnJpZGUgKFNlY3VyaXR5IHNhbmRib3gpXG4gICAgICAgICAgICAgICAgICAgIGlmIChydW50aW1lRGV0ZWN0ZWRUb29sQ2FsbC5mdW5jdGlvbi5uYW1lID09PSAncmVxdWVzdF9maWxlX2RlbGV0aW9uJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2UgbXVzdCBzYXZlIHRoZSBMTE0ncyB0b29sIGNhbGwgaW50ZW50IGludG8gaGlzdG9yeSBiZWZvcmUgcGF1c2luZ1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeS5zcGxpY2UodGhpcy5jaGF0SGlzdG9yeS5sZW5ndGggLSAxLCAwLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ2Fzc2lzdGFudCcsIGNvbnRlbnQ6IG51bGwsIHRvb2xfY2FsbHM6IFt7IGlkOiBydW50aW1lRGV0ZWN0ZWRUb29sQ2FsbC5pZCwgdHlwZTogJ2Z1bmN0aW9uJywgZnVuY3Rpb246IHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmZ1bmN0aW9uIH1dXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyRGVsZXRpb25XYXJuaW5nKHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLCBwYXJzZWRBcmd1bWVudHMsIGxvYWRpbmdNc2dJbmRleCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47IC8vIEhhbHQgdGhlIGF1dG9tYXRpYyBsb29wIGVudGlyZWx5IHVudGlsIHVzZXIgaW50ZXJhY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIDIuIFN0YW5kYXJkIFNhZmUgRXhlY3V0aW9uIFJvdXRlXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRyYWNraW5nT2JqZWN0ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ2Fzc2lzdGFudCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgdG9vbF9jYWxsczogW3sgaWQ6IHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmlkLCB0eXBlOiAnZnVuY3Rpb24nLCBmdW5jdGlvbjogcnVudGltZURldGVjdGVkVG9vbENhbGwuZnVuY3Rpb24gfV1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jaGF0SGlzdG9yeS5zcGxpY2UodGhpcy5jaGF0SGlzdG9yeS5sZW5ndGggLSAxLCAwLCB0cmFja2luZ09iamVjdCBhcyBhbnkpO1xuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4ZWN1dGlvblJlc3BvbnNlU3RyID0gYXdhaXQgTWNwVG9vbFJlZ2lzdHJ5LmV4ZWN1dGVUb29sKHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmZ1bmN0aW9uLm5hbWUsIHBhcnNlZEFyZ3VtZW50cywgdGhpcy5wbHVnaW4pO1xuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2hhdEhpc3Rvcnkuc3BsaWNlKHRoaXMuY2hhdEhpc3RvcnkubGVuZ3RoIC0gMSwgMCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ3Rvb2wnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdG9vbF9jYWxsX2lkOiBydW50aW1lRGV0ZWN0ZWRUb29sQ2FsbC5pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHJ1bnRpbWVEZXRlY3RlZFRvb2xDYWxsLmZ1bmN0aW9uLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBleGVjdXRpb25SZXNwb25zZVN0clxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7IC8vIExvb3AgZmlyZXMgYWdhaW4gdG8gZmVlZCB0b29sIHJlc3VsdCB0byB0aGUgbW9kZWxcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5W2xvYWRpbmdNc2dJbmRleF0uY29udGVudCA9IGZ1bGxDb250ZW50O1xuICAgICAgICAgICAgICAgICAgICBwaXBlbGluZUV4ZWN1dGlvbkFjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yLm5hbWUgPT09ICdBYm9ydEVycm9yJykge1xuICAgICAgICAgICAgICAgICAgICBtYWluQ29udGVudC5pbm5lclRleHQgKz0gYFxcblxcbltVU0VSIEFCT1JURUQgRVhFQ1VUSU9OXWA7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2hhdEhpc3RvcnlbbG9hZGluZ01zZ0luZGV4XS5jb250ZW50ID0gbWFpbkNvbnRlbnQuaW5uZXJUZXh0O1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG1haW5Db250ZW50LmlubmVyVGV4dCA9IGBBZ2VudGljIFByb2Nlc3NpbmcgUGlwZWxpbmUgRXJyb3I6ICR7ZXJyb3IubWVzc2FnZX1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBwaXBlbGluZUV4ZWN1dGlvbkFjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlua0RldGFpbHMucmVtb3ZlQXR0cmlidXRlKCdvcGVuJyk7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZUFjdGl2ZVByb2ZpbGVIaXN0b3J5KCk7XG4gICAgICAgIHRoaXMuaXNFeGVjdXRpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5hYm9ydENvbnRyb2xsZXIgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIC0tLSBERUxFVElPTiBTRUNVUklUWSBTQU5EQk9YIFVJIC0tLVxuICAgIHJlbmRlckRlbGV0aW9uV2FybmluZyh0b29sQ2FsbDogYW55LCBhcmdzOiBhbnksIGxvYWRpbmdNc2dJbmRleDogbnVtYmVyKSB7XG4gICAgICAgIHRoaXMuY2hhdEhpc3RvcnkucG9wKCk7IC8vIFBvcCB0aGUgbG9hZGluZyBpbmRleCBvdXQgdG8gbWFrZSByb29tIGZvciB0aGUgVUlcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHdhcm5pbmdEaXYgPSB0aGlzLm1lc3NhZ2VDb250YWluZXIuY3JlYXRlRWwoJ2RpdicsIHtcbiAgICAgICAgICAgIGF0dHI6IHsgc3R5bGU6ICdwYWRkaW5nOiAxNnB4OyBib3JkZXItcmFkaXVzOiA4cHg7IGJvcmRlcjogMnB4IHNvbGlkIHZhcigtLXRleHQtZXJyb3IpOyBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwgMCwgMCwgMC4wNSk7IG1hcmdpbi10b3A6IDEwcHg7JyB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHdhcm5pbmdEaXYuY3JlYXRlRWwoJ3N0cm9uZycsIHsgdGV4dDogJ0NSSVRJQ0FMIEFDVElPTiBBVVRIT1JJWkFUSU9OJywgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6IGJsb2NrOyBjb2xvcjogdmFyKC0tdGV4dC1lcnJvcik7IGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm9zcGFjZSk7IGZvbnQtc2l6ZTogMC45ZW07IG1hcmdpbi1ib3R0b206IDhweDsnIH0gfSk7XG4gICAgICAgIHdhcm5pbmdEaXYuY3JlYXRlRWwoJ3AnLCB7IHRleHQ6IGBUaGUgYWdlbnQgaXMgcmVxdWVzdGluZyB0byBkZWxldGUgdGhlIGZvbGxvd2luZyBmaWxlOmAsIGF0dHI6IHsgc3R5bGU6ICdtYXJnaW46IDAgMCA0cHggMDsnIH0gfSk7XG4gICAgICAgIHdhcm5pbmdEaXYuY3JlYXRlRWwoJ2NvZGUnLCB7IHRleHQ6IGFyZ3MucGF0aCwgYXR0cjogeyBzdHlsZTogJ2Rpc3BsYXk6IGJsb2NrOyBwYWRkaW5nOiA2cHg7IGJhY2tncm91bmQ6IHZhcigtLWJhY2tncm91bmQtcHJpbWFyeSk7IGJvcmRlci1yYWRpdXM6IDRweDsgbWFyZ2luLWJvdHRvbTogMTBweDsgZm9udC13ZWlnaHQ6IGJvbGQ7JyB9IH0pO1xuICAgICAgICB3YXJuaW5nRGl2LmNyZWF0ZUVsKCdwJywgeyB0ZXh0OiBgQWdlbnQncyBSZWFzb246IFwiJHthcmdzLnJlYXNvbn1cImAsIGF0dHI6IHsgc3R5bGU6ICdmb250LXN0eWxlOiBpdGFsaWM7IG9wYWNpdHk6IDAuODsgZm9udC1zaXplOiAwLjllbTsgbWFyZ2luLWJvdHRvbTogMTJweDsnIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYnRuUm93ID0gd2FybmluZ0Rpdi5jcmVhdGVFbCgnZGl2JywgeyBhdHRyOiB7IHN0eWxlOiAnZGlzcGxheTogZmxleDsgZ2FwOiAxMHB4OycgfSB9KTtcbiAgICAgICAgY29uc3QgYWNjZXB0QnRuID0gYnRuUm93LmNyZWF0ZUVsKCdidXR0b24nLCB7IHRleHQ6ICdBVVRIT1JJWkUgREVMRVRJT04nLCBhdHRyOiB7IHN0eWxlOiAnYmFja2dyb3VuZDogdmFyKC0tdGV4dC1lcnJvcik7IGNvbG9yOiB3aGl0ZTsgYm9yZGVyOiBub25lOyBmb250LXdlaWdodDogYm9sZDsnIH0gfSk7XG4gICAgICAgIGNvbnN0IGRlY2xpbmVCdG4gPSBidG5Sb3cuY3JlYXRlRWwoJ2J1dHRvbicsIHsgdGV4dDogJ0RFQ0xJTkUnIH0pO1xuXG4gICAgICAgIGFjY2VwdEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHdhcm5pbmdEaXYuZW1wdHkoKTtcbiAgICAgICAgICAgIHdhcm5pbmdEaXYuY3JlYXRlRWwoJ3AnLCB7IHRleHQ6IGBQcm9jZXNzaW5nIGRlbGV0aW9uLi4uYCB9KTtcbiAgICAgICAgICAgIGxldCByZXN1bHRTdGF0dXMgPSBcIlwiO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5wbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChhcmdzLnBhdGgpO1xuICAgICAgICAgICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwLnZhdWx0LnRyYXNoKGZpbGUsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRTdGF0dXMgPSBcIlN5c3RlbSBTdWNjZXNzOiBGaWxlIGhhcyBiZWVuIHBlcm1hbmVudGx5IGRlbGV0ZWQuXCI7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHJlc3VsdFN0YXR1cyA9IFwiU3lzdGVtIEVycm9yOiBGaWxlIGRvZXMgbm90IGV4aXN0LlwiO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkgeyByZXN1bHRTdGF0dXMgPSBgU3lzdGVtIEVycm9yOiAke2UubWVzc2FnZX1gOyB9XG5cbiAgICAgICAgICAgIHRoaXMuY2hhdEhpc3RvcnkucHVzaCh7IHJvbGU6ICd0b29sJywgdG9vbF9jYWxsX2lkOiB0b29sQ2FsbC5pZCwgbmFtZTogdG9vbENhbGwuZnVuY3Rpb24ubmFtZSwgY29udGVudDogcmVzdWx0U3RhdHVzIH0pO1xuICAgICAgICAgICAgd2FybmluZ0Rpdi5yZW1vdmUoKTtcbiAgICAgICAgICAgIHRoaXMuc3RhcnRBZ2VudExvb3AoKTsgXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlY2xpbmVCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNoYXRIaXN0b3J5LnB1c2goeyByb2xlOiAndG9vbCcsIHRvb2xfY2FsbF9pZDogdG9vbENhbGwuaWQsIG5hbWU6IHRvb2xDYWxsLmZ1bmN0aW9uLm5hbWUsIGNvbnRlbnQ6IFwiVVNFUiBERU5JRUQgUEVSTUlTU0lPTi4gVGhlIGZpbGUgd2FzIE5PVCBkZWxldGVkLlwiIH0pO1xuICAgICAgICAgICAgd2FybmluZ0Rpdi5yZW1vdmUoKTtcbiAgICAgICAgICAgIHRoaXMuc3RhcnRBZ2VudExvb3AoKTsgXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubWVzc2FnZUNvbnRhaW5lci5zY3JvbGxUb3AgPSB0aGlzLm1lc3NhZ2VDb250YWluZXIuc2Nyb2xsSGVpZ2h0O1xuICAgIH1cblxuICAgIGFzeW5jIG9uQ2xvc2UoKSB7IHRoaXMubGlmZWN5Y2xlQ29tcG9uZW50LnVubG9hZCgpOyB9XG59XG5cbmNsYXNzIEh5b2thU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICAgIHBsdWdpbjogSHlva2FQbHVnaW47XG4gICAgY29uc3RydWN0b3IoYXBwOiBhbnksIHBsdWdpbjogSHlva2FQbHVnaW4pIHsgc3VwZXIoYXBwLCBwbHVnaW4pOyB0aGlzLnBsdWdpbiA9IHBsdWdpbjsgfVxuXG4gICAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICAgICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgICAgICBjb250YWluZXJFbC5jcmVhdGVFbCgnaDInLCB7IHRleHQ6ICdIeW9rYSBDb250cm9sIFBhbmVsJyB9KTtcbiAgICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ3AnLCB7IHRleHQ6ICdNYW5hZ2UgbG9jYWxpemVkIG9yY2hlc3RyYXRpb24gcGlwZWxpbmVzIGFuZCBleGVjdXRpb24gbWV0cmljcy4nLCBhdHRyOiB7IHN0eWxlOiAnZm9udC1zaXplOiAwLjllbTsgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpOyBtYXJnaW4tYm90dG9tOiAyNHB4OycgfSB9KTtcblxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5wcm9maWxlcy5mb3JFYWNoKChwcm9maWxlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjYXJkID0gY29udGFpbmVyRWwuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAnaHlva2Etc2V0dGluZy1jYXJkJyB9KTtcbiAgICAgICAgICAgIGNhcmQuY3JlYXRlRWwoJ2g0JywgeyB0ZXh0OiBgUnVudGltZSBDb3JlIEluc3RhbmNlOiAke3Byb2ZpbGUubmFtZX1gIH0pO1xuXG4gICAgICAgICAgICBuZXcgU2V0dGluZyhjYXJkKS5zZXROYW1lKCdWaXN1YWwgUGVyc29uYSBMYWJlbCcpLmFkZFRleHQodGV4dCA9PiB0ZXh0LnNldFZhbHVlKHByb2ZpbGUubmFtZSkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHsgcHJvZmlsZS5uYW1lID0gdjsgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7IH0pKTtcbiAgICAgICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpLnNldE5hbWUoJ1RhcmdldCBSRVNUIEJhc2UgUGF0aCcpLmFkZFRleHQodGV4dCA9PiB0ZXh0LnNldFZhbHVlKHByb2ZpbGUuYXBpVXJsKS5vbkNoYW5nZShhc3luYyAodikgPT4geyBwcm9maWxlLmFwaVVybCA9IHY7IGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpOyB9KSk7XG4gICAgICAgICAgICBuZXcgU2V0dGluZyhjYXJkKS5zZXROYW1lKCdNb2RlbCBJZGVudGlmaWVyIEZsYWcnKS5hZGRUZXh0KHRleHQgPT4gdGV4dC5zZXRWYWx1ZShwcm9maWxlLm1vZGVsTmFtZSkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHsgcHJvZmlsZS5tb2RlbE5hbWUgPSB2OyBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTsgfSkpO1xuICAgICAgICAgICAgbmV3IFNldHRpbmcoY2FyZCkuc2V0TmFtZSgnQXV0aGVudGljYXRpb24gQ3JlZGVudGlhbHMgS2V5JykuYWRkVGV4dCh0ZXh0ID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoJ3NrLS4uLiAoTGVhdmUgZW1wdHkgZm9yIGxvY2FsIGxvb3BzKScpLnNldFZhbHVlKHByb2ZpbGUuYXBpS2V5KS5vbkNoYW5nZShhc3luYyAodikgPT4geyBwcm9maWxlLmFwaUtleSA9IHY7IGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpOyB9KSk7XG4gICAgICAgICAgICBuZXcgU2V0dGluZyhjYXJkKS5zZXROYW1lKCdTeXN0ZW0gQ29udGV4dCBEaXJlY3RpdmVzJykuYWRkVGV4dEFyZWEodGV4dCA9PiB0ZXh0LnNldFZhbHVlKHByb2ZpbGUuc3lzdGVtUHJvbXB0KS5vbkNoYW5nZShhc3luYyAodikgPT4geyBwcm9maWxlLnN5c3RlbVByb21wdCA9IHY7IGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpOyB9KSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGFjdGlvbldyYXBwZXIgPSBjb250YWluZXJFbC5jcmVhdGVFbCgnZGl2JywgeyBhdHRyOiB7IHN0eWxlOiAnZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBmbGV4LWVuZDsgbWFyZ2luLXRvcDogMTZweDsnIH0gfSk7XG4gICAgICAgIGNvbnN0IGFkZEJ0biA9IGFjdGlvbldyYXBwZXIuY3JlYXRlRWwoJ2J1dHRvbicsIHsgdGV4dDogJysgRGVwbG95IEluZGVwZW5kZW50IEFnZW50IEluc3RhbmNlJywgY2xzOiAnbW9kLWN0YScgfSk7XG4gICAgICAgIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJ1bnRpbWVJZCA9IGBwZXJzb25hLSR7RGF0ZS5ub3coKX1gO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MucHJvZmlsZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IHJ1bnRpbWVJZCwgbmFtZTogJ0F1eGlsaWFyeSBXb3JrZXIgRHJvbmUnLCBhcGlVcmw6ICdodHRwOi8vMTI3LjAuMC4xOjgwODAvdjEnLCBtb2RlbE5hbWU6ICdnb29nbGUvZ2VtbWEtNC1FMkItaXQtcWF0LXE0XzAtZ2d1ZjpRNF8wJywgYXBpS2V5OiAnJywgc3lzdGVtUHJvbXB0OiAnWW91IGFyZSBhbiBleHBsaWNpdCBtaWNyby10YXNrIGNvbXB1dGF0aW9uYWwgbm9kZSBwZXJzb25hIGluc3RhbmNlLicsIHRlbXBlcmF0dXJlOiAwLjNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5pbml0aWFsaXplQWdlbnRXb3Jrc3BhY2UoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KTtcbiAgICB9XG59Il19