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
  makeCellLookup,
} from '../utils/cellUtils';
import { assignRoomLamps, type RoomLamp } from '../utils/roomLamps';
import { matKey, type MaterialSpec, type Part, type PositionedPart } from './parts';
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
import { plinthParts } from './cells/plinthParts';
import { createGround } from './ground';
import { isFlatRelief, reliefFor, type Relief } from './relief';
import type { RenderSettings } from './renderSettings';

export interface MergedGroup {
  key: string;
  mat: MaterialSpec;
  geometry: THREE.BufferGeometry;
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
}

export function buildVillage(
  cells: GridCell[],
  toWorldPosition: ToWorld,
  settings: RenderSettings,
  ground?: GroundExtent,
): MergedGroup[] {
  const groups = new Map<string, { mat: MaterialSpec; parts: PositionedPart[] }>();
  for (const p of collectVillageParts(cells, toWorldPosition, settings, ground)) {
    let group = groups.get(p.key);
    if (!group) {
      group = { mat: p.mat, parts: [] };
      groups.set(p.key, group);
    }
    group.parts.push(p);
  }

  const merged: MergedGroup[] = [];
  for (const [key, { mat, parts }] of groups) {
    merged.push({ key, mat, geometry: mergeParts(parts) });
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

  build(cells: GridCell[], toWorldPosition: ToWorld, settings: RenderSettings, ground?: GroundExtent): MergedGroup[] {
    const buckets = new Map<string, CollectedPart[]>();
    for (const p of collectVillageParts(cells, toWorldPosition, settings, ground)) {
      const id = `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.z / CHUNK_SIZE)}|${p.key}`;
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
          : { key: id, mat: parts[0].mat, geometry: mergeParts(parts) };
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
  }
  return `${parts.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
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
): CollectedPart[] {
  const lookup = makeCellLookup(cells);
  const collected: CollectedPart[] = [];
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
    parts: Part[],
    x: number,
    z: number,
    cellCenter: THREE.Vector3,
    spawn: number,
    fallHeight: number,
    lamp: RoomLamp | undefined,
  ) => {
    for (const p of parts) {
      p.matrix.premultiply(translation);
      const interiorMode = !lamp || !p.interior ? 0 : p.interior === 'shell' ? 1 : 2;
      const lampDx = lamp?.dx ?? 0;
      const lampDz = lamp?.dz ?? 0;
      collected.push({ ...p, x, z, key: matKey(p.mat), cellCenter, spawn, fallHeight, interiorMode, lampDx, lampDz });
    }
  };

  // Contextes d'abord : les cheminées se décident par pièce, avant les murs
  // (elles peuvent prendre la place d'une fenêtre).
  const contexts = cells.map((cell): CellContext => {
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
    };
  });
  const doors = planDoors(contexts, roomLamps);
  for (const ctx of contexts) ctx.doorFace = doors.get(ctx.cell) ?? null;
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

    addParts(cellParts, cell.x, cell.z, cellCenter, spawn, fallHeight, lamp);
  }

  if (ground) {
    for (const { x, z, parts } of pavingParts(lookup, ground, groundOf)) {
      const [wx, , wz] = toWorldPosition(x, 0, z);
      translation.makeTranslation(wx, 0, wz);
      // spawn = 0 : les pavés sont déjà "posés", sans animation d'apparition.
      addParts(parts, x, z, new THREE.Vector3(wx, 0, wz), 0, 0, undefined);
    }
    // Décor de l'herbe libre près du village (puits, charrettes, foin…).
    for (const { x, z, parts } of propsParts(lookup, ground, settings, groundOf)) {
      const [wx, , wz] = toWorldPosition(x, 0, z);
      translation.makeTranslation(wx, 0, wz);
      addParts(parts, x, z, new THREE.Vector3(wx, 0, wz), 0, 0, undefined);
    }
  }

  return collected;
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
