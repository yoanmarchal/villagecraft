/**
 * Code d'un village dans un lien de partage (`#v=<code>`), sans dépendance au
 * navigateur ni aux stores : partagé par l'app (shareLink.ts) et les outils
 * Node (serveur MCP). Format : voir shareLink.ts.
 */

import { GRID_HEIGHT, GRID_SIZE_MAX, GRID_SIZE_MIN } from '../config/gridConfig';
import { DEFAULT_TERRAIN, parseTerrain, type SculptEntry } from '../terrainShape';
import type { SavedBlock, SavedVillage } from './villageStorage';

/** Clé du lien : `#v=…`. */
export const HASH_KEY = 'v';
const FORMAT_VERSION = 2;
/** Décalage des crans de modelage (signés) pour tenir dans un octet. */
const STEPS_BIAS = 128;

export function encodeVillage({ gridSize, blocks, terrain = DEFAULT_TERRAIN }: SavedVillage): string {
  const { seed, sculpt } = terrain;
  const bytes = [
    FORMAT_VERSION,
    gridSize,
    seed >>> 24,
    (seed >>> 16) & 255,
    (seed >>> 8) & 255,
    seed & 255,
    sculpt.length,
    ...sculpt.flatMap(([x, z, steps]) => [x, z, steps + STEPS_BIAS]),
    ...blocks.flat(),
  ];
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeVillage(code: string): SavedVillage | null {
  let binary: string;
  try {
    binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }

  const bytes = Array.from(binary, (char) => char.charCodeAt(0));
  const [version, gridSize, ...rest] = bytes;
  if (version !== 1 && version !== FORMAT_VERSION) return null;
  if (!(gridSize >= GRID_SIZE_MIN && gridSize <= GRID_SIZE_MAX)) return null;

  let values = rest;
  let terrain = DEFAULT_TERRAIN;
  if (version === FORMAT_VERSION) {
    const count = rest[4];
    if (!(rest.length >= 5 + count * 3)) return null;
    const sculpt: SculptEntry[] = [];
    for (let i = 0; i < count; i += 1) {
      const [x, z, steps] = rest.slice(5 + i * 3, 8 + i * 3);
      if (x >= gridSize || z >= gridSize) return null;
      sculpt.push([x, z, steps - STEPS_BIAS]);
    }
    const seed = ((rest[0] << 24) | (rest[1] << 16) | (rest[2] << 8) | rest[3]) >>> 0;
    terrain = parseTerrain({ seed, sculpt }, gridSize);
    values = rest.slice(5 + count * 3);
  }
  if (values.length % 3 !== 0) return null;

  const blocks: SavedBlock[] = [];
  for (let i = 0; i < values.length; i += 3) {
    const [x, y, z] = values.slice(i, i + 3);
    if (x >= gridSize || z >= gridSize || y >= GRID_HEIGHT) return null;
    blocks.push([x, y, z]);
  }
  return { gridSize, blocks, terrain };
}
