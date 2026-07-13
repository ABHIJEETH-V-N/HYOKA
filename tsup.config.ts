import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['main.ts'],
    format: ['cjs'],           // Obsidian requires CommonJS
    external: ['obsidian'],    // MUST be external, Obsidian provides this at runtime
    outDir: '.',               // Output to the root folder
    clean: false,              // Don't delete other files in the root folder
    sourcemap: 'inline',       // Helps with debugging inside Obsidian
    treeshake: true,
    minify: false,             // Keep false during dev so you can read errors
});
