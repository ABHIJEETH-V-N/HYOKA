import {
    App,
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
    Modal,
    FuzzySuggestModal,
    setIcon
} from 'obsidian';

const VIEW_CHAT = "hyoka-chat-view";
const VIEW_PREVIEW = "hyoka-preview-view";
const VIEW_SLIDES = "hyoka-slides-view";
const AGENT_MEMORY_ROOT = "agent-memory";

const WEBSITE_SYSTEM_PROMPT =
    'You are a high-performance frontend generator. You write a single self-contained HTML5 file. Use Tailwind via the CDN script tag ' +
    '(<script src="https://cdn.tailwindcss.com"></script>) and Tailwind utility classes for ALL styling. ' +
    'Do not write a separate <style> block unless absolutely necessary. Inline any needed <script>. ' +
    'Respond with ONLY the raw HTML, starting at <!DOCTYPE html> — no markdown code fences, no commentary, no opinions. ' +
    'If you need a placeholder image, use an <img> pointing at https://picsum.photos/seed/<short-slug>/<width>/<height> ' +
    'Make it visually polished, responsive, and clean.';

// ================================================================
// SETTINGS
// ================================================================
interface AgentProfile {
    id: string;
    name: string;
    apiUrl: string;
    modelName: string;
    apiKey: string;
    systemPrompt: string;
    temperature: number;
    maxContextTokens: number;
}

interface HyokaSettings {
    profiles: AgentProfile[];
    activeProfileId: string;
    scraperUrl: string;
    scraperApiKey: string;
    autoApproveCommands: boolean;
    enableWebSearch: boolean;
    enableImageLookup: boolean;
    hyperizedMode: boolean;
}

function freshProfile(name = 'Agent'): AgentProfile {
    return {
        id: `profile-${Date.now()}`,
        name,
        apiUrl: 'http://127.0.0.1:8080/v1',
        modelName: 'gemma-4',
        apiKey: '',
        systemPrompt: 'You are an autonomous engineering agent operating directly inside the user\'s Obsidian vault. Execute commands, write robust code, and do not provide conversational filler. Call tools to accomplish tasks.',
        temperature: 0.1,
        maxContextTokens: 128000
    };
}

const DEFAULT_SETTINGS: HyokaSettings = {
    profiles: [
        {
            id: 'sys-core',
            name: 'Core',
            apiUrl: 'http://127.0.0.1:8080/v1',
            modelName: 'gemma-4',
            apiKey: '',
            systemPrompt: 'You are an autonomous systems engineering agent. You build robust code using your tools. Never describe what you would do — call the tool. Keep prose terse.',
            temperature: 0.1,
            maxContextTokens: 128000
        }
    ],
    activeProfileId: 'sys-core',
    scraperUrl: '',
    scraperApiKey: '',
    autoApproveCommands: false,
    enableWebSearch: true,
    enableImageLookup: true,
    hyperizedMode: false
};

// ================================================================
// TYPES
// ================================================================
interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: any[];
    tool_call_id?: string;
}

// ================================================================
// TOOL REGISTRY
// ================================================================
class McpToolRegistry {
    static getCapabilities(plugin: HyokaPlugin): any[] {
        const tools: any[] = [
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

    static asOpenAiTools(plugin: HyokaPlugin) {
        return this.getCapabilities(plugin).map(t => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema }
        }));
    }

    static async executeTool(name: string, args: any, plugin: HyokaPlugin): Promise<string> {
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
                if (!(await vault.adapter.exists(args.path))) return `Error: file not found at ${args.path}`;
                const current = await vault.adapter.read(args.path);
                if (!current.includes(args.find)) return `Error: 'find' text not found in ${args.path}.`;
                await vault.adapter.write(args.path, current.replace(args.find, args.replace));
                plugin.notifyLiveUpdate(args.path);
                return `Patched ${args.path}`;
            }

            if (name === "read_note") {
                if (!(await vault.adapter.exists(args.path))) return `Error: file not found at ${args.path}`;
                return `[CONTENT OF ${args.path}]:\n${await vault.adapter.read(args.path)}`;
            }

            if (name === "list_files") {
                const folder = args.folder || '';
                const all = vault.getFiles().map(f => f.path).filter(p => p.startsWith(folder));
                return all.length ? all.join('\n') : `No files under ${folder || '(root)'}`;
            }

            if (name === "run_command") return await plugin.commandRunner.request(args.command, args.cwd);

            if (name === "search_web") {
                try {
                    const res = await requestUrl({ url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`, method: 'GET' });
                    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
                    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
                    const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                    const titles: string[] = []; let m;
                    while ((m = linkRe.exec(res.text)) !== null && titles.length < 5) titles.push(strip(m[2]));
                    const snippets: string[] = [];
                    while ((m = snippetRe.exec(res.text)) !== null && snippets.length < 5) snippets.push(strip(m[1]));
                    if (titles.length === 0) return `No web results found.`;
                    return titles.map((t, i) => `${i + 1}. ${t}\n   ${snippets[i] || ''}`).join('\n');
                } catch (e: any) {
                    return `Network error: Offline or unreachable. Proceed without web data.`;
                }
            }

            if (name === "scrape_web") {
                try {
                    const res = await requestUrl({
                        url: plugin.settings.scraperUrl, method: 'POST', contentType: 'application/json',
                        headers: plugin.settings.scraperApiKey ? { 'Authorization': `Bearer ${plugin.settings.scraperApiKey}` } : undefined,
                        body: JSON.stringify({ url: args.url, selector: args.selector || null })
                    });
                    return `[SCRAPED CONTENT FROM ${args.url}]:\n${res.text.substring(0, 15000)}`;
                } catch (e: any) {
                    return `Scraper offline or unreachable.`;
                }
            }

            throw new Error(`Unregistered tool: ${name}`);
        } catch (e: any) {
            return `Tool execution failed: ${e.message}`;
        }
    }
}

async function ensureParentFolders(plugin: HyokaPlugin, path: string) {
    const parts = path.split('/').slice(0, -1);
    let acc = '';
    for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        if (!(await plugin.app.vault.adapter.exists(acc))) await plugin.app.vault.createFolder(acc);
    }
}

// ================================================================
// COMMAND RUNNER
// ================================================================
class CommandRunner {
    plugin: HyokaPlugin;
    constructor(plugin: HyokaPlugin) { this.plugin = plugin; }

    async request(command: string, cwd?: string): Promise<string> {
        if (!this.plugin.settings.autoApproveCommands) {
            const approved = await new Promise<boolean>((resolve) => new CommandConfirmModal(this.plugin.app, command, cwd || 'Vault Root', resolve).open());
            if (!approved) return `User declined to run: ${command}`;
        }
        return this.execute(command, cwd);
    }

    private execute(command: string, relativeCwd?: string): Promise<string> {
        return new Promise((resolve) => {
            try {
                // @ts-ignore Node execution context
                const { exec } = require('child_process');
                const adapter: any = this.plugin.app.vault.adapter;
                const basePath = adapter.getBasePath ? adapter.getBasePath() : '';
                
                let targetCwd = basePath;
                if (relativeCwd && basePath) targetCwd = `${basePath}/${relativeCwd}`;

                exec(command, { cwd: targetCwd, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
                    resolve(err
                        ? `Error.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr || err.message}`
                        : `Success.\nSTDOUT:\n${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`);
                });
            } catch (e: any) {
                resolve(`Execution environment unavailable: ${e.message}`);
            }
        });
    }
}

class CommandConfirmModal extends Modal {
    constructor(app: App, private command: string, private cwd: string, private cb: (v: boolean) => void) { super(app); }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'SYS_EXEC', attr: { style: 'font-family: var(--font-monospace); color: var(--text-normal); font-weight: normal; margin-bottom: 4px;' } });
        contentEl.createEl('div', { text: `cwd: ${this.cwd}`, attr: { style: 'font-size: 0.8em; font-family: var(--font-monospace); color: var(--text-muted); margin-bottom: 12px;' } });
        contentEl.createEl('div', { text: this.command, attr: { style: 'background:var(--background-secondary); border: 1px solid var(--background-modifier-border); padding:10px; font-family: var(--font-monospace); font-size: 0.9em;' } });
        const row = contentEl.createEl('div', { attr: { style: 'display:flex; gap:8px; justify-content:flex-end; margin-top:16px;' } });
        
        const denyBtn = row.createEl('button', { cls: 'hyoka-btn-flat' });
        setIcon(denyBtn, 'x');
        denyBtn.appendChild(document.createTextNode(' Deny'));
        denyBtn.onclick = () => { this.cb(false); this.close(); };

        const runBtn = row.createEl('button', { cls: 'hyoka-btn-flat' });
        runBtn.style.color = 'var(--text-normal)';
        runBtn.style.borderColor = 'var(--text-normal)';
        setIcon(runBtn, 'play');
        runBtn.appendChild(document.createTextNode(' Exec'));
        runBtn.onclick = () => { this.cb(true); this.close(); };
    }
    onClose() { this.contentEl.empty(); }
}

// ================================================================
// MAIN PLUGIN
// ================================================================
export default class HyokaPlugin extends Plugin {
    settings!: HyokaSettings;
    commandRunner!: CommandRunner;

    async onload() {
        await this.loadSettings();
        this.commandRunner = new CommandRunner(this);
        await this.initializeMemoryFolders();
        this.injectStyles();

        this.registerView(VIEW_CHAT, (leaf) => new HyokaChatView(leaf, this));
        this.registerView(VIEW_PREVIEW, (leaf) => new HyokaPreviewView(leaf, this));
        this.registerView(VIEW_SLIDES, (leaf) => new HyokaSlideView(leaf, this));

        this.addRibbonIcon('terminal-square', 'SYS_CTRL', () => this.activateChatView());
        this.addSettingTab(new HyokaSettingTab(this.app, this));
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
    getActiveProfile(): AgentProfile { return this.settings.profiles.find(p => p.id === this.settings.activeProfileId) || this.settings.profiles[0]; }

    async initializeMemoryFolders() {
        if (!(await this.app.vault.adapter.exists(AGENT_MEMORY_ROOT))) await this.app.vault.createFolder(AGENT_MEMORY_ROOT);
        for (const profile of this.settings.profiles) {
            const dir = `${AGENT_MEMORY_ROOT}/${profile.id}`;
            if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.createFolder(dir);
            const hist = `${dir}/session_history.json`;
            if (!(await this.app.vault.adapter.exists(hist))) await this.app.vault.create(hist, JSON.stringify([]));
        }
    }

    injectStyles() {
        const id = 'hyoka-minimal-ux';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
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
            if (rightLeaf) { leaf = rightLeaf; await leaf.setViewState({ type: VIEW_CHAT, active: true }); }
        }
        if (leaf) workspace.revealLeaf(leaf);
    }

    refreshChatViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_CHAT)) {
            (leaf.view as HyokaChatView).refreshProfileSelector();
        }
    }

    notifyLiveUpdate(path: string) { 
        this.app.workspace.trigger('hyoka:file-updated', path); 
    }

    async callModelOnce(profile: AgentProfile, messages: ChatMessage[]): Promise<string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (profile.apiKey) headers['Authorization'] = `Bearer ${profile.apiKey}`;
        const res = await requestUrl({
            url: `${profile.apiUrl}/chat/completions`, method: 'POST', headers,
            body: JSON.stringify({ model: profile.modelName, messages, temperature: 0.1, stream: false })
        });
        const data = JSON.parse(res.text);
        return data?.choices?.[0]?.message?.content || '';
    }

    estimateTokens(text: string): number { return Math.ceil((text || '').length / 4); }
}


// ================================================================
// FILE PICKER 
// ================================================================
class FilePickerModal extends FuzzySuggestModal<TFile> {
    constructor(app: App, private exclude: TFile[], private onPick: (files: TFile[]) => void) { super(app); }
    getItems(): TFile[] { const excl = new Set(this.exclude.map(f => f.path)); return this.app.vault.getFiles().filter(f => !excl.has(f.path)); }
    getItemText(item: TFile): string { return item.path; }
    onChooseItem(item: TFile) { this.onPick([item]); }
}

// ================================================================
// LIVE PREVIEW VIEW (Dynamic File Dropdown)
// ================================================================
export class HyokaPreviewView extends ItemView {
    plugin: HyokaPlugin;
    iframe!: HTMLIFrameElement;
    fileSelect!: HTMLSelectElement;
    targetPath: string = "";

    constructor(leaf: WorkspaceLeaf, plugin: HyokaPlugin) { super(leaf); this.plugin = plugin; }
    getViewType(): string { return VIEW_PREVIEW; }
    getDisplayText(): string { return "RENDER"; }
    getIcon(): string { return "layout-template"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.style.padding = "0";
        container.style.overflow = "hidden";
        container.style.display = "flex";
        container.style.flexDirection = "column";

        const toolbar = container.createEl('div', { cls: 'hyoka-web-toolbar' });
        const refreshBtn = toolbar.createEl('button', { cls: 'hyoka-btn-icon' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = () => this.refreshFileList(this.targetPath);
        
        this.fileSelect = toolbar.createEl('select', { cls: 'hyoka-web-select' });
        this.fileSelect.onchange = () => {
            this.targetPath = this.fileSelect.value;
            this.reload();
        };

        this.iframe = container.createEl('iframe', { attr: { style: "width:100%; flex-grow:1; border:none; background:white;", sandbox: "allow-scripts allow-modals allow-forms allow-popups" } });

        this.refreshFileList();

        this.registerEvent(this.app.vault.on('create', () => this.refreshFileList(this.targetPath)));
        this.registerEvent(this.app.vault.on('delete', () => this.refreshFileList()));
        this.registerEvent(this.app.vault.on('rename', () => this.refreshFileList()));

        this.registerEvent(this.app.vault.on('modify', async (file) => { 
            if (file instanceof TFile && file.path === this.targetPath) await this.reload(); 
        }));
        this.registerEvent((this.app.workspace as any).on('hyoka:file-updated', async (path: string) => { 
            if (path.endsWith('.html')) this.refreshFileList(path);
            if (path === this.targetPath) await this.reload(); 
        }));
    }

    refreshFileList(forceSelectPath?: string) {
        const htmlFiles = this.app.vault.getFiles().filter(f => f.extension === 'html');
        this.fileSelect.empty();
        
        if (htmlFiles.length === 0) {
            this.fileSelect.createEl('option', { text: 'No .html files in vault', attr: { value: '' } });
            this.targetPath = '';
            this.reload();
            return;
        }

        htmlFiles.sort((a, b) => b.stat.mtime - a.stat.mtime); // Newest first

        let selectedMatched = false;
        htmlFiles.forEach(f => {
            const opt = this.fileSelect.createEl('option', { text: f.path, attr: { value: f.path } });
            if (forceSelectPath && f.path === forceSelectPath) {
                opt.selected = true;
                selectedMatched = true;
                this.targetPath = f.path;
            }
        });

        if (!selectedMatched && htmlFiles.length > 0) {
            if (!htmlFiles.find(f => f.path === this.targetPath)) {
                this.targetPath = htmlFiles[0].path;
                this.fileSelect.value = this.targetPath;
            } else {
                this.fileSelect.value = this.targetPath;
            }
        }
        this.reload();
    }

    setTarget(path: string) { 
        this.refreshFileList(path); 
    }

    injectHtmlStream(html: string) {
        this.iframe.srcdoc = html;
    }

    async reload() {
        if (!this.targetPath) {
            this.iframe.srcdoc = `<body style="font-family:monospace;padding:2em;color:#666;background:#111;">NO TARGET SELECTED</body>`;
            return;
        }
        try {
            if (!(await this.app.vault.adapter.exists(this.targetPath))) return;
            this.iframe.srcdoc = await this.app.vault.adapter.read(this.targetPath);
        } catch (e: any) { }
    }
}

// ================================================================
// SLIDE DECK VIEW
// ================================================================
export class HyokaSlideView extends ItemView {
    plugin: HyokaPlugin;
    
    constructor(leaf: WorkspaceLeaf, plugin: HyokaPlugin) { super(leaf); this.plugin = plugin; }
    getViewType(): string { return VIEW_SLIDES; }
    getDisplayText(): string { return "SLIDES"; }
    getIcon(): string { return "presentation"; }
    
    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        const stage = container.createEl('div', { attr: { style: 'width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-family:monospace; color:var(--text-muted);' } });
        stage.setText('Slide deck compiler ready.');
    }
}

// ================================================================
// CHAT VIEW
// ================================================================
class HyokaChatView extends ItemView {
    plugin: HyokaPlugin;
    chatHistory: ChatMessage[] = [];
    attachedFiles: TFile[] = [];
    messageContainer!: HTMLDivElement;
    inputField!: HTMLTextAreaElement;
    profileSelector!: HTMLSelectElement;
    attachRow!: HTMLElement;
    ctxFill!: HTMLElement;
    ctxLabel!: HTMLElement;
    lifecycle: Component;
    isExecuting = false;
    abortController: AbortController | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HyokaPlugin) { super(leaf); this.plugin = plugin; this.lifecycle = new Component(); }
    getViewType(): string { return VIEW_CHAT; }
    getDisplayText(): string { return "SYS_CTRL"; }
    getIcon(): string { return "terminal"; }

    async onOpen() {
        this.lifecycle.load();
        await this.loadHistory();

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        const wrapper = container.createEl('div', { attr: { style: 'display:flex; flex-direction:column; height:100%; padding:16px; font-family: var(--font-monospace); background: var(--background-primary);' } });

        // Header controls
        const headerTop = wrapper.createEl('div', { attr: { style: 'display:flex; gap:16px; align-items:center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px; margin-bottom: 12px;' } });
        
        const identityDiv = headerTop.createEl('div', { attr: { style: 'display:flex; align-items:center; gap: 8px; flex: 1;' }});
        setIcon(identityDiv.createEl('span', { attr: { style: 'color: var(--text-muted); display: flex;' }}), 'cpu');
        this.profileSelector = identityDiv.createEl('select', { cls: 'hyoka-select' });
        this.refreshProfileSelector();
        this.profileSelector.addEventListener('change', async () => {
            this.plugin.settings.activeProfileId = this.profileSelector.value;
            await this.plugin.saveSettings();
            this.updateContextBar();
        });

        // Quick Actions
        const quickActions = headerTop.createEl('div', { attr: { style: 'display:flex; gap:8px;' } });
        
        const btnWeb = quickActions.createEl('button', { cls: 'hyoka-btn-icon' });
        setIcon(btnWeb, 'globe');
        btnWeb.onclick = () => this.runTurn('Build a responsive webpage for a modern landing page.');

        const btnSvg = quickActions.createEl('button', { cls: 'hyoka-btn-icon' });
        setIcon(btnSvg, 'image');
        btnSvg.onclick = () => { this.inputField.value = 'Design a clean SVG logo. Respond ONLY with raw <svg>...</svg> markup.'; this.inputField.focus(); };

        const btnStop = quickActions.createEl('button', { cls: 'hyoka-btn-icon' });
        setIcon(btnStop, 'square');
        btnStop.onclick = () => { if (this.abortController && this.isExecuting) { this.abortController.abort(); new Notice('SIGINT SENT.'); } };

        const btnClear = quickActions.createEl('button', { cls: 'hyoka-btn-icon' });
        setIcon(btnClear, 'rotate-ccw');
        btnClear.onclick = () => {
            this.chatHistory = [{ role: 'system', content: this.getSystemPrompt() }];
            this.saveHistory(); this.renderMessages();
        };

        // Main Chat Area
        this.messageContainer = wrapper.createEl('div', { attr: { style: 'flex-grow:1; overflow-y:auto; display:flex; flex-direction:column; gap:20px; padding-right:8px; margin-bottom: 12px;' } });

        // Memory Bar
        const ctxWrap = wrapper.createEl('div', { attr: { style: 'display:flex; flex-direction:column; margin-bottom: 12px;' } });
        this.ctxLabel = ctxWrap.createEl('div', { text: 'MEM 0%', attr: { style: 'font-size:0.75em; color:var(--text-muted); align-self: flex-end;' } });
        const track = ctxWrap.createEl('div', { cls: 'hyoka-ctx-bar-track' });
        this.ctxFill = track.createEl('div', { cls: 'hyoka-ctx-bar-fill' });
        this.updateContextBar();

        this.attachRow = wrapper.createEl('div', { attr: { style: 'display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom: 8px;' } });
        this.renderAttachments();

        // Input Area
        const inputArea = wrapper.createEl('div', { attr: { style: 'display:flex; flex-direction:column; gap:6px;' } });
        
        const attachBtn = inputArea.createEl('button', { cls: 'hyoka-btn-flat', attr: { style: 'align-self: flex-start; padding: 2px 6px; font-size: 0.75em;' } });
        setIcon(attachBtn, 'paperclip');
        attachBtn.appendChild(document.createTextNode(' File'));
        attachBtn.onclick = () => new FilePickerModal(this.app, this.attachedFiles, (files) => {
            this.attachedFiles.push(...files);
            this.renderAttachments();
        }).open();

        const inputRow = inputArea.createEl('div', { attr: { style: 'display:flex; gap:8px; align-items:flex-end;' } });
        this.inputField = inputRow.createEl('textarea', {
            attr: { placeholder: 'INPUT...', rows: '1', style: 'flex-grow:1; resize:none; border: none; border-bottom: 1px solid var(--background-modifier-border); border-radius: 0; padding:8px 0; background:transparent; font-family:var(--font-monospace); font-size:0.9em; outline: none;' }
        });
        
        this.inputField.addEventListener('input', () => {
            this.inputField.style.height = 'auto';
            this.inputField.style.height = Math.min(this.inputField.scrollHeight, 120) + 'px';
        });

        const execBtn = inputRow.createEl('button', { cls: 'hyoka-btn-icon', attr: { style: 'padding: 8px;' } });
        setIcon(execBtn, 'play');
        execBtn.style.color = 'var(--text-normal)';
        execBtn.onclick = () => { if (!this.isExecuting) this.runTurn(this.inputField.value.trim()); };
        
        this.inputField.addEventListener('keydown', (e) => { 
            if (e.key === 'Enter' && !e.shiftKey) { 
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
            prompt += '\n\n[SYS_OVR: HYPERIZED MODE ACTIVE. When generating markdown responses, freely embed interactive HTML, CSS, and Tailwind directly within the markdown to construct highly advanced, visually rich notes.]';
        }
        return prompt;
    }

    renderAttachments() {
        this.attachRow.empty();
        for (const file of this.attachedFiles) {
            const chip = this.attachRow.createEl('span', { cls: 'hyoka-chip' });
            chip.createEl('span', { text: file.basename });
            const x = chip.createEl('span', { cls: 'x' });
            setIcon(x, 'x');
            x.onclick = () => { this.attachedFiles = this.attachedFiles.filter(f => f !== file); this.renderAttachments(); };
        }
    }

    private async buildAttachmentContext(): Promise<string> {
        if (this.attachedFiles.length === 0) return '';
        let out = '[INJECTED FILE CONTEXT]\n';
        for (const f of this.attachedFiles) {
            const content = await this.plugin.app.vault.read(f);
            out += `\n--- ${f.path} ---\n${content}\n`;
        }
        return out;
    }

    refreshProfileSelector() {
        this.profileSelector.empty();
        this.plugin.settings.profiles.forEach(p => {
            const opt = this.profileSelector.createEl('option', { text: p.name, attr: { value: p.id } });
            if (p.id === this.plugin.settings.activeProfileId) opt.setAttribute('selected', 'selected');
        });
    }

    updateContextBar() {
        const profile = this.plugin.getActiveProfile();
        const used = this.plugin.estimateTokens(this.chatHistory.map(m => m.content || '').join('\n'));
        const max = profile.maxContextTokens || 128000;
        const pct = Math.min(100, Math.round((used / max) * 100));
        this.ctxLabel.setText(`MEM ${pct}% [${used.toLocaleString()}/${max.toLocaleString()}]`);
        this.ctxFill.style.width = `${pct}%`;
        this.ctxFill.style.background = pct > 85 ? 'var(--text-error)' : pct > 60 ? 'var(--text-warning)' : 'var(--text-normal)';
    }

    private historyPath(): string {
        const profile = this.plugin.getActiveProfile();
        return `${AGENT_MEMORY_ROOT}/${profile.id}/session_history.json`;
    }

    async loadHistory() {
        const path = this.historyPath();
        try {
            if (await this.plugin.app.vault.adapter.exists(path)) {
                const parsed = JSON.parse(await this.plugin.app.vault.adapter.read(path));
                this.chatHistory = parsed.length ? parsed : [{ role: 'system', content: this.getSystemPrompt() }];
            } else {
                this.chatHistory = [{ role: 'system', content: this.getSystemPrompt() }];
            }
        } catch { this.chatHistory = [{ role: 'system', content: this.getSystemPrompt() }]; }
    }

    async saveHistory() { 
        this.chatHistory[0].content = this.getSystemPrompt(); // ensure mode changes sync
        await this.plugin.app.vault.adapter.write(this.historyPath(), JSON.stringify(this.chatHistory, null, 2)); 
    }

    async renderMessages() {
        if (!this.messageContainer) return;
        this.messageContainer.empty();
        for (let i = 1; i < this.chatHistory.length; i++) {
            const msg = this.chatHistory[i];
            if (msg.role === 'system' || msg.role === 'tool' || msg.tool_calls) continue;
            
            const isUser = msg.role === 'user';
            
            const wrapperDiv = this.messageContainer.createEl('div', { cls: 'hyoka-msg-hover-container', attr: { style: 'position: relative; display: flex; flex-direction: column;' }});
            
            const div = wrapperDiv.createEl('div', {
                attr: { style: `padding-bottom:12px; font-size: 0.9em; ${isUser ? 'align-self:flex-end; text-align: right; border-right: 1px solid var(--text-normal); padding-right: 12px;' : 'align-self:flex-start; text-align: left; border-left: 1px solid var(--background-modifier-border); padding-left: 12px;'}` }
            });
            
            const copyBtn = wrapperDiv.createEl('button', { cls: 'hyoka-msg-copy' });
            setIcon(copyBtn, 'copy');
            copyBtn.appendChild(document.createTextNode(' CPY'));
            if (isUser) { copyBtn.style.right = '16px'; copyBtn.style.top = '-8px'; }
            else { copyBtn.style.left = '16px'; copyBtn.style.right = 'auto'; copyBtn.style.top = '-8px'; }
            
            copyBtn.onclick = (e) => { 
                e.stopPropagation(); 
                navigator.clipboard.writeText(msg.content || ''); 
                copyBtn.innerHTML = '';
                setIcon(copyBtn, 'check');
                copyBtn.appendChild(document.createTextNode(' OK'));
                setTimeout(() => {
                    copyBtn.innerHTML = '';
                    setIcon(copyBtn, 'copy');
                    copyBtn.appendChild(document.createTextNode(' CPY'));
                }, 1500); 
                new Notice("COPIED");
            };

            div.createEl('div', { text: isUser ? 'USR' : `SYS`, attr: { style: 'font-size:0.7em; color:var(--text-muted); margin-bottom:6px;' } });
            const body = div.createEl('div', { cls: 'markdown-rendered' });
            await MarkdownRenderer.renderMarkdown(msg.content || '', body, '', this.lifecycle);
        }
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        this.updateContextBar();
    }

    async runTurn(text: string) {
        const attachmentContext = await this.buildAttachmentContext();
        if (text) {
            this.inputField.value = '';
            this.inputField.style.height = 'auto';
            const full = attachmentContext ? `${attachmentContext}\n\n${text}` : text;
            this.chatHistory.push({ role: 'user', content: full });
            await this.renderMessages();
        }

        if (text && /\b(website|ui|html|frontend)\b/i.test(text)) {
            await this.buildWebsiteLive(text);
            return;
        }
        await this.runAgentLoop();
    }

    private generateSlug(prompt: string): string {
        const base = prompt.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 15).toLowerCase().replace(/^-|-$/g, '');
        return `ui-${base || 'gen'}-${Math.floor(Date.now() / 1000).toString().slice(-4)}.html`;
    }

    private async buildWebsiteLive(prompt: string) {
        this.isExecuting = true;
        this.abortController = new AbortController();
        const profile = this.plugin.getActiveProfile();
        
        const filename = this.generateSlug(prompt);
        const targetPath = filename;

        const previewLeaf = this.app.workspace.getLeavesOfType(VIEW_PREVIEW)[0] || this.app.workspace.getRightLeaf(true);
        if (previewLeaf) {
            await previewLeaf.setViewState({ type: VIEW_PREVIEW, active: true });
            this.app.workspace.revealLeaf(previewLeaf);
            (previewLeaf.view as HyokaPreviewView).setTarget(targetPath);
        }

        const loadingIndex = this.chatHistory.push({ role: 'assistant', content: '' }) - 1;
        await this.renderMessages();
        const msgDiv = this.messageContainer.lastElementChild?.querySelector('div:last-child') as HTMLElement;
        if(msgDiv) {
            msgDiv.empty();
            msgDiv.createEl('div', { text: `SYS // UI PIPELINE -> ${filename}`, attr: { style: 'font-size:0.7em; color:var(--text-normal); margin-bottom:6px;' } });
        }
        
        const mainContent = msgDiv?.createEl('div', { attr: { style: 'font-size:0.85em; color:var(--text-muted);' }, text: 'Streaming...' });

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (profile.apiKey) headers['Authorization'] = `Bearer ${profile.apiKey}`;
            const messages: ChatMessage[] = [
                { role: 'system', content: WEBSITE_SYSTEM_PROMPT },
                ...this.chatHistory.slice(1, -1).filter(m => m.role === 'user' || m.role === 'assistant').filter(m => m.content),
                { role: 'user', content: prompt }
            ];
            
            const response = await fetch(`${profile.apiUrl}/chat/completions`, {
                method: 'POST', headers, signal: this.abortController.signal,
                body: JSON.stringify({ model: profile.modelName, messages, temperature: 0.1, stream: true })
            });
            
            if (!response.body) throw new Error('No stream.');
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let raw = '';
            
            const view = previewLeaf?.view as HyokaPreviewView;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n').filter(l => l.trim())) {
                    if (!line.startsWith('data: ')) continue;
                    if (line.slice(6).trim() === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(line.slice(6));
                        const delta = parsed.choices[0].delta;
                        if (delta.content) { 
                            raw += delta.content; 
                            const cleanHtml = raw.replace(/```html/gi, '').replace(/```/g, '');
                            if (view) view.injectHtmlStream(cleanHtml);
                            if (mainContent) mainContent.setText(`Compiled bytes: ${raw.length}`);
                        }
                    } catch { }
                }
            }
            
            const finalHtml = raw.replace(/```html/gi, '').replace(/```/g, '').trim();
            await ensureParentFolders(this.plugin, targetPath);
            await this.plugin.app.vault.adapter.write(targetPath, finalHtml); 
            
            if (mainContent) mainContent.setText(`UI written to ${targetPath}.`);
            this.chatHistory[loadingIndex].content = `UI compiled to \`${targetPath}\`.`;

        } catch (err: any) {
            if (err.name !== 'AbortError') this.chatHistory[loadingIndex].content = `Pipeline failure: ${err.message}`;
        }

        await this.saveHistory();
        await this.renderMessages();
        this.isExecuting = false;
    }

    private async runAgentLoop() {
        this.isExecuting = true;
        this.abortController = new AbortController();
        const profile = this.plugin.getActiveProfile();

        let iterations = 0;
        const MAX_ITER = 7;

        while (iterations < MAX_ITER) {
            iterations++;
            const loadingIndex = this.chatHistory.push({ role: 'assistant', content: '' }) - 1;
            await this.renderMessages();
            
            const msgDiv = this.messageContainer.lastElementChild?.querySelector('div:last-child') as HTMLElement;
            if (msgDiv) {
                msgDiv.empty();
                msgDiv.createEl('div', { text: `SYS`, attr: { style: 'font-size:0.7em; color:var(--text-muted); margin-bottom:6px;' } });
            }
            
            const processLog = msgDiv?.createEl('div', { attr: { style: 'font-size: 0.75em; color: var(--text-normal); margin-bottom: 8px;' } });
            const mainContent = msgDiv?.createEl('div', { cls: 'markdown-rendered' });

            let fullContent = '';
            let toolCall: any = null;

            try {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (profile.apiKey) headers['Authorization'] = `Bearer ${profile.apiKey}`;
                const response = await fetch(`${profile.apiUrl}/chat/completions`, {
                    method: 'POST', headers, signal: this.abortController.signal,
                    body: JSON.stringify({
                        model: profile.modelName,
                        messages: this.chatHistory.slice(0, -1).filter(m => m.content !== ''),
                        temperature: profile.temperature, stream: true,
                        tools: McpToolRegistry.asOpenAiTools(this.plugin)
                    })
                });
                
                if (!response.body) throw new Error('Stream failed.');
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    for (const line of chunk.split('\n').filter(l => l.trim())) {
                        if (!line.startsWith('data: ')) continue;
                        if (line.slice(6).trim() === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            const delta = parsed.choices[0].delta;
                            if (delta.tool_calls) {
                                if (!toolCall) toolCall = { id: '', function: { name: '', arguments: '' } };
                                const call = delta.tool_calls[0];
                                if (call.id) toolCall.id += call.id;
                                if (call.function?.name) toolCall.function.name += call.function.name;
                                if (call.function?.arguments) toolCall.function.arguments += call.function.arguments;
                                if(processLog) processLog.setText(`EXEC: ${toolCall.function.name}...`);
                                continue;
                            }
                            if (delta.content) { 
                                fullContent += delta.content; 
                                if(mainContent) {
                                    mainContent.empty(); 
                                    await MarkdownRenderer.renderMarkdown(fullContent, mainContent, '', this.lifecycle);
                                }
                                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
                            }
                        } catch { }
                    }
                }
            } catch (err: any) {
                if (err.name === 'AbortError') { this.isExecuting = false; return; }
                if (mainContent) mainContent.setText(`ERR: ${err.message}`);
                this.chatHistory[loadingIndex].content = `ERR: ${err.message}`;
                break;
            }

            if (toolCall && toolCall.function.name) {
                let args: any = {};
                try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch { }
                this.chatHistory.splice(this.chatHistory.length - 1, 0, { role: 'assistant', content: null, tool_calls: [{ id: toolCall.id, type: 'function', function: toolCall.function }] });
                const result = await McpToolRegistry.executeTool(toolCall.function.name, args, this.plugin);
                this.chatHistory.splice(this.chatHistory.length - 1, 0, { role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: result });
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
}

// ================================================================
// SETTINGS TAB
// ================================================================
class HyokaSettingTab extends PluginSettingTab {
    plugin: HyokaPlugin;
    constructor(app: App, plugin: HyokaPlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'SYS_CFG', attr: { style: 'font-family: var(--font-monospace); font-weight: normal; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px;' } });

        new Setting(containerEl).setName('HYPERIZED MODE').setDesc('Allows AI to directly inject interactive HTML/CSS/JS into markdown outputs.')
            .addToggle(t => t.setValue(this.plugin.settings.hyperizedMode).onChange(async v => { this.plugin.settings.hyperizedMode = v; await this.plugin.saveSettings(); }));

        const profilesHeader = containerEl.createEl('div', { attr: { style: 'display:flex; justify-content:space-between; align-items:center; margin-top: 32px; margin-bottom: 16px;' } });
        profilesHeader.createEl('div', { text: 'PROFILES', attr: { style: 'font-family: var(--font-monospace); color: var(--text-muted);' } });
        
        const addBtn = profilesHeader.createEl('button', { cls: 'hyoka-btn-flat' });
        setIcon(addBtn, 'plus');
        addBtn.onclick = async () => {
            this.plugin.settings.profiles.push(freshProfile());
            await this.plugin.saveSettings();
            this.plugin.refreshChatViews();
            this.display();
        };

        this.plugin.settings.profiles.forEach((profile) => {
            const card = containerEl.createEl('div', { cls: 'hyoka-card' });
            const cardHeader = card.createEl('div', { attr: { style: 'display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px; margin-bottom: 12px;' } });
            
            const titleRow = cardHeader.createEl('div', { attr: { style: 'display:flex; align-items:center; gap:8px;' }});
            setIcon(titleRow.createEl('span'), 'cpu');
            titleRow.createEl('span', { text: profile.name });
            
            const canDelete = this.plugin.settings.profiles.length > 1;
            const delBtn = cardHeader.createEl('button', { cls: 'hyoka-btn-icon', attr: { style: canDelete ? '' : 'opacity:0.2; cursor:not-allowed;' } });
            setIcon(delBtn, 'trash-2');
            delBtn.onclick = async () => {
                if (!canDelete) return;
                this.plugin.settings.profiles = this.plugin.settings.profiles.filter(p => p.id !== profile.id);
                if (this.plugin.settings.activeProfileId === profile.id) this.plugin.settings.activeProfileId = this.plugin.settings.profiles[0].id;
                await this.plugin.saveSettings();
                this.plugin.refreshChatViews();
                this.display();
            };

            new Setting(card).setName('ID').addText(t => t.setValue(profile.name).onChange(async v => { profile.name = v; await this.plugin.saveSettings(); this.plugin.refreshChatViews(); titleRow.querySelector('span:last-child')!.setText(v); }));
            new Setting(card).setName('URI').addText(t => t.setValue(profile.apiUrl).onChange(async v => { profile.apiUrl = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('MODEL').addText(t => t.setValue(profile.modelName).onChange(async v => { profile.modelName = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('AUTH').addText(t => t.setValue(profile.apiKey).onChange(async v => { profile.apiKey = v; await this.plugin.saveSettings(); }));
            new Setting(card).setName('CTX MAX').setDesc('Max context window size in tokens').addText(t => t.setValue(String(profile.maxContextTokens)).onChange(async v => { profile.maxContextTokens = parseInt(v) || 128000; await this.plugin.saveSettings(); const views = this.plugin.app.workspace.getLeavesOfType(VIEW_CHAT); if (views.length) (views[0].view as HyokaChatView).updateContextBar(); }));
            new Setting(card).setName('SYS_PRMPT').addTextArea(t => { t.inputEl.rows = 4; t.setValue(profile.systemPrompt).onChange(async v => { profile.systemPrompt = v; await this.plugin.saveSettings(); }); });
        });

        containerEl.createEl('div', { text: 'NETWORK & I/O', attr: { style: 'font-family: var(--font-monospace); color: var(--text-muted); margin-top: 32px; margin-bottom: 16px;' } });
        const netCard = containerEl.createEl('div', { cls: 'hyoka-card' });
        new Setting(netCard).setName('SYS_EXEC BYPASS').setDesc('Execute shell commands directly without UI confirmation.')
            .addToggle(t => t.setValue(this.plugin.settings.autoApproveCommands).onChange(async v => { this.plugin.settings.autoApproveCommands = v; await this.plugin.saveSettings(); }));
        new Setting(netCard).setName('NET_SEARCH').setDesc('Permit DuckDuckGo querying.')
            .addToggle(t => t.setValue(this.plugin.settings.enableWebSearch).onChange(async v => { this.plugin.settings.enableWebSearch = v; await this.plugin.saveSettings(); }));
    }
}