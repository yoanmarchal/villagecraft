import type { Pane } from 'tweakpane';
import { useControlStore, type SkyFogState } from '../store/controlStore';
import type { Disposer } from './types';

function toModel(state: SkyFogState) {
  return {
    backgroundColor: state.backgroundColor,
    fogColor: state.fogColor,
    fogNear: state.fogNear,
    fogFar: state.fogFar,
    skyDistance: state.skyDistance,
    skySunPositionX: state.skySunPosition[0],
    skySunPositionY: state.skySunPosition[1],
    skySunPositionZ: state.skySunPosition[2],
    skyInclination: state.skyInclination,
    skyAzimuth: state.skyAzimuth,
    skyTurbidity: state.skyTurbidity,
    skyRayleigh: state.skyRayleigh,
    groundColor: state.groundColor,
    groundOpacity: state.groundOpacity,
    groundRoughness: state.groundRoughness,
  };
}

export function registerSkyFogControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Sky & Fog', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setSkyFog({
      backgroundColor: model.backgroundColor,
      fogColor: model.fogColor,
      fogNear: model.fogNear,
      fogFar: model.fogFar,
      skyDistance: model.skyDistance,
      skySunPosition: [model.skySunPositionX, model.skySunPositionY, model.skySunPositionZ],
      skyInclination: model.skyInclination,
      skyAzimuth: model.skyAzimuth,
      skyTurbidity: model.skyTurbidity,
      skyRayleigh: model.skyRayleigh,
      groundColor: model.groundColor,
      groundOpacity: model.groundOpacity,
      groundRoughness: model.groundRoughness,
    });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'backgroundColor'),
    folder.addBinding(model, 'fogColor'),
    folder.addBinding(model, 'fogNear', { min: 0, max: 100, step: 1 }),
    folder.addBinding(model, 'fogFar', { min: 0, max: 200, step: 1 }),
    folder.addBinding(model, 'skyDistance', { min: 1000, max: 500000, step: 1000 }),
    folder.addBinding(model, 'skySunPositionX', { min: -200, max: 200, step: 1 }),
    folder.addBinding(model, 'skySunPositionY', { min: -200, max: 200, step: 1 }),
    folder.addBinding(model, 'skySunPositionZ', { min: -200, max: 200, step: 1 }),
    folder.addBinding(model, 'skyInclination', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'skyAzimuth', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'skyTurbidity', { min: 0, max: 20, step: 0.1 }),
    folder.addBinding(model, 'skyRayleigh', { min: 0, max: 4, step: 0.05 }),
    folder.addBinding(model, 'groundColor'),
    folder.addBinding(model, 'groundOpacity', { min: 0, max: 1, step: 0.01 }),
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
