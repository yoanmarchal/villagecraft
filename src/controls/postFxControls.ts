import type { Pane } from 'tweakpane';
import { useControlStore, type PostFxState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: PostFxState) {
  return {
    aoEnabled: state.aoEnabled,
    aoIntensity: state.aoIntensity,
    aoRadius: state.aoRadius,
    bloomEnabled: state.bloomEnabled,
    bloomLuminanceThreshold: state.bloomLuminanceThreshold,
    bloomLuminanceSmoothing: state.bloomLuminanceSmoothing,
    bloomHeight: state.bloomHeight,
    noiseOpacity: state.noiseOpacity,
    vignetteOffset: state.vignetteOffset,
    vignetteDarkness: state.vignetteDarkness,
  };
}

export function registerPostFxControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Post-processing', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setPostFx({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'aoEnabled', { label: 'ambient occlusion' }),
    folder.addBinding(model, 'aoIntensity', { label: 'AO intensity', min: 0, max: 6, step: 0.1 }),
    folder.addBinding(model, 'aoRadius', { label: 'AO radius', min: 0.1, max: 2, step: 0.05 }),
    folder.addBinding(model, 'bloomEnabled'),
    folder.addBinding(model, 'bloomLuminanceThreshold', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'bloomLuminanceSmoothing', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'bloomHeight', { min: 50, max: 1000, step: 10 }),
    folder.addBinding(model, 'noiseOpacity', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'vignetteOffset', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'vignetteDarkness', { min: 0, max: 1, step: 0.01 }),
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
