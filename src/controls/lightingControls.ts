import type { Pane } from 'tweakpane';
import { useControlStore, type LightingState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: LightingState) {
  return {
    ambientIntensity: state.ambientIntensity,
    ambientColor: state.ambientColor,
    directionalIntensity: state.directionalIntensity,
    directionalColor: state.directionalColor,
    directionalPositionX: state.directionalPosition[0],
    directionalPositionY: state.directionalPosition[1],
    directionalPositionZ: state.directionalPosition[2],
    shadowMapSize: state.shadowMapSize,
    shadowRadius: state.shadowRadius,
    shadowBias: state.shadowBias,
  };
}

export function registerLightingControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Lighting', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setLighting({
      ambientIntensity: model.ambientIntensity,
      ambientColor: model.ambientColor,
      directionalIntensity: model.directionalIntensity,
      directionalColor: model.directionalColor,
      directionalPosition: [model.directionalPositionX, model.directionalPositionY, model.directionalPositionZ],
      shadowMapSize: model.shadowMapSize,
      shadowRadius: model.shadowRadius,
      shadowBias: model.shadowBias,
    });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'ambientIntensity', { min: 0, max: 5, step: 0.05 }),
    folder.addBinding(model, 'ambientColor'),
    folder.addBinding(model, 'directionalIntensity', { min: 0, max: 5, step: 0.05 }),
    folder.addBinding(model, 'directionalColor'),
    folder.addBinding(model, 'directionalPositionX', { min: -50, max: 50, step: 0.5 }),
    folder.addBinding(model, 'directionalPositionY', { min: -50, max: 50, step: 0.5 }),
    folder.addBinding(model, 'directionalPositionZ', { min: -50, max: 50, step: 0.5 }),
    folder.addBinding(model, 'shadowMapSize', { min: 256, max: 4096, step: 256 }),
    folder.addBinding(model, 'shadowRadius', { min: 0, max: 10, step: 0.5 }),
    folder.addBinding(model, 'shadowBias', { min: -0.01, max: 0.01, step: 0.0001 }),
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
