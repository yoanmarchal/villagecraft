import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerSkyFogControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Sky, Fog & Ground',
    fields: [
      ['skyTopColor', { label: 'sky (top)' }],
      ['skyHorizonColor', { label: 'sky (horizon)' }],
      ['fogColor'],
      ['fogNear', { min: 0, max: 100, step: 1 }],
      ['fogFar', { min: 0, max: 200, step: 1 }],
      ['groundColor', { label: 'grass' }],
      ['groundRoughness', { min: 0, max: 1, step: 0.01 }],
    ],
  });
