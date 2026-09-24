import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';
import { GRID_SIZE_MAX, GRID_SIZE_MIN } from '../config/gridConfig';

export const registerGridControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Grid',
    expanded: true,
    fields: [['gridSize', { min: GRID_SIZE_MIN, max: GRID_SIZE_MAX, step: 1 }]],
  });
