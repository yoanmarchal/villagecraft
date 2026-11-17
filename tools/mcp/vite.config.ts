import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Serveur MCP empaqueté pour Node (TypeScript, imports sans extension de src/) : tools/mcp/dist/server.mjs.
export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  logLevel: 'silent',
  build: {
    ssr: resolve(import.meta.dirname, 'server.ts'),
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
