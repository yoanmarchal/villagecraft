import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerPostFxControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Post-processing',
    fields: [
      ['aoEnabled', { label: 'ambient occlusion' }],
      ['aoIntensity', { label: 'AO intensity', min: 0, max: 6, step: 0.1 }],
      ['aoRadius', { label: 'AO radius', min: 0.1, max: 2, step: 0.05 }],
      ['bloomEnabled'],
      ['bloomLuminanceThreshold', { min: 0, max: 1, step: 0.01 }],
      ['bloomLuminanceSmoothing', { min: 0, max: 1, step: 0.01 }],
      ['bloomHeight', { min: 50, max: 1000, step: 10 }],
      ['noiseOpacity', { min: 0, max: 1, step: 0.01 }],
      ['vignetteOffset', { min: 0, max: 1, step: 0.01 }],
      ['vignetteDarkness', { min: 0, max: 1, step: 0.01 }],
    ],
  });
