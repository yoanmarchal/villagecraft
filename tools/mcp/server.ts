/**
 * Serveur MCP de VillageCraft (stdio) : un agent construit et décrit des
 * villages, et récupère un lien de partage ou une capture.
 *
 * - Sans navigateur : un village en mémoire (session.ts), modifié comme par
 *   des clics dans l'app. Le résultat s'ouvre par `village_share_link`.
 * - Capture : `village_screenshot` rend le village dans un Chrome sans
 *   fenêtre (browser.ts), sur l'app servie à VILLAGECRAFT_URL.
 *
 * Variables : VILLAGECRAFT_URL (défaut : le site publié ; en local, le
 * serveur Vite, ex. http://localhost:5173/villagecraft/), CHROME_PATH.
 * Lancement : `npm run mcp` (voir tools/mcp/README.md).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GRID_SIZE_MAX, GRID_SIZE_MIN } from '../../src/config/gridConfig';
import { AMBIENCE_PRESETS } from '../../src/config/ambiencePresets';
import { renderVillage } from './browser';
import { VillageSession } from './session';

const APP_URL = process.env.VILLAGECRAFT_URL ?? 'https://yoanmarchal.github.io/villagecraft/';
const session = new VillageSession(APP_URL);

const server = new McpServer({ name: 'villagecraft', version: '1.0.0' });

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
/** Réponse après une modification : la carte du village et son lien. */
const state = (lead: string) => {
  const village = session.describe();
  return text(`${lead}\n\n${village.text}\n\nShare link: ${session.shareLink()}`);
};
/** Erreur d'usage (colonne hors grille…) : renvoyée à l'agent, pas levée. */
const guard = <A>(run: (args: A) => ReturnType<typeof text>) => {
  return (args: A) => {
    try {
      return run(args);
    } catch (error) {
      return { ...text(`Error: ${(error as Error).message}`), isError: true };
    }
  };
};

const column = {
  x: z.number().int().min(0).describe('Column x (0 = west edge)'),
  z: z.number().int().min(0).describe('Column z (0 = north edge)'),
};

server.registerTool(
  'village_new',
  {
    title: 'New village',
    description:
      'Start a new village: empty, or generated from a seed (same seed, same village). Grid coordinates: x and z from 0 to size − 1, y up from the ground. The top block of a column becomes its roof; lone columns become towers; arches appear over 1–2 cell lanes between facing buildings at least 3 blocks high.',
    inputSchema: {
      size: z.number().int().min(GRID_SIZE_MIN).max(GRID_SIZE_MAX).default(8).describe('Grid side, in cells'),
      seed: z.number().int().min(0).optional().describe('Generate a village from this seed; omit for an empty grid'),
    },
  },
  guard(({ size, seed }) => {
    session.reset(size, seed ?? null);
    return state(seed === undefined ? `Empty ${size}×${size} village.` : `Village generated from seed ${seed}.`);
  }),
);

server.registerTool(
  'village_load',
  {
    title: 'Load village',
    description: 'Load a village from a VillageCraft share link (…#v=…) or its code.',
    inputSchema: { link: z.string().describe('Share link or code') },
  },
  guard(({ link }) => {
    session.load(link);
    return state('Village loaded.');
  }),
);

server.registerTool(
  'village_describe',
  {
    title: 'Describe village',
    description:
      'Map of the current village (column heights in blocks; the top block is the roof), its buildings, towers and arches, and its share link.',
    inputSchema: {},
  },
  guard(() => {
    const village = session.describe();
    return text(
      `${village.text}\n\nBuildings: ${JSON.stringify(village.buildings)}\n\nShare link: ${session.shareLink()}`,
    );
  }),
);

server.registerTool(
  'village_build',
  {
    title: 'Build on a column',
    description:
      'Stack blocks on a column, exactly like clicks in the app. Note: a single block gets an automatic roof cap; building on it turns the cap into a wall, so 3 clicks on empty ground give a column 4 blocks high.',
    inputSchema: { ...column, count: z.number().int().min(1).max(9).default(1) },
  },
  guard(({ x, z: cz, count }) => {
    const placed = session.build(x, cz, count);
    return state(`Placed ${placed.length} block(s) at heights ${JSON.stringify(placed)} on (${x}, ${cz}).`);
  }),
);

server.registerTool(
  'village_build_rect',
  {
    title: 'Build a rectangular building',
    description:
      'Raise every column of a rectangle to the given number of storeys plus its roof (taller columns are left as they are). Buildings that touch merge into one; a 1×1 building is a round tower.',
    inputSchema: {
      ...column,
      width: z.number().int().min(1).describe('Extent along x'),
      depth: z.number().int().min(1).describe('Extent along z'),
      storeys: z.number().int().min(1).max(9).describe('Habitable storeys, roof not counted'),
    },
  },
  guard(({ x, z: cz, width, depth, storeys }) => {
    const added = session.buildRect(x, cz, width, depth, storeys);
    return state(`Building ${width}×${depth}, ${storeys} storey(s), at (${x}, ${cz}): ${added} block(s) added.`);
  }),
);

server.registerTool(
  'village_demolish',
  {
    title: 'Demolish from a column',
    description: 'Remove blocks from the top of a column, like right clicks in the app.',
    inputSchema: { ...column, count: z.number().int().min(1).max(10).default(1) },
  },
  guard(({ x, z: cz, count }) => {
    const removed = session.demolish(x, cz, count);
    return state(`Removed ${removed.length} block(s) from (${x}, ${cz}).`);
  }),
);

server.registerTool(
  'village_sculpt',
  {
    title: 'Sculpt the terrain',
    description:
      'Raise (positive steps) or lower the ground under a cell; buildings stay level on the highest point under them.',
    inputSchema: { ...column, steps: z.number().int().min(-8).max(8) },
  },
  guard(({ x, z: cz, steps }) => {
    session.sculpt(x, cz, steps);
    return state(`Ground at (${x}, ${cz}) moved by ${steps} step(s).`);
  }),
);

server.registerTool(
  'village_clear',
  { title: 'Clear village', description: 'Remove every block (the terrain stays).', inputSchema: {} },
  guard(() => {
    session.clear();
    return state('Village cleared.');
  }),
);

server.registerTool(
  'village_share_link',
  {
    title: 'Share link',
    description: 'Link that opens the current village in the VillageCraft app.',
    inputSchema: {},
  },
  guard(() => text(session.shareLink())),
);

server.registerTool(
  'village_screenshot',
  {
    title: 'Screenshot',
    description: `Render the current village in a headless Chrome running the app at ${APP_URL} and return the image (slow: software rendering, up to a minute). World coordinates for the camera: the grid is centred on the origin, one cell = one unit, y up.`,
    inputSchema: {
      ambience: z
        .enum(AMBIENCE_PRESETS.map((preset) => preset.id) as [string, ...string[]])
        .optional()
        .describe('Lighting ambience'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('Camera position (world)'),
      target: z.tuple([z.number(), z.number(), z.number()]).optional().describe('Point the camera looks at'),
      width: z.number().int().min(200).max(1920).default(1200),
      height: z.number().int().min(200).max(1080).default(630),
    },
  },
  async ({ ambience, position, target, width, height }) => {
    try {
      const png = await renderVillage({
        shareLink: session.shareLink(),
        width,
        height,
        ambience,
        camera: position || target ? { position, target } : undefined,
      });
      return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
    } catch (error) {
      return { ...text(`Error: ${(error as Error).message}`), isError: true };
    }
  },
);

await server.connect(new StdioServerTransport());
