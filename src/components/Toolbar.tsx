/**
 * Barre d'outils principale (bas de l'écran) : outil actif, historique,
 * génération, ambiance, partage et capture. Les réglages fins restent dans
 * le panneau Tweakpane (Ctrl+O).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AMBIENCE_PRESETS, matchAmbience, type AmbienceSettings } from '../config/ambiencePresets';
import { useControlStore, type ControlState } from '../store/controlStore';
import { useGridControllerStore } from '../store/gridControllerStore';
import { copyShareLink } from '../store/shareLink';
import { useUiStore } from '../store/uiStore';
import {
  BuildIcon,
  CameraIcon,
  ClearIcon,
  DemolishIcon,
  GenerateIcon,
  HelpIcon,
  RedoIcon,
  ShareIcon,
  UndoIcon,
} from './icons';

const TOAST_MS = 2200;

const selectAmbience = (state: ControlState): AmbienceSettings => ({
  ambientIntensity: state.ambientIntensity,
  ambientColor: state.ambientColor,
  directionalIntensity: state.directionalIntensity,
  directionalColor: state.directionalColor,
  directionalPosition: state.directionalPosition,
  windowGlow: state.windowGlow,
  skyTopColor: state.skyTopColor,
  skyHorizonColor: state.skyHorizonColor,
  fogColor: state.fogColor,
  fogNear: state.fogNear,
  fogFar: state.fogFar,
});

/** La pastille reprend le dégradé du ciel de l'ambiance. */
const swatchStyle = ({ skyTopColor, skyHorizonColor }: AmbienceSettings) => ({
  background: `linear-gradient(${skyTopColor}, ${skyHorizonColor})`,
});

interface ToolButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}

function ToolButton({ label, onClick, disabled, pressed, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="tool-button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AmbiencePicker() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = matchAmbience(useControlStore(useShallow(selectAmbience)));

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="ambience" ref={rootRef}>
      <button
        type="button"
        className="tool-button"
        title={`Ambience: ${current?.label ?? 'Custom'}`}
        aria-label={`Ambience: ${current?.label ?? 'Custom'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`swatch${current ? '' : ' swatch--custom'}`} style={current ? swatchStyle(current.settings) : undefined} />
      </button>
      {open && (
        <div className="ambience-menu" role="menu">
          {AMBIENCE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="menuitemradio"
              aria-checked={preset.id === current?.id}
              className="ambience-option"
              onClick={() => {
                useControlStore.setState(preset.settings);
                setOpen(false);
              }}
            >
              <span className="swatch" style={swatchStyle(preset.settings)} />
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const toolMode = useUiStore((state) => state.toolMode);
  const { canUndo, canRedo, isGenerating } = useGridControllerStore(
    useShallow((state) => ({ canUndo: state.canUndo, canRedo: state.canRedo, isGenerating: state.isGenerating })),
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const { setToolMode, setHintVisible } = useUiStore.getState();
  const controller = useGridControllerStore.getState;

  const share = async () => {
    const { grid } = controller();
    if (!grid) return;
    const result = await copyShareLink({ gridSize: grid.width, blocks: grid.exportBlocks() });
    if (result === 'copied') showToast('Share link copied');
  };

  const screenshot = () => {
    const capture = useUiStore.getState().captureScreenshot;
    if (!capture) return;
    const link = document.createElement('a');
    link.href = capture();
    link.download = `villagecraft-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    link.click();
    showToast('Screenshot saved');
  };

  return (
    <div className="toolbar-dock">
      <div className="toast" role="status" aria-live="polite">
        {toast && <span className="toast-message">{toast}</span>}
      </div>
      <div className="toolbar" role="toolbar" aria-label="Village tools">
        <div className="tool-group tool-group--segmented">
          <ToolButton label="Build (left click)" pressed={toolMode === 'build'} onClick={() => setToolMode('build')}>
            <BuildIcon />
          </ToolButton>
          <ToolButton label="Demolish (or right click)" pressed={toolMode === 'demolish'} onClick={() => setToolMode('demolish')}>
            <DemolishIcon />
          </ToolButton>
        </div>

        <div className="tool-group">
          <ToolButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => controller().undo()}>
            <UndoIcon />
          </ToolButton>
          <ToolButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => controller().redo()}>
            <RedoIcon />
          </ToolButton>
        </div>

        <div className="tool-group">
          <ToolButton
            label={isGenerating ? 'Generating…' : 'Generate a random village'}
            disabled={isGenerating}
            onClick={() => void controller().generateTerrain()}
          >
            <GenerateIcon />
          </ToolButton>
          <ToolButton label="Clear (undoable)" onClick={() => controller().clear()}>
            <ClearIcon />
          </ToolButton>
        </div>

        <div className="tool-group">
          <AmbiencePicker />
        </div>

        <div className="tool-group">
          <ToolButton label="Copy share link" onClick={() => void share()}>
            <ShareIcon />
          </ToolButton>
          <ToolButton label="Save screenshot" onClick={screenshot}>
            <CameraIcon />
          </ToolButton>
          <ToolButton label="Help" onClick={() => setHintVisible(true)}>
            <HelpIcon />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
