import { useState, useEffect, useMemo, useCallback } from 'react';
import { VillageGrid } from './villageGrid';
import { VoxelScene } from './components/VoxelScene';
import { TweakpanePanel } from './components/TweakpanePanel';
import { useControlStore } from './store/controlStore';
import { useGridControllerStore } from './store/gridControllerStore';

const GRID_HEIGHT = 10;

export function App() {
  const [renderTick, setRenderTick] = useState(0);
  const [previewCell, setPreviewCell] = useState<{ x: number; z: number } | null>(null);
  const gridSize = useControlStore((state) => state.gridSize);

  // Create VillageGrid with dynamic size based on gridSize
  const [grid, setGrid] = useState(() => new VillageGrid(gridSize, GRID_HEIGHT, gridSize));

  // Recreate grid when gridSize changes
  useEffect(() => {
    setGrid(new VillageGrid(gridSize, GRID_HEIGHT, gridSize));
  }, [gridSize]);

  const refreshScene = useCallback(() => setRenderTick((tick) => tick + 1), []);

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
