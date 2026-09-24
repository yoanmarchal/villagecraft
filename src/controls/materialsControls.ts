import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerMaterialsControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Materials',
    fields: [
      ['wallBaseColor', { label: 'wall color' }],
      ['roofBaseColor', { label: 'roof color' }],
      ['spireColor', { label: 'tower slate color' }],
      ['wallRoughness', { min: 0, max: 1, step: 0.01 }],
    ],
  });
