import type { Pane } from 'tweakpane';
import { useControlStore, type SkyFogState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: SkyFogState) {
  return {
    skyTopColor: state.skyTopColor,
    skyHorizonColor: state.skyHorizonColor,
    fogColor: state.fogColor,
    fogNear: state.fogNear,
    fogFar: state.fogFar,
    groundColor: state.groundColor,
    groundRoughness: state.groundRoughness,
  };
}

export function registerSkyFogControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Sky, Fog & Ground', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setSkyFog({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'skyTopColor', { label: 'sky (top)' }),
    folder.addBinding(model, 'skyHorizonColor', { label: 'sky (horizon)' }),
    folder.addBinding(model, 'fogColor'),
    folder.addBinding(model, 'fogNear', { min: 0, max: 100, step: 1 }),
    folder.addBinding(model, 'fogFar', { min: 0, max: 200, step: 1 }),
    folder.addBinding(model, 'groundColor', { label: 'grass' }),
    folder.addBinding(model, 'groundRoughness', { min: 0, max: 1, step: 0.01 }),
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
