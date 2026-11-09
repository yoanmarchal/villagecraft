import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../../villageGrid';
import { buildVillage } from '../buildVillage';
import { pickRenderSettings } from '../renderSettings';
import { useControlStore } from '../../store/controlStore';
import { FACE_ROTATION_Y, getColumnTop, type CellFace } from '../../utils/cellUtils';
import { FLOOR_T, OPENING_SIZES, WALL_T, type OpeningSpec } from '../geometryCache';
import type { Part } from '../parts';
import type { CellContext } from './context';
import { interiorParts } from './interiorParts';
import { assignRoomLamps } from '../../utils/roomLamps';
import { FLUE_OFFSET, HOOD_REACH } from './furnitureParts';

// Intercepte chaque appel pendant une vraie construction : contexte,
// ouvertures exactes de la cellule et meubles produits (repère cellule).
const calls: Array<{ ctx: CellContext; openings: OpeningSpec[]; parts: Part[] }> = [];
vi.mock('./furnitureParts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./furnitureParts')>();
  return {
    ...original,
    furnitureParts: (ctx: CellContext, openings: OpeningSpec[]) => {
      const parts = original.furnitureParts(ctx, openings);
      // Copie des matrices : buildVillage les décale ensuite en place vers le monde.
      calls.push({ ctx, openings, parts: parts.map((p) => ({ ...p, matrix: p.matrix.clone() })) });
      return parts;
    },
  };
});

// Toits : contexte (conduits demandés) et parts produits.
const roofs: Array<{ ctx: CellContext; parts: Part[] }> = [];
vi.mock('./roofCellParts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./roofCellParts')>();
  return {
    ...original,
    roofCellParts: (ctx: CellContext) => {
      const parts = original.roofCellParts(ctx);
      roofs.push({ ctx, parts: parts.map((p) => ({ ...p, matrix: p.matrix.clone() })) });
      return parts;
    },
  };
});

const INNER = 0.5 - WALL_T;
const FLOOR_Y = -0.5 + FLOOR_T + 0.008;
const SILL_Y = OPENING_SIZES.window.y - OPENING_SIZES.window.h / 2;
const FACES: CellFace[] = ['front', 'back', 'left', 'right'];

/** Sommets d'un meuble dans le repère de la cellule. */
function verticesOf(parts: Part[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of parts) {
    const position = p.geo.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      out.push(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(p.matrix));
    }
  }
  return out;
}

/** Coordonnée d'un point vers la face (`+` = vers le mur de cette face). */
const towards = (v: THREE.Vector3, face: CellFace) => {
  const a = FACE_ROTATION_Y[face];
  return v.x * Math.sin(a) + v.z * Math.cos(a);
};

/** Coordonnée d'un point le long du mur de la face. */
const along = (v: THREE.Vector3, face: CellFace) => {
  const a = FACE_ROTATION_Y[face];
  return v.x * Math.cos(a) - v.z * Math.sin(a);
};

/** Demi-largeur du passage à garder libre devant une porte. */
const DOOR_CLEAR = OPENING_SIZES.door.w / 2 + 0.05;

function buildVillages() {
  calls.length = 0;
  roofs.length = 0;
  const settings = pickRenderSettings(useControlStore.getState());
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const grid = new VillageGrid(8, 10, 8);
    grid.generateTerrain(8, seed);
    buildVillage(grid.getOccupiedCells(), (x, y, z) => grid.toWorldPosition(x, y, z), settings, { width: 8, depth: 8 });
  }
  return calls.filter(({ parts }) => parts.length > 0);
}

describe('furnitureParts', () => {
  let furnished: ReturnType<typeof buildVillages>;
  beforeEach(() => {
    furnished = buildVillages();
  });

  it('furnishes the villages, with a modest vertex budget', () => {
    const hollowCells = calls.length;
    const vertexCount = furnished.reduce(
      (sum, { parts }) => sum + parts.reduce((s, p) => s + p.geo.getAttribute('position').count, 0),
      0,
    );
    expect(furnished.length).toBeGreaterThan(hollowCells / 3);
    expect(vertexCount / hollowCells).toBeLessThan(400);
  });

  it('stays on the floor, inside the cavity, clear of rounded corners', () => {
    for (const { ctx, parts } of furnished) {
      for (const v of verticesOf(parts)) {
        expect(v.y).toBeGreaterThan(FLOOR_Y - 0.001);
        expect(v.y).toBeLessThan(0.5 - FLOOR_T);
        expect(Math.max(Math.abs(v.x), Math.abs(v.z))).toBeLessThan(INNER);
        // Coin arrondi (tour) : rester dans le quart de cercle intérieur.
        const corner = `${v.z > 0 ? 'front' : 'back'}${v.x > 0 ? 'Right' : 'Left'}` as 'frontLeft';
        const ri = ctx.radii[corner] - WALL_T;
        const ax = Math.abs(v.x) - (INNER - ri);
        const az = Math.abs(v.z) - (INNER - ri);
        if (ri > 0 && ax > 0 && az > 0) expect(Math.hypot(ax, az)).toBeLessThan(ri + 0.001);
      }
    }
  });

  it('keeps door walls clear, only low pieces under windows, nothing against open sides', () => {
    let checkedDoors = 0;
    let checkedWindows = 0;
    for (const { ctx, openings, parts } of furnished) {
      const vertices = verticesOf(parts);
      for (const face of FACES) {
        const opening = openings.find((o) => o.face === face);
        const nearWall = vertices.filter((v) => towards(v, face) > INNER - 0.18);
        if (opening?.kind === 'door') {
          checkedDoors += 1;
          // Un meuble peut occuper le coin voisin, jamais le passage de la porte.
          expect(nearWall.filter((v) => Math.abs(along(v, face)) < DOOR_CLEAR)).toEqual([]);
        } else if (opening) {
          checkedWindows += 1;
          // Devant la fenêtre (sa largeur), rien ne monte au-dessus de l'appui ;
          // un buffet haut peut se tenir dans le coin voisin.
          const halfWidth = (OPENING_SIZES[opening.kind].w * opening.scale) / 2;
          for (const v of nearWall) if (Math.abs(along(v, face)) < halfWidth) expect(v.y).toBeLessThan(SILL_Y);
        }
        if (ctx.hollow!.sides[face] === 'open') {
          expect(vertices.filter((v) => towards(v, face) > 0.36)).toEqual([]);
        }
      }
    }
    expect(checkedDoors).toBeGreaterThan(0);
    expect(checkedWindows).toBeGreaterThan(0);
  });

  it('places shelves and workbenches somewhere', () => {
    const colors = new Set(furnished.flatMap(({ parts }) => parts.map((p) => p.color)));
    expect(colors.has('#a8643a')).toBe(true); // pots : établis, étagères
    expect(colors.has('#2a4a6b')).toBe(true); // livres
  });

  it('gives most ground-floor rooms a fireplace, on a wall with no opening', () => {
    const withFire = furnished.filter(({ parts }) => parts.some((p) => p.mat.glow));
    for (const { ctx, openings } of withFire) {
      expect(ctx.fireplaceFace).not.toBeNull();
      // Une fenêtre à cet endroit a été supprimée ; jamais une porte.
      expect(openings.some((o) => o.face === ctx.fireplaceFace)).toBe(false);
    }
    // Au plus une par chandelier (zone de pièce).
    const zones = withFire.map(({ ctx }) => {
      const near = calls.find(
        ({ ctx: other }) =>
          other.chandelier &&
          other.cell.y === ctx.cell.y &&
          Math.max(Math.abs(other.cell.x - ctx.cell.x), Math.abs(other.cell.z - ctx.cell.z)) <= 2,
      );
      return near ? `${near.ctx.cell.x},${near.ctx.cell.y},${near.ctx.cell.z}` : '?';
    });
    expect(zones).not.toContain('?');

    // Rez-de-chaussée : toutes les faces extérieures y ont une porte ou une
    // fenêtre — la première version, limitée aux murs aveugles, n'y en mettait jamais.
    const groundRooms = calls.filter(({ ctx }) => ctx.chandelier && ctx.cell.y === 0 && !ctx.isIsolated).length;
    const groundFires = withFire.filter(({ ctx }) => ctx.cell.y === 0).length;
    expect(groundFires / groundRooms).toBeGreaterThan(0.4);
  });

  it('stops a ceiling beam against the chimney hood', () => {
    const fires = furnished.filter(({ ctx }) => ctx.fireplaceFace);
    let stopped = 0;
    for (const { ctx, openings } of fires) {
      const face = ctx.fireplaceFace!;
      // interiorParts appelle furnitureParts (intercepté) : on ne garde que la poutre.
      const beam = interiorParts(ctx, openings).filter((p) => p.color === '#6b4a32');
      const reach = Math.max(...verticesOf(beam).map((v) => towards(v, face)));
      expect(reach).toBeLessThan(INNER - HOOD_REACH + 0.006);
      if (reach > INNER - HOOD_REACH - 0.01) stopped += 1;
    }
    // Des poutres aboutissent bien à des hottes (murs perpendiculaires acceptés).
    expect(stopped).toBeGreaterThan(0);
  });

  it('brings every fireplace flue out of its roof, and no flue without a fireplace', () => {
    const fires = calls.filter(({ ctx }) => ctx.fireplaceFace);
    const expected = new Set<string>();
    for (const { ctx } of fires) {
      const top = getColumnTop(ctx.lookup, ctx.cell);
      const a = FACE_ROTATION_Y[ctx.fireplaceFace!];
      const x = +(FLUE_OFFSET * Math.sin(a)).toFixed(4);
      const z = +(FLUE_OFFSET * Math.cos(a)).toFixed(4);
      const roof = roofs.find(({ ctx: r }) => r.cell === top);
      expect(roof).toBeDefined();
      expect(roof!.ctx.flues).toContainEqual({ x, z });
      expect(roof!.ctx.isIsolated || roof!.ctx.isRampart).toBe(false);
      expected.add(`${top.x},${top.y},${top.z}:${x},${z}`);
    }
    expect(expected.size).toBeGreaterThan(0);
    const flues = roofs.flatMap(({ ctx }) => ctx.flues);
    expect(flues.length).toBe(expected.size);
    // Une souche par conduit, dans le toit, et qui dépasse le faîtage.
    const stacks = roofs.flatMap(({ parts }) => parts.filter((p) => p.color === '#a09080'));
    expect(stacks.length).toBe(flues.length);
    for (const { ctx, parts } of roofs) {
      for (const stack of parts.filter((p) => p.color === '#a09080')) {
        const centre = new THREE.Vector3().applyMatrix4(stack.matrix);
        expect(ctx.flues.some((f) => Math.abs(f.x - centre.x) < 1e-6 && Math.abs(f.z - centre.z) < 1e-6)).toBe(true);
        const ys = verticesOf([stack]).map((v) => v.y);
        expect(Math.min(...ys)).toBeGreaterThan(-0.5);
        expect(Math.max(...ys)).toBeGreaterThan(ctx.settings.ridgeY);
      }
    }
  });

  it('opens one door per room on the ground floor, not one per cell', () => {
    // Rangée de cinq maisons accolées (deux niveaux) : une seule porte.
    calls.length = 0;
    const settings = pickRenderSettings(useControlStore.getState());
    const grid = new VillageGrid(8, 10, 8);
    for (let x = 1; x <= 5; x += 1) {
      grid.addBlock(x, 0, 3);
      grid.addBlock(x, 1, 3);
    }
    buildVillage(grid.getOccupiedCells(), (x, y, z) => grid.toWorldPosition(x, y, z), settings, { width: 8, depth: 8 });
    const ground = calls.filter(({ ctx }) => ctx.cell.y === 0);
    expect(ground).toHaveLength(5);
    expect(ground.flatMap(({ openings }) => openings.filter((o) => o.kind === 'door'))).toHaveLength(1);

    // Villages générés : au plus une porte par zone de chandelier.
    const doorsByZone = new Map<string, number>();
    const villages = new Map<unknown, ReturnType<typeof assignRoomLamps>>();
    buildVillages();
    for (const { ctx, openings } of calls) {
      const doors = openings.filter((o) => o.kind === 'door').length;
      if (!doors) continue;
      expect(ctx.doorFace).not.toBeNull();
      // Zones de chandelier recalculées sur les cellules creuses du même village.
      if (!villages.has(ctx.lookup)) {
        const cells = calls.filter(({ ctx: other }) => other.lookup === ctx.lookup).map(({ ctx: other }) => other.cell);
        villages.set(ctx.lookup, assignRoomLamps(cells, ctx.lookup));
      }
      const lamp = villages.get(ctx.lookup)!.get(ctx.cell)!;
      const key = `${[...villages.keys()].indexOf(ctx.lookup)}:${ctx.cell.x + lamp.dx},${ctx.cell.z + lamp.dz}`;
      doorsByZone.set(key, (doorsByZone.get(key) ?? 0) + doors);
    }
    expect(doorsByZone.size).toBeGreaterThan(10);
    expect(Math.max(...doorsByZone.values())).toBe(1);
  });

  it('is deterministic', () => {
    const signature = (list: typeof calls) =>
      list.map(({ ctx, parts }) => `${ctx.cell.x},${ctx.cell.y},${ctx.cell.z}:${verticesOf(parts).length}`).join('|');
    const first = signature(furnished);
    expect(signature(buildVillages())).toBe(first);
  });
});
