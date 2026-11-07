import { useState, useEffect, useMemo, useCallback } from 'react';
import { VillageGrid } from './villageGrid';
import { VoxelScene } from './components/VoxelScene';
import { TweakpanePanel } from './components/TweakpanePanel';
import { Toolbar } from './components/Toolbar';
import { HintCard } from './components/HintCard';
import { useControlStore } from './store/controlStore';
import { useGridControllerStore } from './store/gridControllerStore';
import { useUiStore } from './store/uiStore';
import { loadVillage, saveVillage, type SavedVillage } from './store/villageStorage';
import { GRID_HEIGHT } from './config/gridConfig';

/** Ne pas détourner Ctrl+Z/Y quand l'utilisateur tape dans un champ (ex: couleur hex du panneau). */
const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Décalage qui garde le village centré quand la grille passe de `from` à `to` cases de côté. */
const centeringOffset = (from: number, to: number) => Math.floor((to - from) / 2);

/** Nouvelle grille de côté `size` contenant les blocs de `village`, recentrés (ceux qui débordent sont ignorés). */
function gridFromVillage(village: SavedVillage, size: number): VillageGrid {
  const next = new VillageGrid(size, GRID_HEIGHT, size);
  const offset = centeringOffset(village.gridSize, size);
  next.importBlocks(village.blocks, offset, offset);
  return next;
}

export function App() {
  const [renderTick, setRenderTick] = useState(0);
  const [previewCell, setPreviewCell] = useState<{ x: number; z: number } | null>(null);
  const gridSize = useControlStore((state) => state.gridSize);

  // Grille initiale restaurée depuis la sauvegarde locale ; au tout premier
  // lancement (aucune sauvegarde, même vide), un petit village généré pour ne
  // pas accueillir l'utilisateur sur une grille vide.
  const [grid, setGrid] = useState(() => {
    const saved = loadVillage();
    if (saved) return gridFromVillage(saved, gridSize);
    const initial = new VillageGrid(gridSize, GRID_HEIGHT, gridSize);
    initial.generateTerrain(gridSize);
    return initial;
  });

  // Village tel qu'il était avant une série de redimensionnements : chaque
  // nouvelle taille repart de lui, pas de la grille précédente. Glisser le
  // slider de 12 à 4 puis revenir à 12 rend donc tous les blocs, au lieu de
  // rogner un peu plus à chaque cran. Oublié à la première vraie modification.
  const [resizeSource, setResizeSource] = useState<SavedVillage | null>(null);

  // Changement de taille : on recrée la grille en y recopiant les blocs,
  // recentrés. Fait pendant le rendu ("ajuster l'état quand une prop
  // change") plutôt que dans un effet : React relance aussitôt le rendu avec
  // la nouvelle grille, sans jamais afficher une frame où `gridSize` et la
  // grille divergent.
  if (grid.width !== gridSize) {
    const source = resizeSource ?? { gridSize: grid.width, blocks: grid.exportBlocks() };
    setResizeSource(source);
    setGrid(gridFromVillage(source, gridSize));
  }

  // Prévient quand la nouvelle taille laisse des blocs hors de la grille.
  useEffect(() => {
    if (!resizeSource) return;
    const hidden = resizeSource.blocks.length - grid.exportBlocks().length;
    if (hidden > 0) {
      useUiStore
        .getState()
        .showToast(`${hidden} block${hidden > 1 ? 's' : ''} outside the grid — enlarge it to bring them back`);
    }
  }, [grid, resizeSource]);

  const refreshScene = useCallback(() => {
    setRenderTick((tick) => tick + 1);
    setResizeSource(null);
  }, []);

  // Sauvegarde après chaque mutation de la grille.
  useEffect(() => {
    saveVillage({ gridSize: grid.width, blocks: grid.exportBlocks() });
  }, [grid, renderTick]);

  // Bridge the imperative grid instance + refresh callback to the Tweakpane Actions module.
  useEffect(() => {
    useGridControllerStore.getState().setGrid(grid);
    useGridControllerStore.getState().setOnMutate(refreshScene);
  }, [grid, refreshScene]);

  // Raccourcis globaux : Ctrl+O (panneau), Ctrl+Z (annuler), Ctrl+Y / Ctrl+Shift+Z (rétablir).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (event.ctrlKey && key === 'o') {
        event.preventDefault();
        useControlStore.getState().togglePanel();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) return;
      const controller = useGridControllerStore.getState();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        controller.undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        controller.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleAddBlock = (x: number, y: number, z: number) => {
    grid.addBlock(x, y, z);
    useGridControllerStore.getState().commit();
  };

  const handleRemoveColumn = (x: number, z: number) => {
    // Colonne vide ou hors grille : rien à reconstruire.
    if (grid.removeTopBlockInColumn(x, z) === null) return;
    useGridControllerStore.getState().commit();
  };

  // ⚡ Références stables : le merge statique (VillageMeshes) ne doit être
  // reconstruit que lorsque la grille change réellement (renderTick), pas à
  // chaque re-render de App (ex: survol souris → previewCell).
  // `renderTick` n'est pas lu dans le calcul : c'est justement le signal
  // "la grille (objet mutable) a changé" qui doit invalider ce memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cells = useMemo(() => grid.getOccupiedCells(), [grid, renderTick]);
  const toWorldPosition = useCallback(
    (x: number, y: number, z: number) => grid.toWorldPosition(x, y, z),
    [grid],
  );

  return (
    <div className="app-shell">
      <div className="canvas-frame">
        <VoxelScene
          cells={cells}
          gridWidth={gridSize}
          gridDepth={gridSize}
          selectedHeight={0}
          onAddBlock={handleAddBlock}
          onRemoveColumn={handleRemoveColumn}
          onPreviewMove={(x, z) => {
            const inside = x >= 0 && z >= 0 && x < gridSize && z < gridSize;
            setPreviewCell(inside ? { x, z } : null);
          }}
          onPreviewLeave={() => setPreviewCell(null)}
          previewCell={previewCell}
          toWorldPosition={toWorldPosition}
          getNextPlacementY={(x, z, minimumY) => grid.getNextPlacementY(x, z, minimumY)}
          getRemovalY={(x, z) => grid.getTopOccupiedY(x, z)}
        />
      </div>
      <HintCard />
      <Toolbar />
      <TweakpanePanel />
    </div>
  );
}
