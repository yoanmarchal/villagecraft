import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerCameraControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Camera',
    fields: [
      ['dampingFactor', { min: 0, max: 1, step: 0.01 }],
      ['maxPolarAngle', { min: 0, max: Math.PI, step: 0.01 }],
      ['minDistance', { min: 1, max: 50, step: 0.5 }],
      ['maxDistance', { min: 1, max: 100, step: 0.5 }],
    ],
  });
