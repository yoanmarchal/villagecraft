import { describe, expect, it } from 'vitest';
import { migrateControlState } from './controlStore';

describe('migrateControlState (v1 → v2)', () => {
  it("remplace les valeurs restées à l'ancien défaut", () => {
    const migrated = migrateControlState(
      { ambientIntensity: 1.3, groundColor: '#f5e6d3', bloomLuminanceThreshold: 0.3 },
      1,
    );
    expect(migrated.ambientIntensity).toBe(1.1);
    expect(migrated.groundColor).toBe('#6f8a4a');
    expect(migrated.bloomLuminanceThreshold).toBe(0.85);
  });

  it('conserve les réglages personnalisés', () => {
    const migrated = migrateControlState({ ambientIntensity: 2.2, groundColor: '#123456', gridSize: 9 }, 1);
    expect(migrated).toMatchObject({ ambientIntensity: 2.2, groundColor: '#123456', gridSize: 9 });
  });

  it('supprime les réglages du ciel physique', () => {
    const migrated = migrateControlState(
      { skyTurbidity: 8, skySunPosition: [1, 2, 3], backgroundColor: '#fff', groundOpacity: 1 },
      1,
    );
    expect(migrated).toEqual({});
  });

  it('ne touche pas à un état déjà à jour', () => {
    const state = { ambientIntensity: 1.3 };
    expect(migrateControlState(state, 3)).toEqual(state);
  });
});

describe('migrateControlState (v2 → v3)', () => {
  it("remplace l'éclairage resté au défaut v2, tableaux compris", () => {
    const migrated = migrateControlState(
      { directionalPosition: [12, 16, 10], fogFar: 60, roofBaseColor: '#c85a3f', ambientIntensity: 0.7 },
      2,
    );
    expect(migrated).toEqual({
      directionalPosition: [16, 11, 5],
      fogFar: 110,
      roofBaseColor: '#a65238',
      ambientIntensity: 1.1,
    });
  });

  it('conserve les réglages personnalisés', () => {
    const state = { directionalPosition: [1, 2, 3], fogFar: 80, roofBaseColor: '#445566' };
    expect(migrateControlState(state, 2)).toEqual(state);
  });
});
