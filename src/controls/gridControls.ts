import type { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import type { Disposer } from './types';
import { GRID_SIZE_MAX, GRID_SIZE_MIN } from '../config/gridConfig';

export function registerGridControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Grid' });
  const model = { gridSize: useControlStore.getState().gridSize };

  let applyingFromPane = false;

  const binding = folder.addBinding(model, 'gridSize', { min: GRID_SIZE_MIN, max: GRID_SIZE_MAX, step: 1 });
  binding.on('change', (ev) => {
    applyingFromPane = true;
    useControlStore.getState().setGridSize(ev.value);
    applyingFromPane = false;
  });

  const unsubscribe = useControlStore.subscribe((state) => {
    if (applyingFromPane || model.gridSize === state.gridSize) return;
    model.gridSize = state.gridSize;
    folder.refresh();
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
