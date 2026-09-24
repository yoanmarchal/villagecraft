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

export function loadVillage(): SavedVillage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== VERSION || !Number.isInteger(data.gridSize) || !Array.isArray(data.blocks)) {
      return null;
    }
    return { gridSize: data.gridSize, blocks: data.blocks.filter(isSavedBlock) };
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
