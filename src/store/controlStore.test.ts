import { describe, expect, it } from 'vitest';
import { migrateControlState } from './controlStore';

describe('migrateControlState (v1 → v2)', () => {
  it("remplace les valeurs restées à l'ancien défaut", () => {
    const migrated = migrateControlState({ ambientIntensity: 1.3, groundColor: '#f5e6d3', bloomLuminanceThreshold: 0.3 }, 1);
    expect(migrated.ambientIntensity).toBe(0.7);
    expect(migrated.groundColor).toBe('#a9bd84');
    expect(migrated.bloomLuminanceThreshold).toBe(0.85);
  });

  it('conserve les réglages personnalisés', () => {
    const migrated = migrateControlState({ ambientIntensity: 2.2, groundColor: '#123456', gridSize: 9 }, 1);
    expect(migrated).toMatchObject({ ambientIntensity: 2.2, groundColor: '#123456', gridSize: 9 });
  });

  it('supprime les réglages du ciel physique', () => {
    const migrated = migrateControlState({ skyTurbidity: 8, skySunPosition: [1, 2, 3], backgroundColor: '#fff', groundOpacity: 1 }, 1);
    expect(migrated).toEqual({});
  });

  it("ne touche pas à un état déjà en v2", () => {
    const state = { ambientIntensity: 1.3 };
    expect(migrateControlState(state, 2)).toEqual(state);
  });
});
