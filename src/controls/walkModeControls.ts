import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerWalkModeControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Walk mode',
    fields: [
      ['walkMouseSensitivity', { label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05 }],
      ['walkInvertY', { label: 'Invert mouse Y' }],
      ['walkFov', { label: 'Field of view', min: 50, max: 100, step: 1 }],
    ],
  });
