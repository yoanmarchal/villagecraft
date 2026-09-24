import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerRoofShapeControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Roof Shape',
    fields: [
      // L'avant-toit est fixe, toujours collé au bloc du dessous (voir
      // roofCellParts.ts) — seule la hauteur du faîtage (donc la taille du
      // toit) reste réglable.
      ['ridgeY', { label: 'roof height', min: 0, max: 1, step: 0.01 }],
      ['towerR', { min: 0.2, max: 0.8, step: 0.01 }],
      ['merlonCount', { min: 3, max: 12, step: 1 }],
      ['merlonR', { min: 0.03, max: 0.2, step: 0.005 }],
      ['merlonH', { min: 0.1, max: 0.6, step: 0.01 }],
      ['spireH', { min: 0.3, max: 2.5, step: 0.05 }],
    ],
  });
