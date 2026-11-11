import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerDecorationsControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Decorations',
    fields: [
      ['windowStoneRoughness', { label: 'stone roughness', min: 0, max: 1, step: 0.01 }],
      ['quoinMargin', { min: 0.05, max: 0.45, step: 0.01 }],
      ['quoinRoughness', { min: 0, max: 1, step: 0.01 }],
    ],
  });
