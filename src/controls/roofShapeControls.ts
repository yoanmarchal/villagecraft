import type { Pane } from 'tweakpane';
import { useControlStore, type CellRoofState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: CellRoofState) {
  return {
    eaveY: state.eaveY,
    ridgeY: state.ridgeY,
    towerR: state.towerR,
    merlonCount: state.merlonCount,
    merlonR: state.merlonR,
    merlonH: state.merlonH,
    spireH: state.spireH,
  };
}

export function registerRoofShapeControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Roof Shape', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setCellRoof({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'eaveY', { min: -1, max: 0, step: 0.01 }),
    folder.addBinding(model, 'ridgeY', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'towerR', { min: 0.2, max: 0.8, step: 0.01 }),
    folder.addBinding(model, 'merlonCount', { min: 3, max: 12, step: 1 }),
    folder.addBinding(model, 'merlonR', { min: 0.03, max: 0.2, step: 0.005 }),
    folder.addBinding(model, 'merlonH', { min: 0.1, max: 0.6, step: 0.01 }),
    folder.addBinding(model, 'spireH', { min: 0.3, max: 2.5, step: 0.05 }),
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
