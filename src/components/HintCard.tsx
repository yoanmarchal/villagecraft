import { useUiStore } from '../store/uiStore';
import { CloseIcon } from './icons';

const MOUSE_HINTS: Array<[string, string]> = [
  ['Click', 'build a block'],
  ['Right click', 'demolish the top block'],
  ['Drag · scroll', 'orbit · zoom'],
  ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
  ['Ctrl+O', 'advanced settings'],
];

const TOUCH_HINTS: Array<[string, string]> = [
  ['Tap', 'build — or demolish with the pick tool'],
  ['Drag', 'orbit the camera'],
  ['Pinch', 'zoom'],
];

const isTouchOnly = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Aide des contrôles au premier lancement ; rouvrable via le bouton "?" de la barre d'outils. */
export function HintCard() {
  const visible = useUiStore((state) => state.hintVisible);
  if (!visible) return null;

  const dismiss = () => useUiStore.getState().setHintVisible(false);

  return (
    <aside className="hint-card" aria-label="Controls">
      <header className="hint-card__header">
        <h1 className="hint-card__title">VillageCraft</h1>
        <button type="button" className="icon-button" aria-label="Close help" title="Close" onClick={dismiss}>
          <CloseIcon />
        </button>
      </header>
      <p className="hint-card__intro">Place blocks — walls, windows, roofs, arches and towers shape themselves.</p>
      <dl className="hint-card__list">
        {(isTouchOnly() ? TOUCH_HINTS : MOUSE_HINTS).map(([keys, action]) => (
          <div key={keys} className="hint-card__row">
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="hint-card__cta" onClick={dismiss}>
        Got it
      </button>
    </aside>
  );
}
