/**
 * Pose d'un objet sur le terrain en pente (ground.ts) : il est tourné pour
 * épouser la pente autour d'un point d'appui, puis monté à la hauteur du sol
 * en ce point. Réservé à ce qui est couché sur le sol (pavés, lit de pose) :
 * tout ce qui est bâti reste d'aplomb.
 */

import * as THREE from 'three';

/** Hauteur du terrain (y, repère de la case) en coordonnées locales à la case. */
export type HeightFn = (lx: number, lz: number) => number;

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _lift = new THREE.Matrix4();
const _back = new THREE.Matrix4();

/** Pente du terrain en (x, z) : (∂h/∂x, ∂h/∂z). */
export function slopeAt(heightAt: HeightFn, x: number, z: number): [number, number] {
  const e = 0.02;
  return [(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)];
}

/**
 * Matrice à pré-multiplier à un part posé sur y = 0 : rotation qui amène la
 * verticale sur la normale du terrain, autour du point d'appui (x, z), puis
 * translation à la hauteur du sol en ce point.
 */
export function drapeMatrix(heightAt: HeightFn, x: number, z: number): THREE.Matrix4 {
  const [sx, sz] = slopeAt(heightAt, x, z);
  _quat.setFromUnitVectors(UP, _normal.set(-sx, 1, -sz).normalize());
  _lift.makeTranslation(x, heightAt(x, z), z);
  _back.makeTranslation(-x, 0, -z);
  return new THREE.Matrix4().makeRotationFromQuaternion(_quat).premultiply(_lift).multiply(_back);
}
