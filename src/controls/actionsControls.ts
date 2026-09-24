import type { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import type { Disposer } from './types';

// Les actions sur le village (annuler, générer, partager…) sont dans la
// barre d'outils (Toolbar.tsx) ; le panneau ne garde que ce qui concerne
// les réglages eux-mêmes.
export function registerActionsControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Actions' });

  const resetButton = folder.addButton({ title: 'Reset to Defaults' });
  resetButton.on('click', () => useControlStore.getState().resetToDefaults());

  return () => {
    folder.dispose();
  };
}
