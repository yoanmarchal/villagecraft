import type { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import type { Disposer } from './types';

export function registerTransitionControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Transitions', expanded: false });
  const model = { blockTransitionEnabled: useControlStore.getState().blockTransitionEnabled };

  let applyingFromPane = false;

  const binding = folder.addBinding(model, 'blockTransitionEnabled', { label: 'Block pop-in' });
  binding.on('change', (ev) => {
    applyingFromPane = true;
    useControlStore.getState().setCellTransition({ blockTransitionEnabled: ev.value });
    applyingFromPane = false;
  });

  const unsubscribe = useControlStore.subscribe((state) => {
    if (applyingFromPane || model.blockTransitionEnabled === state.blockTransitionEnabled) return;
    model.blockTransitionEnabled = state.blockTransitionEnabled;
    folder.refresh();
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
