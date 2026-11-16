/**
 * Partage d'un village par URL : `#v=<base64url>`.
 *
 * Format binaire (v2) : [version, gridSize, graine du terrain (4 octets, poids
 * fort d'abord), nombre de cases modelées, (x, z, crans + 128) par case,
 * x0, y0, z0, x1, y1, z1, …] — un octet par valeur, blocs dans leur ordre de
 * pose. Les liens v1 (sans terrain : [version, gridSize, blocs…]) restent lus. Une grille 5×10×5 pleine
 * tient en ~1 000 caractères, une 12×10×12 pleine en ~5 800 (un village
 * réel, loin d'être plein, en fait bien moins).
 */

import { GRID_HEIGHT, GRID_SIZE_MAX, GRID_SIZE_MIN } from '../config/gridConfig';
import { DEFAULT_TERRAIN, parseTerrain, type SculptEntry } from '../terrainShape';
import { useControlStore } from './controlStore';
import { dropFloatingBlocks, loadVillage, saveVillage, type SavedBlock, type SavedVillage } from './villageStorage';

const HASH_KEY = 'v';
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

export function buildShareUrl(village: SavedVillage): string {
  const url = new URL(window.location.href);
  url.hash = `${HASH_KEY}=${encodeVillage(village)}`;
  return url.toString();
}

/**
 * Copie le lien de partage de `village` dans le presse-papiers. Si c'est
 * refusé (contexte non sécurisé, permission…), l'affiche pour copie manuelle.
 */
export async function copyShareLink(village: SavedVillage): Promise<'copied' | 'shown'> {
  const url = buildShareUrl(village);
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    window.prompt('Copy this link:', url);
    return 'shown';
  }
}

/**
 * À appeler avant le premier rendu : si l'URL contient un village partagé,
 * il devient le village sauvegardé (restauré ensuite normalement par App),
 * après confirmation s'il écraserait un village existant. Le hash est
 * retiré pour qu'un rechargement n'écrase pas les modifications suivantes.
 */
export function consumeSharedVillageLink(): void {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const code = params.get(HASH_KEY);
  if (code === null) return;

  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  const decoded = decodeVillage(code);
  if (!decoded) {
    console.warn('Invalid share link, ignored.');
    return;
  }
  const shared = { ...decoded, blocks: dropFloatingBlocks(decoded.blocks) };

  const existing = loadVillage();
  const isSame = existing !== null && encodeVillage(existing) === encodeVillage(shared);
  if (existing && existing.blocks.length > 0 && !isSame) {
    const replace = window.confirm('This link contains a shared village. Replace your current village?');
    if (!replace) return;
  }

  useControlStore.getState().setGridSize(shared.gridSize);
  saveVillage(shared);
}
