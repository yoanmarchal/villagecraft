import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerShapeControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Wall & Tower Shape',
    fields: [
      ['isolatedWallRadius', { label: 'tower roundness', min: 0, max: 0.5, step: 0.01 }],
      ['connectedWallExposedRadius', { label: 'wall corner roundness', min: 0, max: 0.5, step: 0.01 }],
      ['connectedWallInteriorRadius', { label: 'interior corner roundness', min: 0, max: 0.5, step: 0.01 }],
    ],
  });
