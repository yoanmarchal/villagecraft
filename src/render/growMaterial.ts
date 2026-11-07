/**
 * Matériaux "grow" — variante de MeshStandardMaterial (+ MeshDepthMaterial
 * pour les ombres) qui rejoue une transition d'apparition par cellule.
 *
 * Le mesh du village est un seul BufferGeometry fusionné (voir buildVillage.ts),
 * donc on ne peut pas animer chaque bloc via sa transform d'objet : chaque
 * vertex porte à la place le pivot et la hauteur de chute de sa cellule
 * (`aCell`, entiers compacts) et son horodatage (`aSpawn`).
 *
 * Deux variantes selon la hauteur de chute :
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
import { FLOOR_T, WALL_T } from './geometryCache';
import { INTERIOR_LAMP_Y } from './cells/interiorParts';

export const POP_DURATION = 0.45;
/** Hauteur de chute des toits (en unités monde, ~1 par bloc) — "pas haut". */
export const ROOF_DROP_HEIGHT = 0.6;
/** Échelle de départ des murs — 0 (point) rendait le pop trop violent. */
const WALL_MIN_SCALE = 0.65;

// aCell : Int16 (non normalisé, lu en flottants) = (pivot × 2, w) avec
// w = code × 4 + mode d'éclairage intérieur 0-2 ; code = chute × 100 (mode 0)
// ou décalage vers le chandelier de la pièce (voir mergeParts).
const GROW_DECLARATIONS = `
  attribute vec4 aCell;
  attribute float aSpawn;
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
    // Le code ne porte une chute que hors pièce (mode 0) ; dans une pièce, c'est le décalage du chandelier.
    float growFallHeight = mod(aCell.w, 4.0) > 0.5 ? 0.0 : floor(aCell.w * 0.25) * 0.01;
    if (growFallHeight > 0.0) {
      transformed.y += (1.0 - growT) * growFallHeight;
    } else {
      float growScale = mix(${WALL_MIN_SCALE.toFixed(3)}, 1.0, growT);
      transformed = mix(aCell.xyz * 0.5, transformed, growScale);
    }
  }
`;

/**
 * Éclairage intérieur des blocs creux. Les murs arrêtent le soleil : sans
 * lui, une pièce vue par la fenêtre n'est éclairée que par l'ambiante, donc
 * noire — et le mobilier à venir illisible. On simule une lampe à la hauteur
 * des flammes du chandelier de la pièce (un par pièce, voir roomLamps.ts —
 * chaque cellule connaît le décalage vers le sien), atténuée avec la distance :
 * les parts marqués intérieurs (`InteriorKind` — aménagement, et faces de
 * cavité de la coque) reçoivent `uInteriorLight` × albédo selon leur
 * orientation vers la lampe. Pierres, chaînages, cadres : jamais. Pas
 * d'ombre ni de vraie lumière three : un terme d'émission, calculé par
 * fragment, gratuit quel que soit le nombre de maisons.
 */
/** Cavité de la coque : entre plancher et plafond, en deçà de la face intérieure des murs. */
const CAVITY_HALF_HEIGHT = (0.5 - FLOOR_T + 0.005).toFixed(3);
const CAVITY_HALF_WIDTH = (0.5 - WALL_T + 0.005).toFixed(3);
const LAMP_Y = INTERIOR_LAMP_Y.toFixed(3);
/** Atténuation horizontale de la lampe : moitié de l'éclairage à 2 cases du chandelier. */
const LAMP_FALLOFF = '0.25';

const INTERIOR_VERTEX_DECLARATIONS = `
  varying vec3 vInteriorLocal;
  varying vec3 vInteriorLamp;
  varying vec3 vInteriorNormal;
  varying float vInteriorMode;
`;

// Le sommet ne fait que transmettre position (repère de la cellule), lampe,
// normale et mode : tout le calcul est par fragment. Calculé par sommet puis
// interpolé, l'éclairage suivait les grands triangles irréguliers que la CSG
// laisse sur les murs (bandes et triangles plus clairs sur les murs intérieurs).
const INTERIOR_VERTEX_APPLY = `
  {
    // Mode : 0 aucun, 1 coque (cavité seulement), 2 aménagement (voir InteriorKind).
    vInteriorMode = mod(aCell.w, 4.0);
    vInteriorLocal = transformed - aCell.xyz * 0.5;
    // Chandelier de la pièce : décalage (en cases) codé dans aCell.w (voir mergeParts).
    float lampCode = floor(aCell.w * 0.25);
    vInteriorLamp = vec3(floor(lampCode / 32.0) - 16.0, ${LAMP_Y}, mod(lampCode, 32.0) - 16.0);
    vInteriorNormal = objectNormal;
  }
`;

const INTERIOR_FRAGMENT_DECLARATIONS = `
  uniform vec3 uInteriorLight;
  varying vec3 vInteriorLocal;
  varying vec3 vInteriorLamp;
  varying vec3 vInteriorNormal;
  varying float vInteriorMode;
`;

const INTERIOR_FRAGMENT_APPLY = `
  if (vInteriorMode > 0.5) {
    // Cavité testée selon l'axe de la normale seulement : face intérieure d'un
    // mur (|z| < demi-cavité, quel que soit x), jamais sa face extérieure
    // (|z| = 0.5). Tester x et z ensemble laissait dans le noir la bande de
    // mur de 8 cm de chaque côté d'une jonction entre deux cellules d'une
    // pièce (le mur file jusqu'au bord de la cellule le long d'un côté ouvert).
    vec3 interiorAxis = abs(vInteriorNormal);
    vec3 interiorPos = abs(vInteriorLocal);
    float interiorDepth = interiorAxis.y > max(interiorAxis.x, interiorAxis.z)
      ? 0.0 // plancher, plafond : seule la hauteur compte
      : (interiorAxis.x > interiorAxis.z ? interiorPos.x : interiorPos.z);
    bool inCavity = interiorPos.y < ${CAVITY_HALF_HEIGHT} && interiorDepth < ${CAVITY_HALF_WIDTH};
    if (vInteriorMode > 1.5 || inCavity) {
      vec3 toLamp = vInteriorLamp - vInteriorLocal + vec3(1e-4);
      float lampDistance = length(toLamp.xz);
      float interiorLight = max(dot(normalize(vInteriorNormal), normalize(toLamp)), 0.0)
        / (1.0 + ${LAMP_FALLOFF} * lampDistance * lampDistance);
      totalEmissiveRadiance += diffuseColor.rgb * uInteriorLight * interiorLight;
    }
  }
`;

function injectInterior(shader: THREE.WebGLProgramParametersWithUniforms, interiorLight: { value: THREE.Color }): void {
  shader.uniforms.uInteriorLight = interiorLight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `${INTERIOR_VERTEX_DECLARATIONS}\n#include <common>`)
    .replace('#include <project_vertex>', `${INTERIOR_VERTEX_APPLY}\n#include <project_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `${INTERIOR_FRAGMENT_DECLARATIONS}\n#include <common>`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${INTERIOR_FRAGMENT_APPLY}`);
}

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
  /** Lumière intérieure (couleur × intensité) : uniform partagé, à muter en place (`.value.copy(…)`). */
  interiorLight: { value: THREE.Color };
}

export function createGrowMaterialSet(params: THREE.MeshStandardMaterialParameters): GrowMaterialSet {
  const initialTime = performance.now() / 1000;
  // Objet uniform créé ici et non à la compilation : une mise à jour avant
  // la première compilation du shader n'est ainsi jamais perdue.
  const interiorLight = { value: new THREE.Color(0, 0, 0) };

  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = (shader) => {
    injectGrow(shader, initialTime);
    injectInterior(shader, interiorLight);
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

  return { material, depthMaterial, interiorLight };
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
