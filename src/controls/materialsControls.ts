import type { Pane } from 'tweakpane';
import { useControlStore, type CellMaterialsState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: CellMaterialsState) {
  return {
    wallBaseColor: state.wallBaseColor,
    roofBaseColor: state.roofBaseColor,
    wallRoughness: state.wallRoughness,
  };
}

export function registerMaterialsControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Materials', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setCellMaterials({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'wallBaseColor', { label: 'wall color' }),
    folder.addBinding(model, 'roofBaseColor', { label: 'roof color' }),
    folder.addBinding(model, 'wallRoughness', { min: 0, max: 1, step: 0.01 }),
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
