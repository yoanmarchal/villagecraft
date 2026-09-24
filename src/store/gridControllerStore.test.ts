import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VillageGrid } from '../villageGrid';
import { useGridControllerStore } from './gridControllerStore';

describe('gridControllerStore — annuler / rétablir', () => {
  let grid: VillageGrid;
  const onMutate = vi.fn();
  const store = () => useGridControllerStore.getState();

  beforeEach(() => {
    grid = new VillageGrid(3, 10, 3);
    onMutate.mockClear();
    store().setGrid(grid);
    store().setOnMutate(onMutate);
  });

  it('enregistre chaque mutation et rafraîchit la scène', () => {
    grid.addBlock(0, 0, 0);
    store().commit();

    expect(onMutate).toHaveBeenCalledTimes(1);
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);
  });

  it("annule et rétablit l'état de la grille", () => {
    grid.addBlock(0, 0, 0);
    store().commit();
    grid.addBlock(2, 0, 2);
    store().commit();

    store().undo();
    expect(grid.exportBlocks()).toEqual([[0, 0, 0]]);
    store().undo();
    expect(grid.exportBlocks()).toEqual([]);
    expect(store().canUndo).toBe(false);

    store().redo();
    store().redo();
    expect(grid.exportBlocks()).toEqual([[0, 0, 0], [2, 0, 2]]);
  });

  it("un clic sans effet n'ajoute pas d'étape d'historique", () => {
    grid.removeTopBlockInColumn(1, 1); // colonne vide
    store().commit();
    expect(store().canUndo).toBe(false);
  });

  it("Clear s'annule", () => {
    grid.addBlock(1, 0, 1);
    store().commit();
    store().clear();
    expect(grid.exportBlocks()).toEqual([]);

    store().undo();
    expect(grid.exportBlocks()).toEqual([[1, 0, 1]]);
  });

  it('une nouvelle grille repart d’un historique vierge', () => {
    grid.addBlock(0, 0, 0);
    store().commit();
    store().setGrid(new VillageGrid(4, 10, 4));
    expect(store().canUndo).toBe(false);
  });
});
