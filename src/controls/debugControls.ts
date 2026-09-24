import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerDebugControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Debug',
    fields: [['showPerfMonitor', { label: 'Perf monitor' }]],
  });
