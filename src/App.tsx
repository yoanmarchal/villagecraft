import { useState, useEffect, useMemo, useCallback } from 'react';
import { VillageGrid } from './villageGrid';
import { VoxelScene } from './components/VoxelScene';
import { TweakpanePanel } from './components/TweakpanePanel';
import { useControlStore } from './store/controlStore';
import { useGridControllerStore } from './store/gridControllerStore';
import { loadVillage, saveVillage } from './store/villageStorage';

const GRID_HEIGHT = 10;

/** Décalage qui garde le village centré quand la grille passe de `from` à `to` cases de côté. */
const centeringOffset = (from: number, to: number) => Math.floor((to - from) / 2);

export function App() {
  const [renderTick, setRenderTick] = useState(0);
  const [previewCell, setPreviewCell] = useState<{ x: number; z: number } | null>(null);
  const gridSize = useControlStore((state) => state.gridSize);

  // Grille initiale restaurée depuis la sauvegarde locale, s'il y en a une.
  const [grid, setGrid] = useState(() => {
    const initial = new VillageGrid(gridSize, GRID_HEIGHT, gridSize);
    const saved = loadVillage();
    if (saved) {
      const offset = centeringOffset(saved.gridSize, gridSize);
      initial.importBlocks(saved.blocks, offset, offset);
    }
    return initial;
  });

  // Changement de taille : on recrée la grille en y recopiant les blocs,
  // recentrés (ceux qui sortent de la nouvelle grille sont perdus).
  useEffect(() => {
    setGrid((prev) => {
      if (prev.width === gridSize) return prev;
      const next = new VillageGrid(gridSize, GRID_HEIGHT, gridSize);
      const offset = centeringOffset(prev.width, gridSize);
      next.importBlocks(prev.exportBlocks(), offset, offset);
      return next;
    });
  }, [gridSize]);

  const refreshScene = useCallback(() => setRenderTick((tick) => tick + 1), []);

  // Sauvegarde après chaque mutation de la grille.
  useEffect(() => {
    saveVillage({ gridSize: grid.width, blocks: grid.exportBlocks() });
  }, [grid, renderTick]);

  // Bridge the imperative grid instance + refresh callback to the Tweakpane Actions module.
  useEffect(() => {
    useGridControllerStore.getState().setGrid(grid);
    useGridControllerStore.getState().setOnMutate(refreshScene);
  }, [grid, refreshScene]);

  // Global shortcut to show/hide the control panel (Ctrl+O).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        useControlStore.getState().togglePanel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleAddBlock = (x: number, y: number, z: number) => {
    grid.addBlock(x, y, z);
    refreshScene();
  };

  const handleRemoveColumn = (x: number, z: number) => {
    grid.removeTopBlockInColumn(x, z);
    refreshScene();
  };

  // ⚡ Références stables : le merge statique (VillageMeshes) ne doit être
  // reconstruit que lorsque la grille change réellement (renderTick), pas à
  // chaque re-render de App (ex: survol souris → previewCell).
  const cells = useMemo(() => grid.getOccupiedCells(), [grid, renderTick]);
  const toWorldPosition = useCallback(
    (x: number, y: number, z: number) => grid.toWorldPosition(x, y, z),
    [grid],
  );

  return (
    <div className="app-shell compact-shell">
      <div className="canvas-frame">
        <VoxelScene
          cells={cells}
          gridWidth={gridSize}
          gridDepth={gridSize}
          selectedHeight={0}
          onAddBlock={handleAddBlock}
          onRemoveColumn={handleRemoveColumn}
          onPreviewMove={(x, z) => {
            // Only allow preview within the selected grid size
            if (x < gridSize && z < gridSize) {
              setPreviewCell({ x, z });
            } else {
              setPreviewCell(null);
            }
          }}
          previewCell={previewCell}
          toWorldPosition={toWorldPosition}
          getNextPlacementY={(x, z, minimumY) => grid.getNextPlacementY(x, z, minimumY)}
        />
      </div>
      <TweakpanePanel />
    </div>
  );
}
