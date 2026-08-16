/**
 * Matériaux "grow" — variante de MeshStandardMaterial (+ MeshDepthMaterial
 * pour les ombres) qui rejoue une transition d'apparition par cellule.
 *
 * Le mesh du village est un seul BufferGeometry fusionné (voir buildVillage.ts),
 * donc on ne peut pas animer chaque bloc via sa transform d'objet : chaque
 * vertex porte à la place le pivot (`aCellCenter`), l'horodatage (`aSpawn`)
 * et la hauteur de chute (`aFallHeight`) de sa cellule.
 *
 * Deux variantes selon `aFallHeight` :
 *  - 0 (murs/fondations/arches) : scale uniforme depuis le pivot de la
 *    cellule, normales inchangées. Part d'`WALL_MIN_SCALE` plutôt que 0 —
 *    un scale depuis un point rendait le pop trop violent.
 *  - > 0 (toits) : le mix depuis le pivot fait paraître le toit "gonfler"
 *    depuis son centre, peu lisible pour une forme aussi anguleuse — on
 *    laisse la géométrie à sa taille réelle et on la fait tomber d'une
 *    petite hauteur.
 *
 * Easing ease-out simple (jamais > 1) : un ease-out-back avec rebond
 * dépasse la valeur cible en cours de route, donc le scale des murs poke
 * temporairement dans les voisins et le toit s'enfonce dans le mur en
 * atterrissant — visuellement une fusion/débordement des blocs.
 */

import * as THREE from 'three';

const POP_DURATION = 0.45;
/** Hauteur de chute des toits (en unités monde, ~1 par bloc) — "pas haut". */
export const ROOF_DROP_HEIGHT = 0.6;
/** Échelle de départ des murs — 0 (point) rendait le pop trop violent. */
const WALL_MIN_SCALE = 0.65;

const GROW_DECLARATIONS = `
  attribute vec3 aCellCenter;
  attribute float aSpawn;
  attribute float aFallHeight;
  uniform float uTime;
  uniform float uEnabled;

  float growEaseOut(float x) {
    return 1.0 - pow(1.0 - x, 3.0);
  }
`;

const GROW_APPLY = `
  {
    float growAge = clamp((uTime - aSpawn) / ${POP_DURATION.toFixed(3)}, 0.0, 1.0);
    float growT = uEnabled > 0.5 ? growEaseOut(growAge) : 1.0;
    if (aFallHeight > 0.0) {
      transformed.y += (1.0 - growT) * aFallHeight;
    } else {
      float growScale = mix(${WALL_MIN_SCALE.toFixed(3)}, 1.0, growT);
      transformed = mix(aCellCenter, transformed, growScale);
    }
  }
`;

function injectGrow(shader: THREE.WebGLProgramParametersWithUniforms, initialTime: number): void {
  // `uTime` par défaut à 0 ferait calculer `growAge` comme 0 pour TOUTES les
  // cellules (même déjà posées depuis longtemps) le temps qu'`updateGrowTime`
  // tourne au prochain frame — un flash d'un frame où tout le groupe se
  // redessine "juste apparu". Ça se voit à chaque recompilation de shader,
  // donc à chaque rebuild de matériau (ex: on drag un slider qui régénère la
  // géométrie en continu). On amorce donc `uTime` à l'heure réelle de
  // création du matériau plutôt qu'à 0.
  shader.uniforms.uTime = { value: initialTime };
  shader.uniforms.uEnabled = { value: 1 };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `${GROW_DECLARATIONS}\n#include <common>`)
    .replace('#include <project_vertex>', `${GROW_APPLY}\n#include <project_vertex>`);
}

export interface GrowMaterialSet {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
}

export function createGrowMaterialSet(params: THREE.MeshStandardMaterialParameters): GrowMaterialSet {
  const initialTime = performance.now() / 1000;

  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = (shader) => {
    injectGrow(shader, initialTime);
    material.userData.shader = shader;
  };

  // Les ombres portées passent par un matériau de profondeur séparé : sans
  // le même décalage, l'ombre d'un bloc apparaîtrait instantanément en taille
  // finale pendant que le bloc lui-même grandit encore.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    injectGrow(shader, initialTime);
    depthMaterial.userData.shader = shader;
  };

  return { material, depthMaterial };
}

export function updateGrowTime(set: GrowMaterialSet, time: number, enabled: boolean): void {
  const shader1 = set.material.userData.shader as THREE.WebGLProgramParametersWithUniforms | undefined;
  if (shader1) {
    shader1.uniforms.uTime.value = time;
    shader1.uniforms.uEnabled.value = enabled ? 1 : 0;
  }

  const shader2 = set.depthMaterial.userData.shader as THREE.WebGLProgramParametersWithUniforms | undefined;
  if (shader2) {
    shader2.uniforms.uTime.value = time;
    shader2.uniforms.uEnabled.value = enabled ? 1 : 0;
  }
}

export function disposeGrowMaterialSet(set: GrowMaterialSet): void {
  set.material.dispose();
  set.depthMaterial.dispose();
}
