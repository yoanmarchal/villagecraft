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

import { useControlStore } from './controlStore';
import { dropFloatingBlocks, loadVillage, saveVillage, type SavedVillage } from './villageStorage';
import { decodeVillage, encodeVillage, HASH_KEY } from './villageCode';

// Encodage pur dans villageCode.ts (utilisable hors navigateur) ; réexporté ici.
export { decodeVillage, encodeVillage };

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
