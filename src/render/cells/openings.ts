/**
 * Ouvertures des cellules `WallWithWindow` : porte, fenêtres ou meurtrières
 * par face exposée. Les portes se décident par pièce, avant la construction
 * des murs (`planDoors`, appelé par buildVillage) ; `openingKindsOf` est
 * partagé par le builder de mur (wallWindowCellParts) et le planificateur de
 * cheminées (furnitureParts), qui doit savoir où sont portes et fenêtres.
 */

import { BlockType, type GridCell } from '../../types';
import { getFaceCorners, type CellFace } from '../../utils/cellUtils';
import type { RoomLamp } from '../../utils/roomLamps';
import { WALL_T, type OpeningKind } from '../geometryCache';
import type { CellContext } from './context';

type OpeningContext = Pick<CellContext, 'cell' | 'exposedFaces' | 'isIsolated' | 'isRampart' | 'doorFace'>;

/**
 * Cellules creuses regroupées par chandelier (voir assignRoomLamps) : une
 * zone = une pièce, ou un bout de grande salle. Clé : cellule du chandelier.
 */
export function lampZones(contexts: CellContext[], lamps: Map<GridCell, RoomLamp>): Map<string, CellContext[]> {
  const zones = new Map<string, CellContext[]>();
  for (const ctx of contexts) {
    const lamp = lamps.get(ctx.cell);
    if (!lamp || !ctx.hollow) continue;
    const key = `${ctx.cell.x + lamp.dx},${ctx.cell.y},${ctx.cell.z + lamp.dz}`;
    const zone = zones.get(key);
    if (zone) zone.push(ctx);
    else zones.set(key, [ctx]);
  }
  return zones;
}

const FACE_SALT: Record<CellFace, number> = { front: 1, back: 2, left: 3, right: 4 };
const FACE_OUT: Record<CellFace, [number, number]> = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };

/** Hauteur du seuil au-dessus du terrain devant la face (0 sur terrain plat) : autant de marches à monter. */
export function doorDrop(ctx: Pick<CellContext, 'groundAt'>, face: CellFace): number {
  if (!ctx.groundAt) return 0;
  const [ox, oz] = FACE_OUT[face];
  return Math.max(0, -0.5 - ctx.groundAt(ox * 0.6, oz * 0.6));
}
const hashOf = (x: number, z: number, salt: number) => Math.abs((x * 73856093) ^ (z * 19349663) ^ (salt * 83492791));

/**
 * Portes : une par zone de chandelier du rez-de-chaussée, pas une par
 * cellule — une rangée de cinq maisons accolées alignait cinq portes.
 * Elle s'ouvre sur une face exposée d'une cellule `WallWithWindow`, la plus
 * proche du chandelier (milieu de la façade), sur un pan de mur plat de
 * préférence (pas un coin arrondi qui rétrécit l'ouverture) ; à égalité, un
 * hash de la position choisit. Jamais au pied d'une courtine (un mur
 * défensif ne s'ouvre pas à chaque case). Ne dépend que de la forme.
 */
export function planDoors(contexts: CellContext[], lamps: Map<GridCell, RoomLamp>): Map<GridCell, CellFace> {
  const plan = new Map<GridCell, CellFace>();
  for (const [key, zone] of lampZones(contexts, lamps)) {
    const [hx, y, hz] = key.split(',').map(Number);
    if (y !== 0) continue;
    let best: { cell: GridCell; face: CellFace; rank: number } | null = null;
    for (const ctx of zone) {
      const { cell, exposedFaces, isRampart, radii } = ctx;
      if (cell.type !== BlockType.WallWithWindow || isRampart) continue;
      for (const face of exposedFaces) {
        const rounded = getFaceCorners(face, radii, 'numeric').some((r) => r > WALL_T + 0.02);
        const rank =
          (rounded ? 1000 : 0) +
          Math.hypot(cell.x - hx, cell.z - hz) * 10 +
          // Terrain en pente : de préférence côté amont, là où le seuil est au ras du sol.
          doorDrop(ctx, face) * 20 +
          (hashOf(cell.x, cell.z, FACE_SALT[face]) % 10) / 10;
        if (!best || rank < best.rank) best = { cell, face, rank };
      }
    }
    if (best) plan.set(best.cell, best.face);
  }
  return plan;
}

/**
 * Ouverture de chaque face exposée. `blindFace` (le mur qui porte une
 * cheminée) reste plein ; la porte n'est jamais supprimée.
 */
export function openingKindsOf(ctx: OpeningContext, blindFace: CellFace | null = null): Map<CellFace, OpeningKind> {
  const kinds = new Map<CellFace, OpeningKind>();
  if (ctx.cell.type !== BlockType.WallWithWindow) return kinds;
  const door = ctx.doorFace;
  // Tours et courtines sont défensives : meurtrières plutôt que fenêtres.
  const slits = ctx.isIsolated || ctx.isRampart;
  for (const face of ctx.exposedFaces) {
    if (face === blindFace && face !== door) continue;
    kinds.set(face, face === door ? 'door' : slits ? 'slit' : 'window');
  }
  return kinds;
}
