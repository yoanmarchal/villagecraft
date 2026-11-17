/**
 * API stable de l'app, `window.villagecraft` : de quoi piloter le village de
 * l'extérieur (serveur MCP, scripts de capture, console du navigateur) sans
 * dépendre de ses modules internes. Toute modification de la grille passe par
 * le contrôleur (`commit()` : annulation et rafraîchissement), comme un clic.
 *
 * Coordonnées de grille : x et z de 0 à `gridSize − 1`, y de 0 (le sol) vers
 * le haut. Les méthodes qui changent la scène renvoient une promesse résolue
 * quand le village est reconstruit (worker) et affiché.
 */

import { AMBIENCE_PRESETS } from '../config/ambiencePresets';
import { GRID_SIZE_MAX, GRID_SIZE_MIN } from '../config/gridConfig';
import { POP_DURATION } from '../render/growMaterial';
import { useControlStore } from '../store/controlStore';
import { useGridControllerStore } from '../store/gridControllerStore';
import { buildShareUrl } from '../store/shareLink';
import { decodeVillage } from '../store/villageCode';
import type { SavedVillage } from '../store/villageStorage';
import { useUiStore } from '../store/uiStore';
import { DEFAULT_TERRAIN } from '../terrainShape';
import type { VillageGrid } from '../villageGrid';
import { describeVillage, type VillageDescription } from './describeVillage';
import { sceneBridge, type CameraView } from './sceneBridge';

export const API_VERSION = 1;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function grid(): VillageGrid {
  const current = useGridControllerStore.getState().grid;
  if (!current) throw new Error('VillageCraft: the village is not mounted yet');
  return current;
}

function checkColumn(x: number, z: number): void {
  const size = grid().width;
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= size || z >= size) {
    throw new Error(`VillageCraft: column (${x}, ${z}) is outside the ${size}×${size} grid`);
  }
}

/** Le village est reconstruit, ses blocs ont fini d'apparaître, et deux images sont passées. */
async function settled(): Promise<void> {
  // Le worker reçoit la demande au rendu React suivant le commit.
  await frame();
  for (let i = 0; i < 600 && sceneBridge.isBuilding(); i += 1) await sleep(25);
  const pop = sceneBridge.latestSpawn() + POP_DURATION - performance.now() / 1000;
  if (pop > 0) await sleep(pop * 1000 + 50);
  await frame();
  await frame();
}

/** Nouvelle taille de grille : l'app crée une nouvelle grille, on attend qu'elle soit montée. */
async function resize(size: number): Promise<void> {
  if (!Number.isInteger(size) || size < GRID_SIZE_MIN || size > GRID_SIZE_MAX) {
    throw new Error(`VillageCraft: grid size must be an integer from ${GRID_SIZE_MIN} to ${GRID_SIZE_MAX}`);
  }
  if (useGridControllerStore.getState().grid?.width === size) return;
  useControlStore.getState().setGridSize(size);
  for (let i = 0; i < 400 && useGridControllerStore.getState().grid?.width !== size; i += 1) await sleep(25);
}

function commit(): void {
  useGridControllerStore.getState().commit();
}

/** Réglages modifiables : les valeurs du store (pas ses actions), sauf la taille de grille (`setGridSize`). */
function settingKeys(): string[] {
  const state = useControlStore.getState() as unknown as Record<string, unknown>;
  return Object.keys(state).filter((key) => typeof state[key] !== 'function' && key !== 'gridSize');
}

export const villagecraftApi = {
  version: API_VERSION,

  /** Description pour un agent : hauteurs, bâtiments, tours, arches, carte texte. */
  describe(): VillageDescription {
    return describeVillage(grid());
  },

  /** Village courant (blocs posés dans leur ordre, terrain) : le format des sauvegardes et des liens. */
  getVillage(): SavedVillage {
    const g = grid();
    return { gridSize: g.width, blocks: g.exportBlocks(), terrain: g.terrain };
  },

  /** Charge un village (objet, code `#v=…` ou URL de partage) ; l'historique d'annulation le garde. */
  async loadVillage(village: SavedVillage | string): Promise<void> {
    const parsed =
      typeof village === 'string'
        ? decodeVillage(village.includes('v=') ? village.split('v=').pop()! : village)
        : village;
    if (!parsed) throw new Error('VillageCraft: invalid village code');
    await resize(parsed.gridSize);
    const g = grid();
    g.clear();
    g.importBlocks(parsed.blocks);
    g.setTerrain(parsed.terrain ?? DEFAULT_TERRAIN);
    commit();
    await settled();
  },

  /** Lien de partage du village courant. */
  shareLink(): string {
    return buildShareUrl(this.getVillage());
  },

  /** Pose `count` blocs sur la colonne (x, z), comme des clics ; renvoie la hauteur de chacun (y). */
  async addBlocks(x: number, z: number, count = 1): Promise<number[]> {
    checkColumn(x, z);
    const g = grid();
    const placed: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const y = g.getNextPlacementY(x, z, 0);
      if (y === null) break;
      g.addBlock(x, y, z);
      placed.push(y);
    }
    if (placed.length) commit();
    await settled();
    return placed;
  },

  /** Retire `count` blocs du haut de la colonne (x, z) ; renvoie la hauteur de chacun. */
  async removeBlocks(x: number, z: number, count = 1): Promise<number[]> {
    checkColumn(x, z);
    const g = grid();
    const removed: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const y = g.removeTopBlockInColumn(x, z);
      if (y === null) break;
      removed.push(y);
    }
    if (removed.length) commit();
    await settled();
    return removed;
  },

  /** Relève (`steps` > 0) ou creuse le terrain sous la case (x, z). */
  async sculpt(x: number, z: number, steps: number): Promise<void> {
    checkColumn(x, z);
    useGridControllerStore.getState().sculpt(x, z, steps);
    await settled();
  },

  /** Génère un village (graine fixe : même village à chaque fois), à la taille donnée ou à la taille courante. */
  async generate({ seed, size }: { seed?: number; size?: number } = {}): Promise<void> {
    if (size !== undefined) await resize(size);
    const g = grid();
    g.generateTerrain(g.width, seed);
    commit();
    await settled();
  },

  async clear(): Promise<void> {
    useGridControllerStore.getState().clear();
    await settled();
  },

  async undo(): Promise<void> {
    useGridControllerStore.getState().undo();
    await settled();
  },

  async redo(): Promise<void> {
    useGridControllerStore.getState().redo();
    await settled();
  },

  /** Change la taille de la grille (les blocs hors de la nouvelle grille sont rognés, comme dans l'app). */
  async setGridSize(size: number): Promise<void> {
    await resize(size);
    await settled();
  },

  /** Réglages courants (couleurs, lumière, formes, post-traitement…). */
  getSettings(): Record<string, unknown> {
    const state = useControlStore.getState() as unknown as Record<string, unknown>;
    return Object.fromEntries(settingKeys().map((key) => [key, state[key]]));
  },

  /** Modifie des réglages ; les clés inconnues sont refusées. */
  async setSettings(settings: Record<string, unknown>): Promise<void> {
    const known = new Set(settingKeys());
    const unknown = Object.keys(settings).filter((key) => !known.has(key));
    if (unknown.length) throw new Error(`VillageCraft: unknown setting(s): ${unknown.join(', ')}`);
    useControlStore.setState(settings);
    await settled();
  },

  ambiences(): string[] {
    return AMBIENCE_PRESETS.map((preset) => preset.id);
  },

  async setAmbience(id: string): Promise<void> {
    const preset = AMBIENCE_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`VillageCraft: unknown ambience "${id}" (${this.ambiences().join(', ')})`);
    useControlStore.setState(preset.settings);
    await settled();
  },

  getCamera(): CameraView {
    if (!sceneBridge.getCamera) throw new Error('VillageCraft: the scene is not mounted yet');
    return sceneBridge.getCamera();
  },

  /** Place la caméra (monde : la grille est centrée sur l'origine, une case = une unité). */
  async setCamera(view: Partial<CameraView>): Promise<void> {
    if (!sceneBridge.setCamera) throw new Error('VillageCraft: the scene is not mounted yet');
    sceneBridge.setCamera(view);
    await settled();
  },

  /** Capture du canvas (sans l'interface), en PNG, une fois le village construit. */
  async screenshot(): Promise<string> {
    await settled();
    const capture = useUiStore.getState().captureScreenshot;
    if (!capture) throw new Error('VillageCraft: the scene is not mounted yet');
    return capture();
  },

  /** Attend que la scène soit à jour (après des modifications faites ailleurs). */
  settled,
};

export type VillagecraftApi = typeof villagecraftApi;

declare global {
  interface Window {
    villagecraft?: VillagecraftApi;
  }
}

export function installVillagecraftApi(): void {
  window.villagecraft = villagecraftApi;
}
