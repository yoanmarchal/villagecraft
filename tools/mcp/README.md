# VillageCraft MCP server

Lets an AI agent build and inspect villages: it edits a village in memory with the same rules as clicks in the app, describes it as a text map, and returns a share link or a rendered screenshot.

## Run

- Claude Code picks it up from [.mcp.json](../../.mcp.json) at the repo root (approve the `villagecraft` server when asked).
- By hand: `npm run mcp` (stdio). It bundles `tools/mcp/server.ts` with Vite into `tools/mcp/dist/server.mjs`, then runs it.

Environment:

| Variable           | Default                                       | Use                                                                |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------ |
| `VILLAGECRAFT_URL` | `https://yoanmarchal.github.io/villagecraft/` | Base of share links, and the app rendered by `village_screenshot`. |
| `CHROME_PATH`      | usual Chrome / Chromium / Edge locations      | Browser used for screenshots (headless, software rendering).       |

Screenshots need an app that has `window.villagecraft` (added with this server): until the site is redeployed, point `VILLAGECRAFT_URL` at the dev server (`npm run dev`, e.g. `http://localhost:5173/villagecraft/`).

## Tools

| Tool                 | What it does                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `village_new`        | Empty village, or generated from a seed (same seed, same village); size 2–20.                    |
| `village_load`       | Load a share link or code.                                                                       |
| `village_describe`   | Height map, buildings, towers, arches, share link.                                               |
| `village_build`      | Stack blocks on a column, like clicks.                                                           |
| `village_build_rect` | Raise a rectangle to N storeys plus its roof (1×1 = a round tower).                              |
| `village_demolish`   | Remove blocks from the top of a column.                                                          |
| `village_sculpt`     | Raise or lower the ground under a cell.                                                          |
| `village_clear`      | Remove every block.                                                                              |
| `village_share_link` | Link that opens the village in the app.                                                          |
| `village_screenshot` | Render the village (ambience, camera position / target, size) and return a PNG — up to a minute. |

Coordinates: x and z from 0 to size − 1 (x east, z south), y up from the ground; the top block of a column becomes its roof. Camera coordinates are world units: the grid is centred on the origin, one cell = one unit.

## Code

- [session.ts](session.ts) — the village in memory (`VillageGrid`, `describeVillage`, share codes from `src/store/villageCode.ts`), tested in `session.test.ts`.
- [browser.ts](browser.ts) — headless Chrome driven over the DevTools protocol (no dependency): opens the share link, then calls `window.villagecraft` (see [src/api/villagecraftApi.ts](../../src/api/villagecraftApi.ts)).
- [server.ts](server.ts) — the MCP tools (`@modelcontextprotocol/sdk`, zod schemas).

Nothing may write to stdout except the protocol: `run.mjs` builds with Vite's log level set to silent.
