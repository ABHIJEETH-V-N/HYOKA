```
      ::                                                                                                                            
     ========**       ========**========        :====*        ==========                                                            
     =======****      =======**:*=======*      =====++-  ========****=======*       *=======       -=====*       ======             
     =======*****    .=======***+*========    ====*++++=======+-::::::-+=======    **=======      =====+-       ========            
    ========*****:   =======*****+*=======. +====++++========++-::::::-++========  **=======    =====+--       ==========           
    ========================****  +*===========*++++*=======*++-:::::--++*=======****=======  =====+---       ============          
   =======******============****   +*=========++++++========*+--.   .:-++*======== **=======:====+---        ======*=======         
   =======**::::::::=======****+    +*=======++++++ ========*+         ++*======== **=============*         .======++*======.       
  -=======***:::::::=======****      ========*+++.  ========*           +*======== **===============        ======+++**======+      
  =======*****:::::*=======****      =======**++    *========            ========* **========+========     ====================     
 *=======******    ========****      =======**+     :*=======*           =======*  **========++*=======:   ======********=======    
 ========******    ========***-     ========**       ++*=======        =======*+:  **========++++======== ======*::::::+**=======   
------+++*****    ********=***      ========**       ++--+*================*+--+   **========+++++*=============::::::+++*========  
  ::::::::****     ::::::::***      ::::::::-*        +----::----****+----:----    **=******==+++++*===========*::::+++++**========*
   .::::::::**      ::::::::**       ::::::::*         ----::::::::::::::::---     *+:::::::::+++++::::::::::::     ++++***-::::::::
     ......::*       ::::::::-       .::::::::            -:::::::::::::::-.       *::::::::   +++:::::::::::        +***-::::::::  
                                                                 :::               ::::::::     +:::::::::::          *-::::::::    
```


# Hyoka

Hyoka is a powerful, local-first agentic shell designed for deep vault integration and automation.

## Features
* **Multi-Persona Orchestration:** Configure different agents for different tasks.
* **Direct Vault Access:** Use tools to search, read, create, and manage files without leaving your notes.
* **Contextual Awareness:** Attach active notes to your agent's context for specific analysis.
* **Secure Execution:** All destructive actions (like file deletion) require human-in-the-loop authorization.

## Installation

### From Community Plugins
1. Open **Settings > Community plugins**.
2. Click **Browse** and search for "Hyoka".
3. Click **Install** and then **Enable**.

### Manual Installation
1. Go to the [Releases page](https://github.com/abhijeeth-v-n/HYOKA/releases).
2. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
3. Move these files into your vault: `YOUR_VAULT/.obsidian/plugins/hyoka/`.
4. Refresh Obsidian and enable the plugin.

## Usage
1. Click the **"Open Hyoka Shell"** icon in the ribbon.
2. Select your agent persona from the header dropdown.
3. Type your instructions in the terminal console.
4. Use the **"Attach Active Note"** button to feed specific vault content into the agent's current working memory.

## Development & Security
Hyoka is built as a local MCP (Model Context Protocol) executor. No data is sent to external cloud APIs without your explicit configuration of an API endpoint in the settings.
