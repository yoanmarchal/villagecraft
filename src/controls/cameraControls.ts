import type { Pane } from 'tweakpane';
import { useControlStore, type CameraState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: CameraState) {
  return {
    dampingFactor: state.dampingFactor,
    maxPolarAngle: state.maxPolarAngle,
    minDistance: state.minDistance,
    maxDistance: state.maxDistance,
  };
}

export function registerCameraControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Camera', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setCamera({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'dampingFactor', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'maxPolarAngle', { min: 0, max: Math.PI, step: 0.01 }),
    folder.addBinding(model, 'minDistance', { min: 1, max: 50, step: 0.5 }),
    folder.addBinding(model, 'maxDistance', { min: 1, max: 100, step: 0.5 }),
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
