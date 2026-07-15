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


# HYOKA
> High-performance, local-first agentic shell for deep vault integration.

## ⚡ Hyperized Task Stream
Hyoka now supports **Hyperized Mode**. Toggle it in settings to enable your agent to inject interactive dashboard widgets directly into Markdown files. Turn static notes into live monitoring tools for your systems.

## Key Capabilities
- **Direct System Access:** Execute local shell commands with human-in-the-loop authorization.
- **Live UI Rendering:** The **UI Renderer** view now features a persistent dropdown to switch between any HTML file in your vault instantly.
- **Context Management:** Set your own model `CTX_MAX` in the profile settings for total control over token usage.
- **Minimalist Aesthetic:** Designed for focus with a monochrome, distraction-free interface.

## Installation
### Via Community Plugins
1. Open **Settings > Community plugins**.
2. Browse for "Hyoka" and click **Install**.

### Manual Release
1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/abhijeeth-v-n/HYOKA/releases).
2. Extract into `YOUR_VAULT/.obsidian/plugins/hyoka/`.
3. Enable in the Plugins settings.

## Configuration
- **Profiles:** Manage multiple agent personas with custom System Prompts and API endpoints.
- **Security:** Enable `SYS_EXEC BYPASS` only for trusted local environments.
- **Performance:** Set `CTX_MAX` according to your local LLM's capability to avoid truncation.

---
*Built for the Systems Engineer.*