import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Effet d'un clic gauche / tap sur la scène. Le clic droit démolit avec les
 * outils de construction, et fait l'inverse avec ceux du terrain (relever ↔ creuser).
 */
export type ToolMode = 'build' | 'demolish' | 'raise' | 'lower';

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

  /**
   * Vue : `orbit` (construction, OrbitControls) ou `walk` (promenade à la
   * première personne, voir docs/walk.md). Jamais mémorisée : on rouvre en orbite.
   */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** En promenade, le pointeur est capturé (pointer lock) : le regard suit la souris. */
  walkLocked: boolean;
  setWalkLocked: (locked: boolean) => void;
}

export type ViewMode = 'orbit' | 'walk';

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

      viewMode: 'orbit',
      setViewMode: (viewMode) => set({ viewMode, walkLocked: false }),
      walkLocked: false,
      setWalkLocked: (walkLocked) => set({ walkLocked }),
    }),
    {
      name: 'villagecraft-ui',
      version: 1,
      partialize: (state) => ({ hintVisible: state.hintVisible }),
    },
  ),
);
