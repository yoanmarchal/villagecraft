import { create } from 'zustand';
import type { VillageGrid } from '../villageGrid';
import { History } from '../history';
import { useControlStore } from './controlStore';
import { terrainEquals, type TerrainShape } from '../terrainShape';
import type { SavedBlock } from './villageStorage';

type Blocks = SavedBlock[];

/** Un état de l'historique : les blocs et la forme du terrain. */
interface Snapshot {
  blocks: Blocks;
  terrain: TerrainShape;
}

const blocksEqual = (a: Blocks, b: Blocks) =>
  a.length === b.length && a.every(([x, y, z], i) => x === b[i][0] && y === b[i][1] && z === b[i][2]);

const snapshotEqual = (a: Snapshot, b: Snapshot) =>
  terrainEquals(a.terrain, b.terrain) && blocksEqual(a.blocks, b.blocks);

const snapshotOf = (grid: VillageGrid): Snapshot => ({ blocks: grid.exportBlocks(), terrain: grid.terrain });

interface GridControllerState {
  grid: VillageGrid | null;
  isGenerating: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onMutate: (() => void) | null;
  /** Nouvelle grille (montage, redimensionnement) : repart d'un historique vierge. */
  setGrid: (grid: VillageGrid) => void;
  setOnMutate: (onMutate: () => void) => void;
  /** À appeler après toute mutation de la grille : l'enregistre dans l'historique et rafraîchit la scène. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  /** Relève (`delta` > 0) ou creuse (`delta` < 0) le terrain à la case (x, z). */
  sculpt: (x: number, z: number, delta: number) => void;
  generateTerrain: () => Promise<void>;
}

export const useGridControllerStore = create<GridControllerState>()((set, get) => {
  // Hors de l'état réactif : seuls canUndo/canRedo intéressent l'UI.
  let history: History<Snapshot> | null = null;

  const syncHistoryFlags = () => set({ canUndo: history?.canUndo ?? false, canRedo: history?.canRedo ?? false });

  const restore = (snapshot: Snapshot | null | undefined) => {
    const { grid, onMutate } = get();
    if (!grid || !snapshot) return;
    grid.replaceBlocks(snapshot.blocks);
    grid.setTerrain(snapshot.terrain);
    syncHistoryFlags();
    onMutate?.();
  };

  return {
    grid: null,
    isGenerating: false,
    canUndo: false,
    canRedo: false,
    onMutate: null,

    setGrid: (grid) => {
      history = new History<Snapshot>(snapshotOf(grid), snapshotEqual);
      set({ grid });
      syncHistoryFlags();
    },
    setOnMutate: (onMutate) => set({ onMutate }),

    commit: () => {
      const { grid, onMutate } = get();
      if (!grid) return;
      history?.record(snapshotOf(grid));
      syncHistoryFlags();
      onMutate?.();
    },

    undo: () => restore(history?.undo()),
    redo: () => restore(history?.redo()),

    clear: () => {
      const { grid, commit } = get();
      if (!grid) return;
      grid.clear();
      commit();
    },

    sculpt: (x, z, delta) => {
      const { grid, commit } = get();
      if (grid?.sculptTerrain(x, z, delta)) commit();
    },

    generateTerrain: async () => {
      const { grid, isGenerating } = get();
      if (!grid || isGenerating) return;

      set({ isGenerating: true });

      // Yield to the browser so the "Generating..." state can paint before the work starts.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const gridSize = useControlStore.getState().gridSize;
      grid.generateTerrain(gridSize);
      get().commit();

      set({ isGenerating: false });
    },
  };
});
