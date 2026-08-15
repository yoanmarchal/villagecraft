import type { Pane } from 'tweakpane';
import { useControlStore, type CellDecorationsState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: CellDecorationsState) {
  return {
    standardStonesPerFace: state.standardStonesPerFace,
    windowStonesPerFace: state.windowStonesPerFace,
    standardStoneRoughness: state.standardStoneRoughness,
    windowStoneRoughness: state.windowStoneRoughness,
    quoinMargin: state.quoinMargin,
    quoinRoughness: state.quoinRoughness,
  };
}

export function registerDecorationsControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Decorations', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setCellDecorations({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'standardStonesPerFace', { min: 0, max: 40, step: 1 }),
    folder.addBinding(model, 'windowStonesPerFace', { min: 0, max: 60, step: 1 }),
    folder.addBinding(model, 'standardStoneRoughness', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'windowStoneRoughness', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'quoinMargin', { min: 0.05, max: 0.45, step: 0.01 }),
    folder.addBinding(model, 'quoinRoughness', { min: 0, max: 1, step: 0.01 }),
  ];

  bindings.forEach((binding) => binding.on('change', applyPatch));

  const unsubscribe = useControlStore.subscribe((state) => {
    if (applyingFromPane) return;
    Object.assign(model, toModel(state));
    folder.refresh();
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
