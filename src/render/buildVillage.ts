/**
 * Collecteur + merge statique.
 *
 * 1. Pour chaque cellule occupée : calcule le CellContext (faces exposées,
 *    radii, isolement) UNE fois, dispatch vers le builder du BlockType,
 *    et pré-multiplie la position monde sur chaque part.
 * 2. Groupe tous les parts par spec de matériau (roughness/metalness/
 *    transparence quantifiés).
 * 3. Fusionne chaque groupe en un seul BufferGeometry non-indexé
 *    (position + normal + couleur par vertex).
 *
 * → une dizaine de draw calls pour tout le village, reconstruits uniquement
 *   quand la grille change.
 */

import * as THREE from 'three';
import { BlockType, type GridCell } from '../types';
import {
  getCornerRadii,
  getExposedFaces,
  isIsolatedBlock,
  isTowerColumn,
  makeCellLookup,
} from '../utils/cellUtils';
import { matKey, type MaterialSpec, type Part, type PositionedPart } from './parts';
import { ROOF_DROP_HEIGHT } from './growMaterial';
import type { CellContext } from './cells/context';
import { standardCellParts } from './cells/standardCellParts';
import { wallWindowCellParts } from './cells/wallWindowCellParts';
import { roofCellParts } from './cells/roofCellParts';
import { archCellParts } from './cells/archCellParts';

export interface MergedGroup {
  key: string;
  mat: MaterialSpec;
  geometry: THREE.BufferGeometry;
}

export function buildVillage(
  cells: GridCell[],
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number],
): MergedGroup[] {
  const lookup = makeCellLookup(cells);
  const groups = new Map<string, { mat: MaterialSpec; parts: PositionedPart[] }>();

  const translation = new THREE.Matrix4();

  for (const cell of cells) {
    const ctx: CellContext = {
      cell,
      lookup,
      exposedFaces: getExposedFaces(lookup, cell),
      radii: getCornerRadii(lookup, cell),
      // Murs/fondations : propagation tour vers le bas. Toits : check local
      // non propagé. Asymétrie intentionnelle (voir AGENTS.md).
      isIsolated: cell.type === BlockType.Roof ? isIsolatedBlock(lookup, cell) : isTowerColumn(lookup, cell),
    };

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

    const [wx, wy, wz] = toWorldPosition(cell.x, cell.y, cell.z);
    translation.makeTranslation(wx, wy, wz);
    const cellCenter = new THREE.Vector3(wx, wy, wz);
    const spawn = cell.spawnedAt ?? 0;
    const fallHeight = cell.type === BlockType.Roof ? ROOF_DROP_HEIGHT : 0;

    for (const p of cellParts) {
      p.matrix.premultiply(translation);
      const key = matKey(p.mat);
      let group = groups.get(key);
      if (!group) {
        group = { mat: p.mat, parts: [] };
        groups.set(key, group);
      }
      group.parts.push({ ...p, cellCenter, spawn, fallHeight });
    }
  }

  const merged: MergedGroup[] = [];
  for (const [key, { mat, parts }] of groups) {
    merged.push({ key, mat, geometry: mergeParts(parts) });
  }
  return merged;
}

/**
 * Fusionne des parts en un BufferGeometry unique, en écrivant directement
 * dans des Float32Array (pas de clone de géométrie intermédiaire).
 * Les géométries sources (cache) sont non-indexées avec position + normal.
 */
/** Un part avec une matrice non-finie (NaN/Infinity) corromprait tout le groupe fusionné. */
function isFinitePart(p: Part): boolean {
  const e = p.matrix.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(e[i])) return false;
  }
  return true;
}

function mergeParts(allParts: PositionedPart[]): THREE.BufferGeometry {
  const parts = allParts.filter(isFinitePart);
  if (parts.length !== allParts.length) {
    console.warn(`buildVillage: ${allParts.length - parts.length} part(s) ignoré(s) (matrice non-finie)`);
  }

  let total = 0;
  for (const p of parts) total += p.geo.attributes.position.count;

  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const cellCenters = new Float32Array(total * 3);
  const spawns = new Float32Array(total);
  const fallHeights = new Float32Array(total);

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const color = new THREE.Color();
  const normalMatrix = new THREE.Matrix3();

  let offset = 0;
  for (const p of parts) {
    const posAttr = p.geo.attributes.position;
    const norAttr = p.geo.attributes.normal;
    const count = posAttr.count;

    normalMatrix.getNormalMatrix(p.matrix);
    color.set(p.color);

    for (let i = 0; i < count; i++) {
      const o = (offset + i) * 3;

      v.fromBufferAttribute(posAttr as THREE.BufferAttribute, i).applyMatrix4(p.matrix);
      positions[o] = v.x;
      positions[o + 1] = v.y;
      positions[o + 2] = v.z;

      n.fromBufferAttribute(norAttr as THREE.BufferAttribute, i).applyMatrix3(normalMatrix).normalize();
      normals[o] = n.x;
      normals[o + 1] = n.y;
      normals[o + 2] = n.z;

      colors[o] = color.r;
      colors[o + 1] = color.g;
      colors[o + 2] = color.b;

      cellCenters[o] = p.cellCenter.x;
      cellCenters[o + 1] = p.cellCenter.y;
      cellCenters[o + 2] = p.cellCenter.z;

      spawns[offset + i] = p.spawn;
      fallHeights[offset + i] = p.fallHeight;
    }
    offset += count;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aCellCenter', new THREE.BufferAttribute(cellCenters, 3));
  geometry.setAttribute('aSpawn', new THREE.BufferAttribute(spawns, 1));
  geometry.setAttribute('aFallHeight', new THREE.BufferAttribute(fallHeights, 1));
  return geometry;
}
