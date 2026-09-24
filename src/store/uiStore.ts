import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Effet d'un clic gauche / tap sur la scène (le clic droit démolit toujours). */
export type ToolMode = 'build' | 'demolish';

const TOAST_MS = 2200;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

interface UiState {
  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;

  /** Carte d'aide des contrôles — affichée jusqu'à ce que l'utilisateur la ferme (mémorisé). */
  hintVisible: boolean;
  setHintVisible: (visible: boolean) => void;

  /** Rend une frame et retourne le canvas en PNG (data URL) ; fourni par la scène une fois montée. */
  captureScreenshot: (() => string) | null;
  setCaptureScreenshot: (capture: (() => string) | null) => void;

  /** Message bref au-dessus de la barre d'outils (lien copié, action impossible…). */
  toast: string | null;
  showToast: (message: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      toolMode: 'build',
      setToolMode: (toolMode) => set({ toolMode }),

      hintVisible: true,
      setHintVisible: (hintVisible) => set({ hintVisible }),

      captureScreenshot: null,
      setCaptureScreenshot: (captureScreenshot) => set({ captureScreenshot }),

      toast: null,
      showToast: (toast) => {
        set({ toast });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
      },
    }),
    {
      name: 'villagecraft-ui',
      version: 1,
      partialize: (state) => ({ hintVisible: state.hintVisible }),
    },
  ),
);
