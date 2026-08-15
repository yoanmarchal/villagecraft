import type { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import type { Disposer } from './types';

export function registerDebugControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Debug', expanded: false });
  const model = { showPerfMonitor: useControlStore.getState().showPerfMonitor };

  let applyingFromPane = false;

  const binding = folder.addBinding(model, 'showPerfMonitor', { label: 'Perf monitor' });
  binding.on('change', (ev) => {
    applyingFromPane = true;
    useControlStore.getState().setDebug({ showPerfMonitor: ev.value });
    applyingFromPane = false;
  });

  const unsubscribe = useControlStore.subscribe((state) => {
    if (applyingFromPane || model.showPerfMonitor === state.showPerfMonitor) return;
    model.showPerfMonitor = state.showPerfMonitor;
    folder.refresh();
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
