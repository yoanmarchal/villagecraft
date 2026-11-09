/**
 * Sauvegarde locale du village (blocs réels dans leur ordre de pose). Séparée
 * de `controlStore` : ce sont des données de la grille, pas des réglages, et
 * elles ne doivent pas être touchées par "Reset to Defaults".
 */

const STORAGE_KEY = 'villagecraft-village';
const VERSION = 1;

export type SavedBlock = [number, number, number];

export interface SavedVillage {
  gridSize: number;
  blocks: SavedBlock[];
}

const isSavedBlock = (value: unknown): value is SavedBlock =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isInteger);

/**
 * Retire les blocs qui flotteraient : un clic empile toujours depuis le sol,
 * donc un bloc réel a toute sa colonne occupée en dessous. Seuls un lien de
 * partage forgé ou une sauvegarde abîmée peuvent en contenir. L'ordre de
 * pose est conservé (il n'est pas forcément de bas en haut : un cap de toit
 * promu en mur reçoit son numéro après le bloc posé dessus).
 */
export function dropFloatingBlocks(blocks: SavedBlock[]): SavedBlock[] {
  const occupied = new Set(blocks.map((block) => block.join(',')));
  return blocks.filter(([x, y, z]) => {
    for (let below = 0; below < y; below += 1) {
      if (!occupied.has(`${x},${below},${z}`)) return false;
    }
    return true;
  });
}

export function loadVillage(): SavedVillage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { version?: unknown; gridSize?: unknown; blocks?: unknown } | null;
    if (data?.version !== VERSION || typeof data.gridSize !== 'number' || !Number.isInteger(data.gridSize)) return null;
    if (!Array.isArray(data.blocks)) return null;
    return { gridSize: data.gridSize, blocks: dropFloatingBlocks(data.blocks.filter(isSavedBlock)) };
  } catch {
    return null;
  }
}

export function saveVillage(village: SavedVillage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...village }));
  } catch {
    // Stockage indisponible (navigation privée, quota…) : le village reste en mémoire.
  }
}
