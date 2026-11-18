import { useUiStore } from '../store/uiStore';

const WALK_HINTS: Array<[string, string]> = [
  ['Mouse', 'look around'],
  ['W A S D · Z Q S D', 'walk (arrows too)'],
  ['Shift', 'run'],
  ['Space', 'jump'],
  ['Esc', 'pause — again to leave'],
];

/**
 * Habillage du mode promenade : un réticule tant que le regard suit la
 * souris, et en pause (pointer lock relâché) une carte des commandes. La
 * carte ne couvre pas le centre : un clic sur la vue reprend la promenade.
 */
export function WalkOverlay() {
  const walking = useUiStore((state) => state.viewMode === 'walk');
  const locked = useUiStore((state) => state.walkLocked);
  if (!walking) return null;

  if (locked) return <div className="walk-crosshair" aria-hidden="true" />;

  return (
    <aside className="walk-card" aria-label="Walk mode">
      <h2 className="walk-card__title">Walk mode</h2>
      <p className="walk-card__intro">Click the view to look around.</p>
      <dl className="hint-card__list">
        {WALK_HINTS.map(([keys, action]) => (
          <div key={keys} className="hint-card__row">
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="hint-card__cta" onClick={() => useUiStore.getState().setViewMode('orbit')}>
        Back to the orbit view
      </button>
    </aside>
  );
}
