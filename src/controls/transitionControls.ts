import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerTransitionControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Transitions',
    fields: [['blockTransitionEnabled', { label: 'Block pop-in' }]],
  });
