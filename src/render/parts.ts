/**
 * Pipeline "parts" — cœur du rendu génératif performant.
 *
 * Chaque type de cellule est un builder pur qui émet des `Part` :
 *   { géométrie (cachée, partagée), matrice locale, couleur, spec matériau }.
 * Le collecteur (buildVillage.ts) fusionne ensuite tous les parts par groupe
 * de matériau en un seul BufferGeometry avec couleurs par vertex.
 *
 * Résultat : quelques draw calls pour tout le village, reconstruits
 * uniquement quand la grille change (add/remove), jamais par frame.
 */

import * as THREE from 'three';

export interface MaterialSpec {
  roughness: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
}

export interface Part {
  /** Géométrie issue du cache (geometryCache.ts) — ne JAMAIS la muter. */
  geo: THREE.BufferGeometry;
  /** Transformation locale à la cellule (le collecteur pré-multiplie la position monde). */
  matrix: THREE.Matrix4;
  color: string;
  mat: MaterialSpec;
}

/**
 * Part positionné dans le monde par le collecteur (buildVillage.ts), avec le
 * pivot et l'horodatage de sa cellule — sert à rejouer l'animation
 * d'apparition/transition par cellule dans le vertex shader (growMaterial.ts).
 */
export interface PositionedPart extends Part {
  cellCenter: THREE.Vector3;
  spawn: number;
  /** > 0 pour les toits : tombe de cette hauteur au lieu de "gonfler" depuis le pivot. */
  fallHeight: number;
}

export type Vec3 = [number, number, number];

/**
 * Quantifie roughness/metalness au 0.05 près pour limiter le nombre de
 * groupes de matériaux (donc de draw calls) sans différence visible.
 */
const quantize = (v: number) => Math.round(v * 20) / 20;

export function matKey(m: MaterialSpec): string {
  const t = m.transparent ? `t${m.opacity ?? 1}` : 'o';
  return `${quantize(m.roughness)}|${quantize(m.metalness ?? 0)}|${t}`;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();

/** Matrice T·R·S à partir de position / rotation (euler XYZ) / scale. */
export function xform(pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): THREE.Matrix4 {
  _euler.set(rot[0], rot[1], rot[2]);
  _quat.setFromEuler(_euler);
  _pos.set(pos[0], pos[1], pos[2]);
  _scl.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

/** Compose des matrices parent → enfant (équivalent des groupes imbriqués JSX). */
export function mul(first: THREE.Matrix4, ...rest: THREE.Matrix4[]): THREE.Matrix4 {
  const out = first.clone();
  for (const m of rest) out.multiply(m);
  return out;
}

export function part(
  geo: THREE.BufferGeometry,
  color: string,
  mat: MaterialSpec,
  matrix: THREE.Matrix4 = new THREE.Matrix4(),
): Part {
  return { geo, matrix, color, mat };
}
