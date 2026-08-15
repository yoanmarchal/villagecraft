import type { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import type { Disposer } from './types';

export function registerGridControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Grid' });
  const model = { gridSize: useControlStore.getState().gridSize };

  let applyingFromPane = false;

  const binding = folder.addBinding(model, 'gridSize', { min: 2, max: 5, step: 1 });
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
