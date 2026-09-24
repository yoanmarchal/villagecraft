import type { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import { useGridControllerStore } from '../store/gridControllerStore';
import { buildShareUrl } from '../store/shareLink';
import type { Disposer } from './types';

const SHARE_TITLE = 'Copy Share Link';
const SHARE_FEEDBACK_MS = 2000;

export function registerActionsControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Actions' });

  const undoButton = folder.addButton({ title: 'Undo (Ctrl+Z)' });
  undoButton.on('click', () => useGridControllerStore.getState().undo());

  const redoButton = folder.addButton({ title: 'Redo (Ctrl+Y)' });
  redoButton.on('click', () => useGridControllerStore.getState().redo());

  const clearButton = folder.addButton({ title: 'Clear' });
  clearButton.on('click', () => useGridControllerStore.getState().clear());

  const generateButton = folder.addButton({ title: 'Generate Terrain' });
  generateButton.on('click', () => {
    void useGridControllerStore.getState().generateTerrain();
  });

  const shareButton = folder.addButton({ title: SHARE_TITLE });
  let shareFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  shareButton.on('click', async () => {
    const { grid } = useGridControllerStore.getState();
    if (!grid) return;
    const url = buildShareUrl({ gridSize: grid.width, blocks: grid.exportBlocks() });
    try {
      await navigator.clipboard.writeText(url);
      shareButton.title = 'Link copied!';
      clearTimeout(shareFeedbackTimer);
      shareFeedbackTimer = setTimeout(() => (shareButton.title = SHARE_TITLE), SHARE_FEEDBACK_MS);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission…) : copie manuelle.
      window.prompt('Copy this link:', url);
    }
  });

  const resetButton = folder.addButton({ title: 'Reset to Defaults' });
  resetButton.on('click', () => useControlStore.getState().resetToDefaults());

  const syncButtons = () => {
    const { isGenerating, canUndo, canRedo } = useGridControllerStore.getState();
    undoButton.disabled = !canUndo;
    redoButton.disabled = !canRedo;
    generateButton.disabled = isGenerating;
    generateButton.title = isGenerating ? 'Generating...' : 'Generate Terrain';
  };
  syncButtons();
  const unsubscribe = useGridControllerStore.subscribe(syncButtons);

  return () => {
    clearTimeout(shareFeedbackTimer);
    unsubscribe();
    folder.dispose();
  };
}
