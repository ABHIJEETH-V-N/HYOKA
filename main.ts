import { 
    ItemView, 
    Plugin, 
    PluginSettingTab, 
    Setting, 
    WorkspaceLeaf, 
    MarkdownRenderer, 
    Component,
    Notice,
    requestUrl,
    TFile,
    setIcon
} from 'obsidian';

const VIEW_TYPE_HYOKA = "hyoka-chat-view";

// -------------------------------------------------------------
// STANDALONE PORTABLE MCP CODEC SPECIFICATIONS
// -------------------------------------------------------------
interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, any>;
        required: string[];
    };
}

class McpToolRegistry {
    static getCapabilities(): McpToolDefinition[] {
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

    static async executeTool(name: string, args: any, plugin: HyokaPlugin): Promise<string> {
        try {
            if (name === "write_agent_memory") {
                const { profileId, logEntry } = args;
                const targetPath = `agent-memory/${profileId}/chat_log.md`;
                
                if (await plugin.app.vault.adapter.exists(targetPath)) {
                    const currentData = await plugin.app.vault.adapter.read(targetPath);
                    const explicitTimestamp = new Date().toISOString();
                    const processedPayload = `\n\n### Runtime Log Timestamp: ${explicitTimestamp}\n${logEntry}\n`;
                    await plugin.app.vault.adapter.write(targetPath, currentData + processedPayload);
                    return `Disk Write Operations Executed Successfully: Synced metadata parameters to file location target ${targetPath}`;
                }
                return "Target memory sector configuration path location error.";
            }

            if (name === "create_note") {
                const folderPath = args.folder ? (args.folder.endsWith('/') ? args.folder : `${args.folder}/`) : '';
                const fullPath = `${folderPath}${args.filename}`;
                
                if (await plugin.app.vault.adapter.exists(fullPath)) return `Error: File '${fullPath}' already exists.`;
                await plugin.app.vault.create(fullPath, args.content);
                return `Success. Created file at ${fullPath}.`;
            }

            if (name === "read_note") {
                const file = plugin.app.vault.getAbstractFileByPath(args.path);
                if (file instanceof TFile) {
                    const content = await plugin.app.vault.read(file);
                    return `[CONTENT OF ${args.path}]:\n${content}`;
                }
                return `Error: File not found at ${args.path}. Did you include the .md extension?`;
            }

            if (name === "search_vault") {
                const files = plugin.app.vault.getMarkdownFiles();
                let results = `Search results for "${args.query}":\n\n`;
                let matchCount = 0;

                for (const file of files) {
                    const content = await plugin.app.vault.read(file);
                    if (content.toLowerCase().includes(args.query.toLowerCase())) {
                        matchCount++;
                        // Extract a small snippet around the first match
                        const index = content.toLowerCase().indexOf(args.query.toLowerCase());
                        const snippet = content.substring(Math.max(0, index - 100), Math.min(content.length, index + 100));
                        results += `--- Match found in ${file.path} ---\n...${snippet}...\n\n`;
                    }
                    if (matchCount >= 5) break; // Limit context window bloat
                }
                return matchCount > 0 ? results : `No matches found for "${args.query}".`;
            }

            if (name === "browse_web_page") {
                const response = await requestUrl({ url: args.url, method: 'GET' });
                const cleanText = response.text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').substring(0, 12000); 
                return `[WEB CONTENT FROM ${args.url}]:\n${cleanText}`;
            }

            throw new Error(`Execution error: Unregistered tool ${name}`);
        } catch (e) {
            return `Tool execution failed: ${e.message}`;
        }
    }
}

// -------------------------------------------------------------
// PLUGIN CORE ARCHITECTURE
// -------------------------------------------------------------
interface AgentProfile {
    id: string;
    name: string;
    apiUrl: string;
    modelName: string;
    apiKey: string;
    systemPrompt: string;
    temperature: number;
}

interface HyokaSettings { profiles: AgentProfile[]; activeProfileId: string; }

const DEFAULT_SETTINGS: HyokaSettings = {
    profiles: [
        {
            id: 'systems-architect',
            name: 'Systems Architect',
            apiUrl: 'http://127.0.0.1:8080/v1',
            modelName: 'google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0',
            apiKey: '',
            systemPrompt: 'You are an advanced AI Agent operating DIRECTLY inside the user\'s Obsidian Vault file system. YOU HAVE FULL CONTROL. If the user asks you to create a file, DO NOT SAY YOU CANNOT. Use the `Notes` tool immediately. If they ask you to research, use the `browse_web_page` or `search_vault` tools. Never apologize for lacking access; you have the tools, use them.',
            temperature: 0.2
        },
        {
            id: 'secops-analyst',
            name: 'SecOps Analyst',
            apiUrl: 'http://127.0.0.1:8080/v1',
            modelName: 'google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0',
            apiKey: '',
            systemPrompt: 'You are a cybersecurity automation agent specialized in log analysis and code scanning. Use your tools to analyze vault data.',
            temperature: 0.1
        }
    ],
    activeProfileId: 'systems-architect'
};

interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: any[];
    tool_call_id?: string;
}

export default class HyokaPlugin extends Plugin {
    settings: HyokaSettings;

    async onload() {
        await this.loadSettings();
        await this.initializeAgentWorkspace();
        this.injectCustomStyles();

        this.registerView(VIEW_TYPE_HYOKA, (leaf) => new HyokaChatView(leaf, this));
        this.addRibbonIcon('bot', 'Open Hyoka Shell', () => this.activateView());
        this.addSettingTab(new HyokaSettingTab(this.app, this));
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
    getActiveProfile(): AgentProfile { return this.settings.profiles.find(p => p.id === this.settings.activeProfileId) || this.settings.profiles[0]; }

    async initializeAgentWorkspace() {
        const baseDir = "agent-memory";
        if (!(await this.app.vault.adapter.exists(baseDir))) await this.app.vault.createFolder(baseDir);

        for (const profile of this.settings.profiles) {
            const profileDir = `${baseDir}/${profile.id}`;
            if (!(await this.app.vault.adapter.exists(profileDir))) await this.app.vault.createFolder(profileDir);
            
            const structuralLogPath = `${profileDir}/session_history.json`;
            if (!(await this.app.vault.adapter.exists(structuralLogPath))) await this.app.vault.create(structuralLogPath, JSON.stringify([]));
            
            const humanLogPath = `${profileDir}/chat_log.md`;
            if (!(await this.app.vault.adapter.exists(humanLogPath))) await this.app.vault.create(humanLogPath, `# ${profile.name} Session Runtime Log\n\n`);
        }
    }

    injectCustomStyles() {
        const styleId = 'hyoka-core-ux-overrides';
        if (!document.getElementById(styleId)) {
            const styleEl = document.createElement('style');
            styleEl.id = styleId;
            styleEl.textContent = `
                .nav-folder[data-path="agent-memory"] > .nav-folder-title { color: var(--text-accent) !important; font-family: var(--font-monospace) !important; font-weight: 700 !important; }
                .nav-folder[data-path="agent-memory"] > .nav-folder-title .nav-folder-title-content::before { content: "⚡ [CORE] " !important; }
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
            if (rightLeaf) { leaf = rightLeaf; await leaf.setViewState({ type: VIEW_TYPE_HYOKA, active: true }); }
        }
        if (leaf) workspace.revealLeaf(leaf);
    }
}

// -------------------------------------------------------------
// CHAT INTERFACE & EXECUTION LOOP
// -------------------------------------------------------------
class HyokaChatView extends ItemView {
    plugin: HyokaPlugin;
    chatHistory: ChatMessage[] = [];
    messageContainer: HTMLDivElement;
    inputField: HTMLTextAreaElement;
    profileSelector: HTMLSelectElement;
    lifecycleComponent: Component;
    
    // Engine Control State
    isExecuting: boolean = false;
    abortController: AbortController | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HyokaPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.lifecycleComponent = new Component();
    }

    getViewType(): string { return VIEW_TYPE_HYOKA; }
    getDisplayText(): string { return "Hyoka Shell Console"; }
    getIcon(): string { return "terminal"; }

    async onOpen() {
        this.lifecycleComponent.load();
        await this.loadActiveProfileHistory();

        const container = this.containerEl.children[1];
        container.empty();

        const wrapper = container.createEl('div', { 
            attr: { style: 'display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 12px; font-family: var(--font-interface);' }
        });

        // --- HEADER ---
        const header = wrapper.createEl('div', {
            attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;' }
        });
        header.createEl('h5', { text: 'HYOKA', attr: { style: 'margin: 0; font-family: var(--font-monospace); font-size: 1.2em; letter-spacing: 0.5px;' } });
        this.profileSelector = header.createEl('select', {
            attr: { style: 'padding: 4px 8px; font-family: var(--font-monospace); font-size: 0.8em; border-radius: 4px; background: var(--background-primary);' }
        });
        this.refreshProfileSelector();
        this.profileSelector.addEventListener('change', async () => {
            this.plugin.settings.activeProfileId = this.profileSelector.value;
            await this.plugin.saveSettings();
            await this.loadActiveProfileHistory();
            this.renderMessages();
        });

        // --- COMMAND STRIP (New Feature) ---
        const commandStrip = wrapper.createEl('div', { attr: { style: 'display: flex; gap: 8px; padding-bottom: 8px;' } });
        
        const attachBtn = commandStrip.createEl('button', { text: 'Attach Active Note', cls: 'hyoka-toolbar-btn' });
        attachBtn.addEventListener('click', () => this.injectActiveNoteContext());

        const stopBtn = commandStrip.createEl('button', { text: 'Stop Run', cls: 'hyoka-toolbar-btn danger' });
        stopBtn.addEventListener('click', () => {
            if (this.abortController && this.isExecuting) {
                this.abortController.abort();
                new Notice("Execution aborted.");
            }
        });

        const clearBtn = commandStrip.createEl('button', { text: 'Clear Memory', cls: 'hyoka-toolbar-btn' });
        clearBtn.addEventListener('click', () => {
            this.chatHistory = [{ role: 'system', content: this.plugin.getActiveProfile().systemPrompt }];
            this.saveActiveProfileHistory();
            this.renderMessages();
            new Notice("Memory wiped.");
        });

        // --- MESSAGE CONTAINER ---
        this.messageContainer = wrapper.createEl('div', {
            attr: { style: 'flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px;' }
        });

        // --- INPUT AREA ---
        const inputArea = wrapper.createEl('div', { attr: { style: 'display: flex; gap: 8px; align-items: flex-end;' } });
        this.inputField = inputArea.createEl('textarea', {
            attr: { 
                placeholder: 'Instruct agent or broadcast parameters...', 
                rows: '2',
                style: 'flex-grow: 1; resize: none; border-radius: 6px; border: 1px solid var(--background-modifier-border); padding: 10px; background: var(--background-primary); font-size: 0.9em;'
            }
        });

        const sendBtn = inputArea.createEl('button', { text: 'RUN', cls: 'mod-cta', attr: { style: 'padding: 8px 16px; height: 42px; font-weight: 700; font-family: var(--font-monospace);' } });

        sendBtn.addEventListener('click', () => { if (!this.isExecuting) this.startAgentLoop(this.inputField.value.trim()); });
        this.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!this.isExecuting) this.startAgentLoop(this.inputField.value.trim());
            }
        });

        this.renderMessages();
    }

    refreshProfileSelector() {
        this.profileSelector.empty();
        this.plugin.settings.profiles.forEach(p => {
            const opt = this.profileSelector.createEl('option', { text: p.name, attr: { value: p.id } });
            if (p.id === this.plugin.settings.activeProfileId) opt.setAttribute('selected', 'selected');
        });
    }

    async loadActiveProfileHistory() {
        const profile = this.plugin.getActiveProfile();
        const jsonPath = `agent-memory/${profile.id}/session_history.json`;
        try {
            if (await this.plugin.app.vault.adapter.exists(jsonPath)) {
                const rawData = await this.plugin.app.vault.adapter.read(jsonPath);
                const parsed = JSON.parse(rawData);
                this.chatHistory = parsed.length > 0 ? parsed : [{ role: 'system', content: profile.systemPrompt }];
            } else {
                this.chatHistory = [{ role: 'system', content: profile.systemPrompt }];
            }
        } catch (e) { this.chatHistory = [{ role: 'system', content: profile.systemPrompt }]; }
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
            new Notice("No active note found to attach.");
            return;
        }
        const content = await this.plugin.app.vault.read(activeFile);
        this.chatHistory.push({
            role: 'system',
            content: `[CONTEXTUAL INJECTION BY USER] Focus on the following file data (${activeFile.path}):\n\n${content}`
        });
        new Notice(`Attached ${activeFile.basename} to agent memory context.`);
    }

    async renderMessages() {
        if (!this.messageContainer) return;
        this.messageContainer.empty();

        for (let i = 1; i < this.chatHistory.length; i++) {
            const msg = this.chatHistory[i];
            
            // Render user injected context visibly as a system block
            if (msg.role === 'system' && msg.content?.startsWith('[CONTEXTUAL INJECTION')) {
                const sysDiv = this.messageContainer.createEl('div', {
                    attr: { style: 'padding: 8px 12px; border-radius: 4px; background: var(--background-secondary-alt); border-left: 2px solid var(--text-muted); font-size: 0.85em; opacity: 0.8;' }
                });
                sysDiv.createEl('strong', { text: '📎 INJECTED FILE CONTEXT', attr: { style: 'display: block; margin-bottom: 4px;' } });
                sysDiv.createEl('span', { text: "Data successfully loaded into agent operational memory." });
                continue;
            }

            if (msg.role === 'system' || msg.role === 'tool' || msg.tool_calls) continue;

            const isUser = msg.role === 'user';
            const msgDiv = this.messageContainer.createEl('div', {
                attr: {
                    style: `padding: 12px 16px; border-radius: 8px; max-width: 95%; box-shadow: 0 2px 8px rgba(0,0,0,0.02); ${
                        isUser ? 'align-self: flex-end; background: var(--interactive-accent); color: var(--text-on-accent);' : 'align-self: flex-start; background: var(--background-secondary); border: 1px solid var(--background-modifier-border);'
                    }`
                }
            });

            msgDiv.createEl('strong', { 
                text: isUser ? 'User //' : `${this.plugin.getActiveProfile().name} //`,
                attr: { style: 'display: block; font-size: 0.75em; text-transform: uppercase; font-family: var(--font-monospace); margin-bottom: 6px;' } 
            });

            const bodyContent = msgDiv.createEl('div', { cls: 'markdown-rendered' });
            await MarkdownRenderer.renderMarkdown(msg.content || '', bodyContent, this.plugin.app.workspace.getActiveFile()?.path || '', this.lifecycleComponent);
        }
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    // -------------------------------------------------------------
    // ASYNC AGENT LOOP ENGINE
    // -------------------------------------------------------------
    async startAgentLoop(initialText?: string) {
        if (initialText) {
            this.inputField.value = '';
            this.chatHistory.push({ role: 'user', content: initialText });
            await this.renderMessages();
        }

        this.isExecuting = true;
        this.abortController = new AbortController();
        const currentProfile = this.plugin.getActiveProfile();
        
        const loadingMsgIndex = this.chatHistory.push({ role: 'assistant', content: '' }) - 1;
        await this.renderMessages();

        const messageDiv = this.messageContainer.lastElementChild as HTMLElement;
        messageDiv.empty();
        messageDiv.createEl('strong', { text: `${currentProfile.name} //`, attr: { style: 'display: block; font-size: 0.75em; text-transform: uppercase; font-family: var(--font-monospace); margin-bottom: 8px;' } });

        const thinkDetails = messageDiv.createEl('details', { attr: { style: 'margin-bottom: 12px; background: var(--background-secondary-alt); border-left: 3px solid var(--interactive-accent); padding: 10px; display: none;' } });
        thinkDetails.createEl('summary', { text: 'Thinking..', attr: { style: 'cursor: pointer; font-size: 0.75em; font-family: var(--font-monospace); font-weight: 600;' } });
        const thinkContent = thinkDetails.createEl('div', { attr: { style: 'font-size: 0.85em; font-family: var(--font-monospace); margin-top: 6px; white-space: pre-wrap;' } });

        const mainContent = messageDiv.createEl('div', { cls: 'markdown-rendered' });

        const exposedTools = McpToolRegistry.getCapabilities().map(t => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema }
        }));

        let pipelineExecutionActive = true;
        let controlIterationLimit = 0;

        while (pipelineExecutionActive && controlIterationLimit < 5) {
            controlIterationLimit++;
            try {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (currentProfile.apiKey) headers['Authorization'] = `Bearer ${currentProfile.apiKey}`;

                const response = await fetch(`${currentProfile.apiUrl}/chat/completions`, {
                    method: 'POST',
                    headers: headers,
                    signal: this.abortController.signal,
                    body: JSON.stringify({
                        model: currentProfile.modelName,
                        messages: this.chatHistory.slice(0, this.chatHistory.length - 1).filter(m => m.content !== ''),
                        temperature: currentProfile.temperature,
                        stream: true,
                        tools: exposedTools
                    })
                });

                if (!response.body) throw new Error("Null JSON stream target error.");
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                
                let fullRawStream = ""; 
                let fullThinking = "";
                let fullContent = "";
                let runtimeDetectedToolCall: any = null;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(line => line.trim() !== '');
                    
                    for (const line of lines) {
                        if (line.replace(/^data: /, '').trim() === '[DONE]') continue;
                        if (line.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(line.slice(6));
                                const delta = parsed.choices[0].delta;
                                
                                if (delta.tool_calls) {
                                    if (!runtimeDetectedToolCall) runtimeDetectedToolCall = { id: "", function: { name: "", arguments: "" } };
                                    const call = delta.tool_calls[0];
                                    if (call.id) runtimeDetectedToolCall.id += call.id;
                                    if (call.function?.name) runtimeDetectedToolCall.function.name += call.function.name;
                                    if (call.function?.arguments) runtimeDetectedToolCall.function.arguments += call.function.arguments;

                                    thinkDetails.style.display = 'block';
                                    thinkDetails.setAttribute('open', '');
                                    thinkContent.innerText = `[ROUTING INSTRUCTION TO MCP CORE]: ${runtimeDetectedToolCall.function.name}\nArgs: ${runtimeDetectedToolCall.function.arguments}`;
                                    continue;
                                }

                                if (delta.content) fullRawStream += delta.content;

                                if (fullRawStream.includes('<think>')) {
                                    const parts = fullRawStream.split('<think>');
                                    const afterThink = parts[1] || "";
                                    if (afterThink.includes('</think>')) {
                                        const splitEnd = afterThink.split('</think>');
                                        fullThinking = splitEnd[0];
                                        fullContent = parts[0] + splitEnd.slice(1).join('</think>');
                                        thinkDetails.removeAttribute('open');
                                    } else {
                                        fullThinking = afterThink;
                                        fullContent = parts[0];
                                        thinkDetails.style.display = 'block';
                                        if (!thinkDetails.hasAttribute('open')) thinkDetails.setAttribute('open', '');
                                    }
                                } else {
                                    fullContent = fullRawStream;
                                }
                                
                                if (delta.reasoning_content) {
                                    fullThinking += delta.reasoning_content;
                                    thinkDetails.style.display = 'block';
                                    if (!thinkDetails.hasAttribute('open')) thinkDetails.setAttribute('open', '');
                                }

                                if (fullThinking) thinkContent.innerText = fullThinking;
                                if (fullContent) {
                                    mainContent.empty();
                                    await MarkdownRenderer.renderMarkdown(fullContent, mainContent, this.plugin.app.workspace.getActiveFile()?.path || '', this.lifecycleComponent);
                                }
                                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
                            } catch (e) {}
                        }
                    }
                }

                // --- TOOL EXECUTION INTERCEPT ROUTING ---
                if (runtimeDetectedToolCall && runtimeDetectedToolCall.function.name) {
                    const parsedArguments = JSON.parse(runtimeDetectedToolCall.function.arguments || '{}');

                    // 1. Destructive Action UI Override (Security sandbox)
                    if (runtimeDetectedToolCall.function.name === 'request_file_deletion') {
                        // We must save the LLM's tool call intent into history before pausing
                        this.chatHistory.splice(this.chatHistory.length - 1, 0, {
                            role: 'assistant', content: null, tool_calls: [{ id: runtimeDetectedToolCall.id, type: 'function', function: runtimeDetectedToolCall.function }]
                        });
                        this.renderDeletionWarning(runtimeDetectedToolCall, parsedArguments, loadingMsgIndex);
                        return; // Halt the automatic loop entirely until user interaction
                    }

                    // 2. Standard Safe Execution Route
                    const trackingObject = {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id: runtimeDetectedToolCall.id, type: 'function', function: runtimeDetectedToolCall.function }]
                    };
                    this.chatHistory.splice(this.chatHistory.length - 1, 0, trackingObject as any);

                    const executionResponseStr = await McpToolRegistry.executeTool(runtimeDetectedToolCall.function.name, parsedArguments, this.plugin);

                    this.chatHistory.splice(this.chatHistory.length - 1, 0, {
                        role: 'tool',
                        tool_call_id: runtimeDetectedToolCall.id,
                        name: runtimeDetectedToolCall.function.name,
                        content: executionResponseStr
                    });
                    continue; // Loop fires again to feed tool result to the model
                } else {
                    this.chatHistory[loadingMsgIndex].content = fullContent;
                    pipelineExecutionActive = false;
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    mainContent.innerText += `\n\n[USER ABORTED EXECUTION]`;
                    this.chatHistory[loadingMsgIndex].content = mainContent.innerText;
                } else {
                    mainContent.innerText = `Agentic Processing Pipeline Error: ${error.message}`;
                }
                pipelineExecutionActive = false;
            }
        }
        
        thinkDetails.removeAttribute('open');
        await this.saveActiveProfileHistory();
        this.isExecuting = false;
        this.abortController = null;
    }

    // --- DELETION SECURITY SANDBOX UI ---
    renderDeletionWarning(toolCall: any, args: any, loadingMsgIndex: number) {
        this.chatHistory.pop(); // Pop the loading index out to make room for the UI
        
        const warningDiv = this.messageContainer.createEl('div', {
            attr: { style: 'padding: 16px; border-radius: 8px; border: 2px solid var(--text-error); background: rgba(255, 0, 0, 0.05); margin-top: 10px;' }
        });

        warningDiv.createEl('strong', { text: 'CRITICAL ACTION AUTHORIZATION', attr: { style: 'display: block; color: var(--text-error); font-family: var(--font-monospace); font-size: 0.9em; margin-bottom: 8px;' } });
        warningDiv.createEl('p', { text: `The agent is requesting to delete the following file:`, attr: { style: 'margin: 0 0 4px 0;' } });
        warningDiv.createEl('code', { text: args.path, attr: { style: 'display: block; padding: 6px; background: var(--background-primary); border-radius: 4px; margin-bottom: 10px; font-weight: bold;' } });
        warningDiv.createEl('p', { text: `Agent's Reason: "${args.reason}"`, attr: { style: 'font-style: italic; opacity: 0.8; font-size: 0.9em; margin-bottom: 12px;' } });

        const btnRow = warningDiv.createEl('div', { attr: { style: 'display: flex; gap: 10px;' } });
        const acceptBtn = btnRow.createEl('button', { text: 'AUTHORIZE DELETION', attr: { style: 'background: var(--text-error); color: white; border: none; font-weight: bold;' } });
        const declineBtn = btnRow.createEl('button', { text: 'DECLINE' });

        acceptBtn.addEventListener('click', async () => {
            warningDiv.empty();
            warningDiv.createEl('p', { text: `Processing deletion...` });
            let resultStatus = "";
            try {
                const file = this.plugin.app.vault.getAbstractFileByPath(args.path);
                if (file instanceof TFile) {
                    await this.plugin.app.vault.trash(file, true);
                    resultStatus = "System Success: File has been permanently deleted.";
                } else resultStatus = "System Error: File does not exist.";
            } catch (e) { resultStatus = `System Error: ${e.message}`; }

            this.chatHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStatus });
            warningDiv.remove();
            this.startAgentLoop(); 
        });

        declineBtn.addEventListener('click', () => {
            this.chatHistory.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: "USER DENIED PERMISSION. The file was NOT deleted." });
            warningDiv.remove();
            this.startAgentLoop(); 
        });

        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    async onClose() { this.lifecycleComponent.unload(); }
}

class HyokaSettingTab extends PluginSettingTab {
    plugin: HyokaPlugin;
    constructor(app: any, plugin: HyokaPlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Hyoka Control Panel' });
        containerEl.createEl('p', { text: 'Manage localized orchestration pipelines and execution metrics.', attr: { style: 'font-size: 0.9em; color: var(--text-muted); margin-bottom: 24px;' } });

        this.plugin.settings.profiles.forEach((profile) => {
            const card = containerEl.createEl('div', { cls: 'hyoka-setting-card' });
            card.createEl('h4', { text: `Runtime Core Instance: ${profile.name}` });

            new Setting(card).setName('Visual Persona Label').addText(text => text.setValue(profile.name).onChange(async (v) => { profile.name = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('Target REST Base Path').addText(text => text.setValue(profile.apiUrl).onChange(async (v) => { profile.apiUrl = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('Model Identifier Flag').addText(text => text.setValue(profile.modelName).onChange(async (v) => { profile.modelName = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('Authentication Credentials Key').addText(text => text.setPlaceholder('sk-... (Leave empty for local loops)').setValue(profile.apiKey).onChange(async (v) => { profile.apiKey = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('System Context Directives').addTextArea(text => text.setValue(profile.systemPrompt).onChange(async (v) => { profile.systemPrompt = v; await this.plugin.saveSettings(); }));
        });

        const actionWrapper = containerEl.createEl('div', { attr: { style: 'display: flex; justify-content: flex-end; margin-top: 16px;' } });
        const addBtn = actionWrapper.createEl('button', { text: '+ Deploy Independent Agent Instance', cls: 'mod-cta' });
        addBtn.addEventListener('click', async () => {
            const runtimeId = `persona-${Date.now()}`;
            this.plugin.settings.profiles.push({
                id: runtimeId, name: 'Auxiliary Worker Drone', apiUrl: 'http://127.0.0.1:8080/v1', modelName: 'google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0', apiKey: '', systemPrompt: 'You are an explicit micro-task computational node persona instance.', temperature: 0.3
            });
            await this.plugin.saveSettings();
            await this.plugin.initializeAgentWorkspace();
            this.display();
        });
    }
}