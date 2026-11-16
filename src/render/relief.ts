/**
 * Relief du terrain sous le village : de larges ondulations, nulles au centre
 * de la grille (la cible de la caméra reste au niveau du sol) et qui
 * s'éteignent au-delà du village, là où le paysage redevient plat avant les
 * collines (landscape.ts).
 *
 * Une somme de sinusoïdes plutôt qu'un bruit : la même formule s'écrit telle
 * quelle en GLSL (`RELIEF_GLSL`), si bien que le shader du village connaît la
 * hauteur du sol sous chaque fragment — pied des murs sali et moussu au ras
 * du terrain, pas à une cote fixe.
 *
 * Les ondulations dépendent de la graine du terrain (terrainShape.ts) : une
 * nouvelle génération donne d'autres vallons. S'y ajoute le modelage à la
 * main : chaque case relevée ou creusée porte une bosse lisse (B-spline
 * cubique, qui déborde de deux cases), cuite une fois dans un treillis fin que
 * JS lit en bilinéaire et le shader dans une texture — même valeur des deux
 * côtés.
 *
 * Pur et déterministe : le relief ne dépend que de la position monde, de la
 * taille de la grille, de l'amplitude réglée et de la forme du terrain.
 */

import { DEFAULT_TERRAIN, type SculptEntry, type TerrainShape } from '../terrainShape';
import { seededRandom } from '../utils/noise';

/** Une ondulation : amplitude (unités), vecteur d'onde (rad / unité) et phase (rad). */
export interface Wave {
  a: number;
  kx: number;
  kz: number;
  phase: number;
}

/** Modelage cuit : hauteurs aux nœuds d'un treillis carré de pas 1 / `SCULPT_RESOLUTION`, centré sur le village. */
export interface SculptField {
  /** Demi-côté (monde) du treillis ; au-delà, le modelage est nul. */
  half: number;
  /** Nœuds par côté. */
  n: number;
  /** Hauteurs, ligne par ligne (z puis x). Nulles sur le bord. */
  heights: Float32Array;
  /** Borne de |hauteur|. */
  bound: number;
}

export interface Relief {
  /** Facteur d'amplitude des ondulations (0 = aucune, 1 = défaut : ±0,6 unité environ). */
  amplitude: number;
  /** Rayon (monde) jusqu'auquel les ondulations sont entières, puis celui où elles s'annulent. */
  inner: number;
  outer: number;
  waves: readonly Wave[];
  /** Modelage à la main, ou null s'il n'y en a pas. */
  sculpt: SculptField | null;
}

/** Ondulations de base : amplitude (unités), longueur d'onde (unités), direction et phase (radians). */
const WAVE_SPECS = [
  { a: 0.5, length: 19, angle: 0.6, phase: 0.3 },
  { a: 0.22, length: 11, angle: 2.1, phase: 4.0 },
  { a: 0.08, length: 5.5, angle: 3.9, phase: 0.4 },
];

/** Nombre d'ondulations (taille du tableau d'uniforms). */
export const WAVE_COUNT = WAVE_SPECS.length;

const wave = (a: number, length: number, angle: number, phase: number): Wave => ({
  a,
  kx: (Math.cos(angle) * 2 * Math.PI) / length,
  kz: (Math.sin(angle) * 2 * Math.PI) / length,
  phase,
});

/**
 * Ondulations d'une graine : mêmes échelles que celles de base (un grand
 * vallon, une ondulation moyenne, un froissé), mais direction et phase tirées
 * au hasard, longueur et amplitude un peu variées. Graine 0 : celles de base.
 */
export function wavesFor(seed: number): Wave[] {
  if (seed === 0) return WAVE_SPECS.map(({ a, length, angle, phase }) => wave(a, length, angle, phase));
  const random = seededRandom(seed);
  return WAVE_SPECS.map(({ a, length }) =>
    wave(a * (0.8 + 0.4 * random()), length * (0.85 + 0.45 * random()), random() * 2 * Math.PI, random() * 2 * Math.PI),
  );
}

/** Terrain plat (tests, réglage à 0 sans modelage). */
export const FLAT_RELIEF: Relief = { amplitude: 0, inner: 1, outer: 2, waves: wavesFor(0), sculpt: null };

/** Largeur (unités) de la couronne où les ondulations s'éteignent autour du village. */
const FADE_WIDTH = 8;

/** Hauteur d'un cran de modelage sur un plateau (plusieurs cases voisines au même cran). */
export const SCULPT_STEP_HEIGHT = 0.4;
/** Nœuds du treillis par unité : le pas de la maille fine du terrain (Terrain.tsx). */
export const SCULPT_RESOLUTION = 4;
/** Marge (cases) du treillis autour de la grille : la bosse d'une case de bord y retombe à zéro. */
const SCULPT_MARGIN = 2;

/** B-spline cubique uniforme : lisse (C²), nulle au-delà de 2, et de somme 1 sur les entiers. */
function bspline(t: number): number {
  const d = Math.abs(t);
  if (d < 1) return 2 / 3 - d * d + (d * d * d) / 2;
  if (d < 2) return (2 - d) ** 3 / 6;
  return 0;
}

function bakeSculpt(gridSize: number, sculpt: readonly SculptEntry[]): SculptField | null {
  if (sculpt.length === 0) return null;
  const half = gridSize / 2 + SCULPT_MARGIN;
  const n = Math.round(2 * half * SCULPT_RESOLUTION) + 1;
  const heights = new Float32Array(n * n);
  const reach = 2 * SCULPT_RESOLUTION;
  for (const [x, z, steps] of sculpt) {
    // Centre de la case, en nœuds du treillis.
    const cx = (x + 0.5 + SCULPT_MARGIN) * SCULPT_RESOLUTION;
    const cz = (z + 0.5 + SCULPT_MARGIN) * SCULPT_RESOLUTION;
    for (let j = Math.max(0, Math.ceil(cz - reach)); j <= Math.min(n - 1, Math.floor(cz + reach)); j += 1) {
      const wz = bspline((j - cz) / SCULPT_RESOLUTION);
      for (let i = Math.max(0, Math.ceil(cx - reach)); i <= Math.min(n - 1, Math.floor(cx + reach)); i += 1) {
        heights[j * n + i] += steps * SCULPT_STEP_HEIGHT * wz * bspline((i - cx) / SCULPT_RESOLUTION);
      }
    }
  }
  let bound = 0;
  for (const height of heights) bound = Math.max(bound, Math.abs(height));
  return { half, n, heights, bound };
}

/** Modelage en (x, z) monde : lecture bilinéaire du treillis (ce que fait aussi la texture du shader). */
function sculptHeight(field: SculptField, x: number, z: number): number {
  const u = (x + field.half) * SCULPT_RESOLUTION;
  const v = (z + field.half) * SCULPT_RESOLUTION;
  const last = field.n - 1;
  if (!(u > 0 && v > 0 && u < last && v < last)) return 0;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const o = j * field.n + i;
  const h = field.heights;
  return (h[o] * (1 - fu) + h[o + 1] * fu) * (1 - fv) + (h[o + field.n] * (1 - fu) + h[o + field.n + 1] * fu) * fv;
}

/**
 * Relief d'une grille de côté `gridSize` : ondulations entières sur toute la
 * grille et ses abords immédiats, plus le modelage de `shape`.
 */
export function reliefFor(gridSize: number, amplitude: number, shape: TerrainShape = DEFAULT_TERRAIN): Relief {
  const sculpt = bakeSculpt(gridSize, shape.sculpt);
  if (!(amplitude > 0) && !sculpt) return FLAT_RELIEF;
  const inner = (gridSize / 2) * Math.SQRT2 + 2;
  return { amplitude: Math.max(0, amplitude), inner, outer: inner + FADE_WIDTH, waves: wavesFor(shape.seed), sculpt };
}

/** Vrai si le terrain est partout à y = 0 (ni ondulations ni modelage). */
export function isFlatRelief(relief: Relief): boolean {
  return relief.amplitude === 0 && relief.sculpt === null;
}

/** Borne de |hauteur| du relief. */
export function reliefBound(relief: Relief): number {
  const waves = relief.waves.reduce((sum, { a, phase }) => sum + a * (1 + Math.abs(Math.sin(phase))), 0);
  return relief.amplitude * waves + (relief.sculpt?.bound ?? 0);
}

/** Demi-côté (monde) du carré hors duquel le relief est nul ; 0 sur terrain plat. */
export function reliefReach(relief: Relief): number {
  return Math.max(relief.amplitude > 0 ? relief.outer : 0, relief.sculpt?.half ?? 0);
}

/** Hauteur du terrain en (x, z) monde. */
export function reliefHeight(x: number, z: number, relief: Relief): number {
  let height = 0;
  if (relief.amplitude !== 0) {
    const r = Math.hypot(x, z);
    if (r < relief.outer) {
      const t = Math.min(1, Math.max(0, (r - relief.inner) / (relief.outer - relief.inner)));
      const fade = 1 - t * t * (3 - 2 * t);
      // Chaque ondulation est nulle au centre : le centre du village reste à y = 0.
      let sum = 0;
      for (const { a, kx, kz, phase } of relief.waves) sum += a * (Math.sin(kx * x + kz * z + phase) - Math.sin(phase));
      height = relief.amplitude * fade * sum;
    }
  }
  return relief.sculpt ? height + sculptHeight(relief.sculpt, x, z) : height;
}

/**
 * `vcGroundHeight(xz monde)` : la même formule que `reliefHeight`, pour les
 * shaders. Uniforms : voir reliefUniforms.ts. Sans branche : sans modelage,
 * `uSculpt` est une texture nulle d'un texel.
 */
export const RELIEF_GLSL = `
  uniform vec3 uRelief;
  uniform vec4 uReliefWaves[${WAVE_COUNT}];
  uniform sampler2D uSculpt;
  uniform vec2 uSculptMap;

  float vcGroundHeight(vec2 p) {
    float fade = 1.0 - smoothstep(uRelief.y, uRelief.z, length(p));
    float sum = 0.0;
    for (int i = 0; i < ${WAVE_COUNT}; i++) {
      vec4 wave = uReliefWaves[i];
      sum += wave.w * (sin(dot(p, wave.xy) + wave.z) - sin(wave.z));
    }
    vec2 sculptUv = ((p + uSculptMap.x) * ${SCULPT_RESOLUTION}.0 + 0.5) / uSculptMap.y;
    return uRelief.x * fade * sum + textureLod(uSculpt, sculptUv, 0.0).r;
  }
`;
