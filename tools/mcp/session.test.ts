import { describe, expect, it } from 'vitest';
import { decodeVillage } from '../../src/store/villageCode';
import { VillageSession } from './session';

const APP = 'https://example.test/villagecraft/';

describe('VillageSession', () => {
  it('builds like clicks: a lone block gets a roof cap, building on it raises the column', () => {
    const session = new VillageSession(APP, 6);
    expect(session.build(2, 2)).toEqual([0]);
    expect(session.height(2, 2)).toBe(1);
    // Le toit automatique posé sur le premier bloc devient un mur : le clic suivant monte au-dessus.
    expect(session.build(2, 2, 2)).toEqual([2, 3]);
    expect(session.height(2, 2)).toBe(4);
    expect(session.demolish(2, 2)).toEqual([3]);
    expect(session.height(2, 2)).toBe(3);
  });

  it('builds rectangular buildings to a number of storeys plus the roof', () => {
    const session = new VillageSession(APP, 8);
    expect(session.buildRect(1, 1, 3, 2, 2)).toBe(3 * 2 * 3);
    const village = session.describe();
    expect(village.buildings).toHaveLength(1);
    expect(village.buildings[0]).toMatchObject({ columns: 6, minX: 1, maxX: 3, minZ: 1, maxZ: 2, maxStoreys: 2 });
    expect(() => session.buildRect(6, 6, 3, 1, 1)).toThrow(/outside/);
  });

  it('round-trips through a share link, and rejects columns outside the grid', () => {
    const session = new VillageSession(APP, 10);
    session.reset(10, 3);
    const link = session.shareLink();
    expect(link.startsWith(`${APP}#v=`)).toBe(true);
    expect(decodeVillage(link.split('#v=')[1])).toEqual(session.village());

    const other = new VillageSession(APP);
    other.load(link);
    expect(other.village()).toEqual(session.village());
    expect(() => other.build(10, 0)).toThrow(/outside the 10×10 grid/);
    expect(() => other.load('not-a-village')).toThrow(/invalid/);
  });
});
