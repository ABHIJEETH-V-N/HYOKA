import { ItemView, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, requestUrl } from 'obsidian';

// Unique identifiers for the plugin view
const VIEW_TYPE_HYOKA = "hyoka-chat-view";

interface HyokaSettings {
    apiUrl: string;
    modelName: string;
}

const DEFAULT_SETTINGS: HyokaSettings = {
    apiUrl: 'http://127.0.0.1:8080/v1',
    modelName: 'google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0'
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export default class HyokaPlugin extends Plugin {
    settings: HyokaSettings;

    async onload() {
        await this.loadSettings();

        // Register the custom sidebar view
        this.registerView(
            VIEW_TYPE_HYOKA,
            (leaf) => new HyokaChatView(leaf, this)
        );

        // Add a ribbon icon to easily open the chat
        this.addRibbonIcon('message-square', 'Open Hyoka Chat', () => {
            this.activateView();
        });

        // Add a command to the command palette
        this.addCommand({
            id: 'open-hyoka-chat',
            name: 'Open Chat Window',
            callback: () => this.activateView(),
        });

        // Add the settings tab
        this.addSettingTab(new HyokaSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_HYOKA)[0];
        
        if (!leaf) {
            // Right split is the standard sidebar area
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({ type: VIEW_TYPE_HYOKA, active: true });
            }
        }
        
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }
}

// The Chat Interface UI View
class HyokaChatView extends ItemView {
    plugin: HyokaPlugin;
    chatHistory: ChatMessage[] = [];
    messageContainer: HTMLDivElement;
    inputField: HTMLTextAreaElement;

    constructor(leaf: WorkspaceLeaf, plugin: HyokaPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with a system prompt to keep the model grounded
        this.resetChat();
    }

    getViewType(): string {
        return VIEW_TYPE_HYOKA;
    }

    getDisplayText(): string {
        return "Hyoka Chat";
    }

    getIcon(): string {
        return "message-square";
    }

    resetChat() {
        this.chatHistory = [
            { role: 'system', content: 'You are Hyoka, a helpful local AI assistant running inside Obsidian.' }
        ];
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        
        // Setup CSS wrappers via JS for layout styling
        const wrapper = container.createEl('div', { 
            cls: 'hyoka-chat-wrapper',
            attr: { style: 'display: flex; flex-direction: column; height: 100%; gap: 10px; padding: 10px;' }
        });

        // Header with a clear history button
        const header = wrapper.createEl('div', {
            attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 5px;' }
        });
        header.createEl('h4', { text: 'Local Gemma Session', attr: { style: 'margin: 0;' } });
        const clearBtn = header.createEl('button', { text: 'Clear Context', cls: 'mod-warning' });
        clearBtn.addEventListener('click', () => {
            this.resetChat();
            this.renderMessages();
        });

        // Message Scroll Window
        this.messageContainer = wrapper.createEl('div', {
            attr: { style: 'flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 5px;' }
        });

        // Input Layout Area
        const inputArea = wrapper.createEl('div', {
            attr: { style: 'display: flex; gap: 5px; align-items: flex-end;' }
        });

        this.inputField = inputArea.createEl('textarea', {
            attr: { 
                placeholder: 'Ask your vault anything...', 
                rows: '2',
                style: 'flex-grow: 1; resize: none; border-radius: 4px; border: 1px solid var(--background-modifier-border); padding: 6px; background: var(--background-primary); color: var(--text-normal); font-family: inherit;'
            }
        });

        const sendBtn = inputArea.createEl('button', { 
            text: 'Send',
            cls: 'mod-cta',
            attr: { style: 'padding: 6px 12px; height: 38px;' }
        });

        // Event Handling
        sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.renderMessages();
    }

    renderMessages() {
        if (!this.messageContainer) return;
        this.messageContainer.empty();

        // Skip rendering index 0 (the internal system message)
        for (let i = 1; i < this.chatHistory.length; i++) {
            const msg = this.chatHistory[i];
            const isUser = msg.role === 'user';

            const msgDiv = this.messageContainer.createEl('div', {
                attr: {
                    style: `padding: 8px 12px; border-radius: 6px; max-width: 85%; line-height: 1.4; ${
                        isUser 
                        ? 'align-self: flex-end; background: var(--interactive-accent); color: var(--text-on-accent);' 
                        : 'align-self: flex-start; background: var(--background-secondary); border: 1px solid var(--background-modifier-border);'
                    }`
                }
            });

            // Label to distinguish sender
            msgDiv.createEl('strong', { 
                text: isUser ? 'You: ' : 'Gemma: ',
                attr: { style: 'display: block; font-size: 0.8em; margin-bottom: 4px; opacity: 0.8;' } 
            });
            
            // Text Body
            msgDiv.createEl('span', { text: msg.content, attr: { style: 'white-space: pre-wrap;' } });
        }

        // Auto-scroll window down to the latest message turn
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    async handleSendMessage() {
        const text = this.inputField.value.trim();
        if (!text) return;

        // Reset input field view immediately
        this.inputField.value = '';

        // Append user turn to history state array
        this.chatHistory.push({ role: 'user', content: text });
        this.renderMessages();

        // Add a temporary loading state placeholder bubble
        const loadingMsgIndex = this.chatHistory.push({ role: 'assistant', content: 'Thinking...' }) - 1;
        this.renderMessages();

        try {
            // Make an OpenAI-compatible POST request using Obsidian's native CORS bypass network utility
            const response = await requestUrl({
                url: `${this.plugin.settings.apiUrl}/chat/completions`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.plugin.settings.modelName,
                    // Sending the full chatHistory array preserves context window sequence memory
                    messages: this.chatHistory.slice(0, loadingMsgIndex), 
                    temperature: 0.3
                })
            });

            if (response.status === 200) {
                const reply = response.json.choices[0].message.content;
                this.chatHistory[loadingMsgIndex].content = reply;
            } else {
                this.chatHistory[loadingMsgIndex].content = `API Error: Received status code ${response.status}`;
            }
        } catch (error) {
            this.chatHistory[loadingMsgIndex].content = `Connection failed. Make sure llama-server is running. Error details: ${error.message}`;
        }

        this.renderMessages();
    }

    async onClose() {
        // Garbage cleanup handling when view leaf is closed
    }
}

// Settings Configuration UI Layer Tab
class HyokaSettingTab extends PluginSettingTab {
    plugin: HyokaPlugin;

    constructor(app: any, plugin: HyokaPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Hyoka AI Core Settings' });

        new Setting(containerEl)
            .setName('Local Host Base URL')
            .setDesc('The endpoint address configured on your llama-server process.')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:8080/v1')
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Target Model ID Target')
            .setDesc('Must match the exact model configuration string inside llama-server.')
            .addText(text => text
                .setPlaceholder('google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0')
                .setValue(this.plugin.settings.modelName)
                .onChange(async (value) => {
                    this.plugin.settings.modelName = value.trim();
                    await this.plugin.saveSettings();
                }));
    }
}