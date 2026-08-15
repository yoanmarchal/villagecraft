import type { Pane } from 'tweakpane';
import { useGridControllerStore } from '../store/gridControllerStore';
import type { Disposer } from './types';

export function registerActionsControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Actions' });

  const clearButton = folder.addButton({ title: 'Clear' });
  clearButton.on('click', () => useGridControllerStore.getState().clear());

  const generateButton = folder.addButton({ title: 'Generate Terrain' });
  generateButton.on('click', () => {
    void useGridControllerStore.getState().generateTerrain();
  });

  const unsubscribe = useGridControllerStore.subscribe((state) => {
    generateButton.disabled = state.isGenerating;
    generateButton.title = state.isGenerating ? 'Generating...' : 'Generate Terrain';
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
