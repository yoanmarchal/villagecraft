// Lance le serveur MCP (stdio) : empaquette tools/mcp/server.ts, puis l'exécute.
// Rien ne doit écrire sur stdout avant le serveur : c'est le canal du protocole.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'silent' });
await import(pathToFileURL(join(here, 'dist', 'server.mjs')).href);
