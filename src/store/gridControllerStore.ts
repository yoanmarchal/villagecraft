import { create } from 'zustand';
import type { VillageGrid } from '../villageGrid';
import { useControlStore } from './controlStore';

interface GridControllerState {
  grid: VillageGrid | null;
  isGenerating: boolean;
  onMutate: (() => void) | null;
  setGrid: (grid: VillageGrid) => void;
  setOnMutate: (onMutate: () => void) => void;
  clear: () => void;
  generateTerrain: () => Promise<void>;
}

export const useGridControllerStore = create<GridControllerState>()((set, get) => ({
  grid: null,
  isGenerating: false,
  onMutate: null,

  setGrid: (grid) => set({ grid }),
  setOnMutate: (onMutate) => set({ onMutate }),

  clear: () => {
    const { grid, onMutate } = get();
    if (!grid) return;
    grid.clear();
    onMutate?.();
  },

  generateTerrain: async () => {
    const { grid, onMutate, isGenerating } = get();
    if (!grid || isGenerating) return;

    set({ isGenerating: true });

    // Yield to the browser so the "Generating..." state can paint before the work starts.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const gridSize = useControlStore.getState().gridSize;
    grid.generateTerrain(gridSize);
    onMutate?.();

    set({ isGenerating: false });
  },
}));
