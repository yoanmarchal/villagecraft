import { afterEach, describe, expect, it, vi } from 'vitest';

/** Recharge les modules qui dérivent leurs cotes de l'échelle, pour une case de `cellMeters`. */
async function at(cellMeters: number) {
  vi.resetModules();
  vi.doMock('./scale', async (importOriginal) => {
    const original = await importOriginal<typeof import('./scale')>();
    return {
      ...original,
      CELL_METERS: cellMeters,
      HUMAN_SCALE: original.DESIGN_CELL_METERS / cellMeters,
      meters: (length: number) => length / cellMeters,
    };
  });
  const [geometry, stairs, walk, doors] = await Promise.all([
    import('../render/geometryCache'),
    import('../render/cells/stairPlan'),
    import('../walk/walkConfig'),
    import('../render/cells/doors'),
  ]);
  return { geometry, stairs, walk, doors, toMeters: (units: number) => units * cellMeters };
}

afterEach(() => {
  vi.doUnmock('./scale');
  vi.resetModules();
});

describe('village scale', () => {
  for (const cellMeters of [2.8, 3.36, 4]) {
    it(`keeps people-sized things people-sized with ${cellMeters} m cells`, async () => {
      const { geometry, stairs, walk, doors, toMeters } = await at(cellMeters);
      const door = geometry.OPENING_SIZES.door;
      expect(toMeters(door.h)).toBeCloseTo(1.99, 6);
      expect(toMeters(door.w)).toBeCloseTo(1.12, 6);
      // Le pied de la porte reste au ras du plancher, son linteau sous le plafond.
      expect(door.y - door.h / 2).toBeCloseTo(-0.45, 9);
      expect(door.y + door.h / 2).toBeLessThan(0.5 - geometry.FLOOR_T);
      expect(toMeters(walk.WALKER_HEIGHT)).toBeCloseTo(1.75, 6);
      expect(walk.WALKER_HEIGHT).toBeLessThan(door.h);
      expect(toMeters(stairs.RAIL_H)).toBeCloseTo(0.84, 6);
      expect(toMeters(stairs.ARRIVAL_PASSAGE)).toBeCloseTo(0.6, 6);

      // Escaliers : des contremarches de ~17,5 cm, des girons de 20 à 25 cm, qui tiennent entre les murs.
      const rise = toMeters(stairs.STAIR_RISE);
      expect(rise).toBeGreaterThan(0.15);
      expect(rise).toBeLessThan(0.19);
      const { flightTreads, winders, tread } = stairs.L_STAIR;
      expect(2 * flightTreads + winders + 1).toBe(stairs.STAIR_RISERS);
      expect(stairs.SPIRAL.steps * stairs.SPIRAL.stepAngle).toBeCloseTo(stairs.SPIRAL.arc, 9);
      expect(toMeters(tread)).toBeGreaterThan(0.18);
      expect(toMeters(tread)).toBeLessThan(0.25);
      expect(stairs.L_LAYOUT.start).toBeGreaterThan(-stairs.STAIR_INNER);
      // Une marche de l'escalier, et même deux, se montent sans sauter.
      expect(2 * stairs.STAIR_RISE).toBeLessThan(walk.STEP_HEIGHT);
      // Le passage laissé en haut de l'escalier laisse passer les épaules.
      expect(stairs.ARRIVAL_PASSAGE).toBeGreaterThan(2 * walk.WALKER_RADIUS);
      expect(toMeters(doors.DOOR_FRAME_W - door.w)).toBeLessThan(0.4);
    });
  }

  it('changes nothing at the reference scale the furniture was drawn for', async () => {
    const { stairs } = await at(2.8);
    expect(stairs.STAIR_RISERS).toBe(16);
    expect(stairs.L_STAIR.tread).toBe(0.072);
    expect(stairs.SPIRAL.steps).toBe(15);
  });
});
