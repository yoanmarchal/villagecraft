/**
 * Collecteur + merge statique.
 *
 * 1. Pour chaque cellule occupée : calcule le CellContext (faces exposées,
 *    radii, isolement) UNE fois, dispatch vers le builder du BlockType,
 *    et pré-multiplie la position monde sur chaque part.
 * 2. Groupe tous les parts par spec de matériau (roughness/metalness/
 *    transparence quantifiés) — et, pour `VillageChunkCache`, par chunk de
 *    colonnes.
 * 3. Fusionne chaque groupe en un seul BufferGeometry non-indexé
 *    (position + normal + couleur par vertex).
 *
 * → une dizaine de draw calls par chunk, reconstruits uniquement quand la
 *   grille change, et seulement pour les chunks touchés.
 */

import * as THREE from 'three';
import { BlockType, type GridCell } from '../types';
import {
  getCornerRadii,
  getExposedFaces,
  FACE_ROTATION_Y,
  getColumnTop,
  getHollowShape,
  isHollowType,
  isIsolatedBlock,
  isRampart,
  isTowerColumn,
  getCell,
  makeCellLookup,
  type CellLookup,
} from '../utils/cellUtils';
import { assignRoomLamps, type RoomLamp } from '../utils/roomLamps';
import {
  matKey,
  type DoorHinge,
  type Obstacle,
  type MaterialSpec,
  type Part,
  type PositionedPart,
  type Vec3,
} from './parts';
import { ROOF_DROP_HEIGHT } from './growMaterial';
import type { CellContext } from './cells/context';
import { standardCellParts } from './cells/standardCellParts';
import { wallWindowCellParts } from './cells/wallWindowCellParts';
import { roofCellParts } from './cells/roofCellParts';
import { archCellParts } from './cells/archCellParts';
import { pavingParts } from './cells/pavingParts';
import { propsParts } from './cells/propsParts';
import { FLUE_OFFSET, planFireplaces } from './cells/furnitureParts';
import { planDoors } from './cells/openings';
import { planStairs } from './cells/stairPlan';
import { plinthParts } from './cells/plinthParts';
import { createGround, type Ground } from './ground';
import { isFlatRelief, reliefFor, type Relief } from './relief';
import type { RenderSettings } from './renderSettings';
import { cellColliders } from '../walk/cellColliders';

export interface MergedGroup {
  key: string;
  mat: MaterialSpec;
  geometry: THREE.BufferGeometry;
  /** Pièces mobiles d'une porte (un groupe par porte et matériau) : charnière en monde, voir doors.ts. */
  door?: DoorHinge;
}

/** Emprise au sol de la grille, pour paver les ruelles autour des bâtiments. */
export interface GroundExtent {
  width: number;
  depth: number;
  /**
   * Relief du terrain (relief.ts), ou seulement l'amplitude de ses ondulations
   * d'origine ; absent, 0 ou relief plat : terrain plat.
   */
  relief?: number | Relief;
}

type ToWorld = (x: number, y: number, z: number) => [number, number, number];

/** Part positionné dans le monde, avec la colonne de grille qui l'a émis (pour le découpage en chunks). */
interface CollectedPart extends PositionedPart {
  x: number;
  z: number;
  key: string;
  /** Porte dont le part est une pièce mobile (identifiant de sa cellule) : groupe à part. */
  doorId?: string;
}

/** Pièces d'un bâtiment et ses volumes de collision (monde, 6 nombres par boîte : min puis max). */
interface BuildingOutput {
  parts: CollectedPart[];
  colliders: number[];
}

/** Ce que rassemble le collecteur : les pièces du village, et les volumes de collision du promeneur. */
interface Collected {
  parts: CollectedPart[];
  colliders: number[];
}

/** Groupe de fusion d'un part : son matériau, et sa porte si c'est une pièce mobile. */
const groupKey = (p: CollectedPart) => (p.doorId ? `door:${p.doorId}|${p.key}` : p.key);

export function buildVillage(
  cells: GridCell[],
  toWorldPosition: ToWorld,
  settings: RenderSettings,
  ground?: GroundExtent,
): MergedGroup[] {
  const groups = new Map<string, { mat: MaterialSpec; parts: PositionedPart[]; door?: DoorHinge }>();
  for (const p of collectVillageParts(cells, toWorldPosition, settings, ground).parts) {
    const key = groupKey(p);
    let group = groups.get(key);
    if (!group) {
      group = { mat: p.mat, parts: [], door: p.door };
      groups.set(key, group);
    }
    group.parts.push(p);
  }

  const merged: MergedGroup[] = [];
  for (const [key, { mat, parts, door }] of groups) {
    merged.push({ key, mat, geometry: mergeParts(parts), ...(door ? { door } : {}) });
  }
  return merged;
}

/** Côté (en colonnes) d'un chunk de `VillageChunkCache`. */
export const CHUNK_SIZE = 4;

/**
 * Reconstruction incrémentale : même résultat que `buildVillage`, mais
 * découpé en chunks de CHUNK_SIZE × CHUNK_SIZE colonnes × groupe de matériau,
 * et chaque chunk n'est refusionné que si ses parts ont changé.
 *
 * Les builders tournent toujours pour toute la grille (~20 % du coût) : la
 * forme d'une cellule dépend de cases parfois lointaines (faîtage d'un bloc
 * entier, courtines, portée des arches), donc deviner ce qu'un clic touche
 * serait fragile. On compare plutôt leur *sortie* : une empreinte de chaque
 * chunk (géométrie, matrice, couleur, horodatage d'apparition de chaque part).
 * Identique → on réutilise la géométrie fusionnée, et le GPU n'a rien à
 * recharger. Un clic ne refusionne ainsi qu'un ou deux chunks.
 */
export class VillageChunkCache {
  private chunks = new Map<string, { hash: string; group: MergedGroup }>();
  private buildings: BuildingCache = { environment: '', buildings: new Map(), paving: new Map() };
  /** Volumes de collision du promeneur au dernier `build` (monde, 6 nombres par boîte, voir cellColliders). */
  colliders = new Float32Array(0);

  build(cells: GridCell[], toWorldPosition: ToWorld, settings: RenderSettings, ground?: GroundExtent): MergedGroup[] {
    // Réglages, relief ou repère monde changés : tous les bâtiments sont à refaire.
    const environment = environmentKey(toWorldPosition, settings, ground);
    if (environment !== this.buildings.environment)
      this.buildings = { environment, buildings: new Map(), paving: new Map() };

    const buckets = new Map<string, CollectedPart[]>();
    const collected = collectVillageParts(cells, toWorldPosition, settings, ground, this.buildings);
    this.colliders = new Float32Array(collected.colliders);
    for (const p of collected.parts) {
      // Les pièces mobiles d'une porte forment leur propre groupe (la page les fait pivoter).
      const id = p.doorId ? groupKey(p) : `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.z / CHUNK_SIZE)}|${p.key}`;
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = [];
        buckets.set(id, bucket);
      }
      bucket.push(p);
    }

    const next = new Map<string, { hash: string; group: MergedGroup }>();
    for (const [id, parts] of buckets) {
      const hash = hashParts(parts);
      const previous = this.chunks.get(id);
      const group =
        previous && previous.hash === hash
          ? previous.group
          : {
              key: id,
              mat: parts[0].mat,
              geometry: mergeParts(parts),
              ...(parts[0].door ? { door: parts[0].door } : {}),
            };
      next.set(id, { hash, group });
    }
    this.chunks = next;
    return [...next.values()].map(({ group }) => group);
  }
}

/** Empreinte (2 × 32 bits, FNV-1a et variante) de tout ce que `mergeParts` lit dans les parts. */
function hashParts(parts: CollectedPart[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const f64 = new Float64Array(1);
  const words = new Uint32Array(f64.buffer);
  const mix = (word: number) => {
    h1 = Math.imul(h1 ^ word, 0x01000193);
    h2 = Math.imul(h2 ^ word, 0x5bd1e995) ^ (h2 >>> 15);
  };
  const num = (value: number) => {
    f64[0] = value;
    mix(words[0]);
    mix(words[1]);
  };

  for (const p of parts) {
    num(p.geo.id);
    for (const e of p.matrix.elements) num(e);
    for (let i = 0; i < p.color.length; i += 1) mix(p.color.charCodeAt(i));
    num(p.cellCenter.x);
    num(p.cellCenter.y);
    num(p.cellCenter.z);
    num(p.spawn);
    num(p.fallHeight);
    num(p.interiorMode);
    num(p.lampDx);
    num(p.lampDz);
    mix(p.rigidNormals ? 1 : 0);
    if (p.door) for (const v of [...p.door.hinge, ...p.door.center, p.door.sign]) num(v);
  }
  return `${parts.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/**
 * Pièces déjà construites, par bâtiment (signature → pièces placées dans le
 * monde). Valables tant que l'environnement (réglages, relief, repère monde)
 * ne change pas.
 */
interface BuildingCache {
  environment: string;
  buildings: Map<string, BuildingOutput>;
  /** Pavés par case (position et signature de ses voisines, voir pavingParts). */
  paving: Map<string, CollectedPart[]>;
}

/** Un bâtiment : colonnes bâties 4-connexes (arches comprises), et ses cellules. */
interface Building {
  columns: Array<[number, number]>;
  cells: GridCell[];
}

/**
 * Bâtiments du village. Tout ce qu'un builder lit d'une cellule (voisins,
 * faîtages, courtines, appuis d'arche, pièces, escaliers, cheminées) reste
 * dans son bâtiment, ou dans l'anneau de colonnes qui l'entoure (coins en
 * diagonale) — d'où le cache par bâtiment de VillageChunkCache.
 */
function villageBuildings(cells: GridCell[]): Building[] {
  const columns = new Map<string, GridCell[]>();
  for (const cell of cells) {
    const key = `${cell.x},${cell.z}`;
    const list = columns.get(key);
    if (list) list.push(cell);
    else columns.set(key, [cell]);
  }
  const seen = new Set<string>();
  const buildings: Building[] = [];
  for (const start of columns.keys()) {
    if (seen.has(start)) continue;
    const building: Building = { columns: [], cells: [] };
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const key = queue.pop()!;
      const [x, z] = key.split(',').map(Number);
      building.columns.push([x, z]);
      building.cells.push(...columns.get(key)!);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = `${x + dx},${z + dz}`;
        if (columns.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    // Ordre stable : la sortie ne dépend pas de l'ordre de parcours.
    building.cells.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
    buildings.push(building);
  }
  return buildings;
}

/**
 * Empreinte de tout ce dont dépendent les pièces d'un bâtiment : ses cellules
 * (type, cap ou arche automatique, horodatage d'apparition), le niveau de
 * chaque colonne sur le terrain, et les cellules de l'anneau de colonnes qui
 * l'entoure, diagonales comprises (rayons de coin, chaînages, parement).
 */
function buildingSignature(building: Building, lookup: CellLookup, terrain: Ground | null): string {
  const inside = new Set(building.columns.map(([x, z]) => `${x},${z}`));
  const parts: string[] = [];
  for (const cell of building.cells) {
    parts.push(
      `${cell.x},${cell.y},${cell.z},${cell.type},${cell.isAutoRoof ? 1 : 0}${cell.isAutoArch ? 1 : 0},${cell.spawnedAt ?? 0}`,
    );
  }
  if (terrain) for (const [x, z] of building.columns) parts.push(`b${x},${z}:${terrain.baseAt(x, z)}`);
  const ring = new Set<string>();
  for (const [x, z] of building.columns) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const key = `${x + dx},${z + dz}`;
        if (!inside.has(key)) ring.add(key);
      }
    }
  }
  for (const key of [...ring].sort()) {
    const [x, z] = key.split(',').map(Number);
    for (let y = 0; ; y += 1) {
      const cell = getCell(lookup, x, y, z);
      if (!cell) break;
      if (cell.isOccupied) parts.push(`r${x},${y},${z},${cell.type}`);
    }
  }
  return parts.join(';');
}

const reliefIds = new WeakMap<object, number>();
let nextReliefId = 1;

/** Ce qui, s'il change, invalide tous les bâtiments en cache : réglages, relief, emprise, repère monde. */
function environmentKey(toWorldPosition: ToWorld, settings: RenderSettings, ground?: GroundExtent): string {
  let relief: string = 'flat';
  if (typeof ground?.relief === 'number') relief = `a${ground.relief}`;
  else if (ground?.relief) {
    let id = reliefIds.get(ground.relief);
    if (id === undefined) {
      id = nextReliefId++;
      reliefIds.set(ground.relief, id);
    }
    relief = `r${id}`;
  }
  return [
    JSON.stringify(settings),
    relief,
    ground ? `${ground.width}x${ground.depth}` : 'none',
    toWorldPosition(0, 0, 0).join(','),
    toWorldPosition(1, 1, 1).join(','),
  ].join('|');
}

/**
 * Étape 1 : CellContext + builder de chaque cellule (et pavés du sol),
 * parts placés dans le monde.
 */
function collectVillageParts(
  cells: GridCell[],
  toWorldPosition: ToWorld,
  settings: RenderSettings,
  ground?: GroundExtent,
  cache?: BuildingCache,
): Collected {
  const lookup = makeCellLookup(cells);
  const collected: CollectedPart[] = [];
  const colliders: number[] = [];
  // Un chandelier par pièce (ou par zone d'une grande salle), pas par cellule.
  const roomLamps = assignRoomLamps(cells, lookup);
  // Terrain en pente : niveau de chaque bâtiment et hauteur du sol (ground.ts).
  const relief =
    typeof ground?.relief === 'number'
      ? reliefFor(Math.max(ground.width, ground.depth), ground.relief)
      : ground?.relief;
  const terrain = relief && !isFlatRelief(relief) ? createGround(cells, toWorldPosition, relief) : null;
  /** Hauteur du terrain (y monde) autour de la case (x, z), en coordonnées locales à la case. */
  const groundOf = terrain
    ? (x: number, z: number) => {
        const [wx, , wz] = toWorldPosition(x, 0, z);
        return (lx: number, lz: number) => terrain.heightAt(wx + lx, wz + lz);
      }
    : undefined;
  /** Position monde du centre d'une cellule, relevée au niveau de son bâtiment. */
  const cellWorld = (cell: GridCell): [number, number, number] => {
    const [wx, wy, wz] = toWorldPosition(cell.x, cell.y, cell.z);
    return [wx, wy + (terrain ? terrain.baseAt(cell.x, cell.z) : 0), wz];
  };

  const translation = new THREE.Matrix4();

  const addParts = (
    into: CollectedPart[],
    parts: Part[],
    x: number,
    z: number,
    cellCenter: THREE.Vector3,
    spawn: number,
    fallHeight: number,
    lamp: RoomLamp | undefined,
    solids?: number[],
  ) => {
    // Obstacles du promeneur (meubles, puits…) : boîte englobante de leurs parts, en monde.
    const obstacles = new Map<Obstacle, number[]>();
    // Charnières de porte en monde : une par porte (ses pièces mobiles partagent la même).
    const doors = new Map<DoorHinge, DoorHinge>();
    const toWorld = ([a, b, c]: Vec3): Vec3 => [a + cellCenter.x, b + cellCenter.y, c + cellCenter.z];
    for (const p of parts) {
      p.matrix.premultiply(translation);
      const interiorMode = !lamp || !p.interior ? 0 : p.interior === 'shell' ? 1 : 2;
      const lampDx = lamp?.dx ?? 0;
      const lampDz = lamp?.dz ?? 0;
      let door: DoorHinge | undefined;
      if (p.door) {
        door = doors.get(p.door) ?? { hinge: toWorld(p.door.hinge), center: toWorld(p.door.center), sign: p.door.sign };
        doors.set(p.door, door);
      }
      const doorId = door ? `${x},${Math.round(cellCenter.y * 100)},${z}` : undefined;
      if (p.obstacle && solids) {
        const box = worldBounds(p);
        const union = obstacles.get(p.obstacle);
        if (!union) obstacles.set(p.obstacle, box);
        else
          for (let i = 0; i < 3; i += 1)
            [union[i], union[i + 3]] = [Math.min(union[i], box[i]), Math.max(union[i + 3], box[i + 3])];
      }
      into.push({
        ...p,
        // Champs toujours présents (même indéfinis) : une seule forme d'objet pour
        // toute la fusion — des parts aux formes variées la ralentissaient de ~7 %.
        obstacle: p.obstacle,
        door,
        doorId,
        x,
        z,
        key: matKey(p.mat),
        cellCenter,
        spawn,
        fallHeight,
        interiorMode,
        lampDx,
        lampDz,
      });
    }
    for (const box of obstacles.values()) solids?.push(...box);
  };

  /** Pièces d'un bâtiment : contextes, plans (portes, escaliers, cheminées, conduits), puis builders. */
  const buildingParts = (buildingCells: GridCell[]): BuildingOutput => {
    const out: CollectedPart[] = [];
    const solids: number[] = [];
    // Contextes d'abord : les cheminées se décident par pièce, avant les murs
    // (elles peuvent prendre la place d'une fenêtre).
    const contexts = buildingCells.map((cell): CellContext => {
      const lamp = roomLamps.get(cell);
      let groundAt: CellContext['groundAt'] = null;
      if (terrain) {
        const [wx, wy, wz] = cellWorld(cell);
        groundAt = (lx, lz) => terrain.heightAt(wx + lx, wz + lz) - wy;
      }
      return {
        cell,
        lookup,
        groundAt,
        settings,
        exposedFaces: getExposedFaces(lookup, cell),
        radii: getCornerRadii(lookup, cell, settings),
        // Murs/fondations : propagation tour vers le bas. Toits : check local
        // non propagé. Asymétrie intentionnelle (voir AGENTS.md).
        isIsolated: cell.type === BlockType.Roof ? isIsolatedBlock(lookup, cell) : isTowerColumn(lookup, cell),
        isRampart: isRampart(lookup, getColumnTop(lookup, cell)),
        hollow: isHollowType(cell.type) ? getHollowShape(lookup, cell) : null,
        chandelier: lamp !== undefined && lamp.dx === 0 && lamp.dz === 0,
        doorFace: null,
        fireplaceFace: null,
        flues: [],
        stair: null,
        stairBelow: null,
      };
    });
    const doors = planDoors(contexts, roomLamps);
    for (const ctx of contexts) ctx.doorFace = doors.get(ctx.cell) ?? null;
    // Escaliers avant les cheminées : ils passent en premier, la cheminée s'écarte.
    const stairs = planStairs(contexts);
    for (const ctx of contexts) {
      ctx.stair = stairs.up.get(ctx.cell) ?? null;
      ctx.stairBelow = stairs.below.get(ctx.cell) ?? null;
    }
    const fireplaces = planFireplaces(contexts, roomLamps);
    // Conduit de chaque cheminée : il sort du toit de sa colonne, à l'aplomb
    // de la hotte (planFireplaces exige un toit à deux pans au sommet).
    const contextOf = new Map(contexts.map((ctx) => [ctx.cell, ctx]));
    for (const ctx of contexts) {
      const face = (ctx.fireplaceFace = fireplaces.get(ctx.cell) ?? null);
      if (!face) continue;
      const roof = contextOf.get(getColumnTop(lookup, ctx.cell));
      const angle = FACE_ROTATION_Y[face];
      const flue = { x: +(FLUE_OFFSET * Math.sin(angle)).toFixed(4), z: +(FLUE_OFFSET * Math.cos(angle)).toFixed(4) };
      // Deux cheminées superposées sur le même mur partagent leur conduit.
      if (roof && !roof.flues.some((f) => f.x === flue.x && f.z === flue.z)) roof.flues.push(flue);
    }

    for (const ctx of contexts) {
      const { cell } = ctx;
      const lamp = roomLamps.get(cell);

      let cellParts: Part[];
      switch (cell.type) {
        case BlockType.Roof:
          cellParts = roofCellParts(ctx);
          break;
        case BlockType.Arch:
          cellParts = archCellParts(ctx);
          break;
        case BlockType.WallWithWindow:
          cellParts = wallWindowCellParts(ctx);
          break;
        default: // Wall, Foundation
          cellParts = standardCellParts(ctx);
          break;
      }

      // Soubassement : du pied du bâtiment jusqu'au terrain, côté aval.
      if (cell.y === 0 && isHollowType(cell.type)) cellParts.push(...plinthParts(ctx));

      const [wx, wy, wz] = cellWorld(cell);
      translation.makeTranslation(wx, wy, wz);
      const cellCenter = new THREE.Vector3(wx, wy, wz);
      const spawn = cell.spawnedAt ?? 0;
      const fallHeight = cell.type === BlockType.Roof ? ROOF_DROP_HEIGHT : 0;

      addParts(out, cellParts, cell.x, cell.z, cellCenter, spawn, fallHeight, lamp, solids);
      // Volumes de collision du promeneur, au même endroit (walk/cellColliders.ts).
      for (const [x0, y0, z0, x1, y1, z1] of cellColliders(ctx)) {
        solids.push(x0 + wx, y0 + wy, z0 + wz, x1 + wx, y1 + wy, z1 + wz);
      }
    }
    return { parts: out, colliders: solids };
  };

  // Bâtiment par bâtiment : un bâtiment inchangé (lui et l'anneau de cases qui
  // l'entoure) reprend ses pièces du cache, sans relancer contextes ni builders.
  const fresh = new Map<string, BuildingOutput>();
  for (const building of villageBuildings(cells)) {
    const signature = cache ? buildingSignature(building, lookup, terrain) : '';
    let output = cache?.buildings.get(signature);
    if (!output) output = buildingParts(building.cells);
    if (cache) fresh.set(signature, output);
    collected.push(...output.parts);
    for (const value of output.colliders) colliders.push(value);
  }
  if (cache) cache.buildings = fresh;

  if (ground) {
    // Pavés d'une case : repris du cache tant que ses voisines ne changent pas.
    const pavingKey = (x: number, z: number, signature: string) => `${x},${z}|${signature}`;
    const freshPaving = new Map<string, CollectedPart[]>();
    const reuse = cache
      ? (x: number, z: number, signature: string) => cache.paving.has(pavingKey(x, z, signature))
      : undefined;
    for (const { x, z, signature, parts } of pavingParts(lookup, ground, groundOf, reuse)) {
      const key = pavingKey(x, z, signature);
      let placed = cache?.paving.get(key);
      if (!placed) {
        placed = [];
        const [wx, , wz] = toWorldPosition(x, 0, z);
        translation.makeTranslation(wx, 0, wz);
        // spawn = 0 : les pavés sont déjà "posés", sans animation d'apparition.
        addParts(placed, parts, x, z, new THREE.Vector3(wx, 0, wz), 0, 0, undefined);
      }
      freshPaving.set(key, placed);
      collected.push(...placed);
    }
    if (cache) cache.paving = freshPaving;
    // Décor de l'herbe libre près du village (puits, charrettes, foin…).
    for (const { x, z, parts } of propsParts(lookup, ground, settings, groundOf)) {
      const [wx, , wz] = toWorldPosition(x, 0, z);
      translation.makeTranslation(wx, 0, wz);
      addParts(collected, parts, x, z, new THREE.Vector3(wx, 0, wz), 0, 0, undefined, colliders);
    }
  }

  return { parts: collected, colliders };
}

/** Boîte englobante de chaque géométrie du cache (calculée à part : on ne touche pas aux géométries partagées). */
const geometryBounds = new WeakMap<THREE.BufferGeometry, number[]>();

/** Boîte englobante (min puis max) d'un part, en monde : les 8 coins de celle de sa géométrie, transformés. */
function worldBounds(p: Part): number[] {
  let local = geometryBounds.get(p.geo);
  if (!local) {
    const position = p.geo.getAttribute('position');
    local = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.count; i += 1) {
      const v = [position.getX(i), position.getY(i), position.getZ(i)];
      for (let a = 0; a < 3; a += 1)
        [local[a], local[a + 3]] = [Math.min(local[a], v[a]), Math.max(local[a + 3], v[a])];
    }
    geometryBounds.set(p.geo, local);
  }
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const corner = new THREE.Vector3();
  for (let k = 0; k < 8; k += 1) {
    corner.set(local[k & 1 ? 3 : 0], local[k & 2 ? 4 : 1], local[k & 4 ? 5 : 2]).applyMatrix4(p.matrix);
    const v = [corner.x, corner.y, corner.z];
    for (let a = 0; a < 3; a += 1) [out[a], out[a + 3]] = [Math.min(out[a], v[a]), Math.max(out[a + 3], v[a])];
  }
  return out;
}

/** Un part avec une matrice non-finie (NaN/Infinity) corromprait tout le groupe fusionné. */
function isFinitePart(p: Part): boolean {
  const e = p.matrix.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(e[i])) return false;
  }
  return true;
}

/**
 * Fusionne des parts en un BufferGeometry unique, en écrivant directement
 * dans des tableaux typés (pas de clone de géométrie intermédiaire). Les
 * géométries sources (cache) sont indexées avec position + normal : leur
 * index est recopié, décalé.
 *
 * Format compact — 33 octets par sommet au lieu de 56 :
 *  - position : Float32 × 3 ;
 *  - normal   : Int8 normalisé × 3 (précision 1/127, invisible à l'éclairage) ;
 *  - color    : Uint8 normalisé × 3 (couleurs plates par part) ;
 *  - aCell    : Int16 × 4 = (pivot de la cellule : x et z × 2, y × 100 ; w) avec
 *    w = code × 4 + mode d'éclairage intérieur (0, 1 coque, 2 aménagement) ;
 *    code = hauteur de chute × 100 (mode 0) ou décalage vers le chandelier
 *    de la pièce, (dx + 16) × 32 + (dz + 16) (mode > 0 : une pièce ne tombe pas).
 *    En plan les pivots sont sur des demi-unités (toWorldPosition) ; en
 *    hauteur, au centième (niveau du bâtiment sur un terrain en pente, voir
 *    ground.ts) : exacts ; lu en flottants par le shader (growMaterial.ts) ;
 *  - aSpawn   : Float32 (horodatage en secondes, a besoin de la précision).
 */
function mergeParts(allParts: PositionedPart[]): THREE.BufferGeometry {
  const parts = allParts.filter(isFinitePart);
  if (parts.length !== allParts.length) {
    console.warn(`buildVillage: ${allParts.length - parts.length} part(s) ignoré(s) (matrice non-finie)`);
  }

  let total = 0;
  let indexTotal = 0;
  for (const p of parts) {
    const count = p.geo.attributes.position.count;
    total += count;
    indexTotal += p.geo.index?.count ?? count;
  }

  // Index 16 bits tant qu'il suffit (chunks modestes), 32 sinon.
  const indices = total <= 0xffff ? new Uint16Array(indexTotal) : new Uint32Array(indexTotal);
  const positions = new Float32Array(total * 3);
  const normals = new Int8Array(total * 3);
  const colors = new Uint8Array(total * 3);
  const cellData = new Int16Array(total * 4);
  const spawns = new Float32Array(total);

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const color = new THREE.Color();
  const normalMatrix = new THREE.Matrix3();

  let offset = 0;
  let indexOffset = 0;
  for (const p of parts) {
    const posAttr = p.geo.attributes.position;
    const norAttr = p.geo.attributes.normal;
    const count = posAttr.count;

    const index = p.geo.index;
    if (index) {
      for (let i = 0; i < index.count; i++) indices[indexOffset + i] = offset + index.getX(i);
      indexOffset += index.count;
    } else {
      for (let i = 0; i < count; i++) indices[indexOffset + i] = offset + i;
      indexOffset += count;
    }

    if (p.rigidNormals) {
      // Rotation seule : les colonnes de la matrice, ramenées à l'unité.
      normalMatrix.setFromMatrix4(p.matrix);
      const e = normalMatrix.elements;
      for (let column = 0; column < 3; column += 1) {
        const length = Math.hypot(e[column * 3], e[column * 3 + 1], e[column * 3 + 2]) || 1;
        for (let row = 0; row < 3; row += 1) e[column * 3 + row] /= length;
      }
    } else {
      normalMatrix.getNormalMatrix(p.matrix);
    }
    color.set(p.color);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const cx = Math.round(p.cellCenter.x * 2);
    const cy = Math.round(p.cellCenter.y * 100);
    const cz = Math.round(p.cellCenter.z * 2);
    // w = code × 4 + mode d'éclairage intérieur (décodé dans growMaterial.ts).
    // Code : hauteur de chute × 100 hors pièces (seuls les toits tombent) ;
    // dans une pièce, le décalage vers son chandelier ((dx+16) × 32 + dz+16).
    const fall =
      p.interiorMode > 0
        ? ((p.lampDx + 16) * 32 + (p.lampDz + 16)) * 4 + p.interiorMode
        : Math.round(p.fallHeight * 100) * 4;

    for (let i = 0; i < count; i++) {
      const o = (offset + i) * 3;

      v.fromBufferAttribute(posAttr, i).applyMatrix4(p.matrix);
      positions[o] = v.x;
      positions[o + 1] = v.y;
      positions[o + 2] = v.z;

      n.fromBufferAttribute(norAttr, i).applyMatrix3(normalMatrix).normalize();
      normals[o] = Math.round(n.x * 127);
      normals[o + 1] = Math.round(n.y * 127);
      normals[o + 2] = Math.round(n.z * 127);

      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;

      const c = (offset + i) * 4;
      cellData[c] = cx;
      cellData[c + 1] = cy;
      cellData[c + 2] = cz;
      cellData[c + 3] = fall;

      spawns[offset + i] = p.spawn;
    }
    offset += count;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geometry.setAttribute('aCell', new THREE.BufferAttribute(cellData, 4));
  geometry.setAttribute('aSpawn', new THREE.BufferAttribute(spawns, 1));
  return geometry;
}
