/**
 * Partage d'un village par URL : `#v=<base64url>`.
 *
 * Format binaire (v1) : [version, gridSize, x0, y0, z0, x1, y1, z1, …] — un
 * octet par valeur, blocs dans leur ordre de pose. Une grille 5×10×5 pleine
 * tient en ~1 000 caractères, une 12×10×12 pleine en ~5 800 (un village
 * réel, loin d'être plein, en fait bien moins).
 */

import { GRID_HEIGHT, GRID_SIZE_MAX, GRID_SIZE_MIN } from '../config/gridConfig';
import { useControlStore } from './controlStore';
import { loadVillage, saveVillage, type SavedBlock, type SavedVillage } from './villageStorage';

const HASH_KEY = 'v';
const FORMAT_VERSION = 1;

export function encodeVillage({ gridSize, blocks }: SavedVillage): string {
  const bytes = [FORMAT_VERSION, gridSize, ...blocks.flat()];
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
  const [version, gridSize, ...values] = bytes;
  if (version !== FORMAT_VERSION || values.length % 3 !== 0) return null;
  if (!(gridSize >= GRID_SIZE_MIN && gridSize <= GRID_SIZE_MAX)) return null;

  const blocks: SavedBlock[] = [];
  for (let i = 0; i < values.length; i += 3) {
    const [x, y, z] = values.slice(i, i + 3);
    if (x >= gridSize || z >= gridSize || y >= GRID_HEIGHT) return null;
    blocks.push([x, y, z]);
  }
  return { gridSize, blocks };
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

  const shared = decodeVillage(code);
  if (!shared) {
    console.warn('Lien de partage invalide, ignoré.');
    return;
  }

  const existing = loadVillage();
  const isSame = existing !== null && encodeVillage(existing) === encodeVillage(shared);
  if (existing && existing.blocks.length > 0 && !isSame) {
    const replace = window.confirm('Ce lien contient un village partagé. Remplacer votre village actuel ?');
    if (!replace) return;
  }

  useControlStore.getState().setGridSize(shared.gridSize);
  saveVillage(shared);
}
