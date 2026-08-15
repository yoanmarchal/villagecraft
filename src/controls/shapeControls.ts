import type { Pane } from 'tweakpane';
import { useControlStore, type CellShapeState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: CellShapeState) {
  return {
    isolatedWallRadius: state.isolatedWallRadius,
    connectedWallExposedRadius: state.connectedWallExposedRadius,
    connectedWallInteriorRadius: state.connectedWallInteriorRadius,
  };
}

export function registerShapeControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Wall & Tower Shape', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setCellShape({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'isolatedWallRadius', {
      label: 'tower roundness',
      min: 0,
      max: 0.5,
      step: 0.01,
    }),
    folder.addBinding(model, 'connectedWallExposedRadius', {
      label: 'wall corner roundness',
      min: 0,
      max: 0.5,
      step: 0.01,
    }),
    folder.addBinding(model, 'connectedWallInteriorRadius', {
      label: 'interior corner roundness',
      min: 0,
      max: 0.5,
      step: 0.01,
    }),
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
