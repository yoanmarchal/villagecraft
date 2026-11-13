/**
 * Relief du terrain sous le village : de larges ondulations, nulles au centre
 * de la grille (la cible de la caméra reste au niveau du sol) et qui
 * s'éteignent au-delà du village, là où le paysage redevient plat avant les
 * collines (landscape.ts).
 *
 * Une somme de sinusoïdes plutôt qu'un bruit : la même formule s'écrit telle
 * quelle en GLSL (`RELIEF_GLSL`), si bien que le shader du village connaît la
 * hauteur du sol sous chaque fragment — pied des murs sali et moussu au ras
 * du terrain, pas à une cote fixe — sans texture ni attribut de plus.
 *
 * Pur et déterministe : le relief ne dépend que de la position monde, de la
 * taille de la grille (rayon d'extinction) et de l'amplitude réglée.
 */

export interface Relief {
  /** Facteur d'amplitude (0 = terrain plat, 1 = défaut : ±0,6 unité environ). */
  amplitude: number;
  /** Rayon (monde) jusqu'auquel le relief est entier, puis celui où il s'annule. */
  inner: number;
  outer: number;
}

/** Terrain plat (tests, réglage à 0). */
export const FLAT_RELIEF: Relief = { amplitude: 0, inner: 1, outer: 2 };

/** Ondulations : amplitude (unités), longueur d'onde (unités), direction et phase (radians). */
const WAVE_SPECS = [
  { a: 0.5, length: 19, angle: 0.6, phase: 0.3 },
  { a: 0.22, length: 11, angle: 2.1, phase: 4.0 },
  { a: 0.08, length: 5.5, angle: 3.9, phase: 0.4 },
];

const WAVES = WAVE_SPECS.map(({ a, length, angle, phase }) => ({
  a,
  kx: +((Math.cos(angle) * 2 * Math.PI) / length).toFixed(5),
  kz: +((Math.sin(angle) * 2 * Math.PI) / length).toFixed(5),
  phase,
}));

/** Valeur des ondulations au centre : retranchée, pour que le centre du village reste à y = 0. */
const CENTRE = +WAVES.reduce((sum, { a, phase }) => sum + a * Math.sin(phase), 0).toFixed(5);

/** Borne de |hauteur| pour une amplitude de 1. */
export const RELIEF_MAX = WAVES.reduce((sum, { a }) => sum + a, 0) + Math.abs(CENTRE);

/** Largeur (unités) de la couronne où le relief s'éteint autour du village. */
const FADE_WIDTH = 8;

/** Relief d'une grille de côté `gridSize` : entier sur toute la grille et ses abords immédiats. */
export function reliefFor(gridSize: number, amplitude: number): Relief {
  if (!(amplitude > 0)) return FLAT_RELIEF;
  const inner = (gridSize / 2) * Math.SQRT2 + 2;
  return { amplitude, inner, outer: inner + FADE_WIDTH };
}

/** Hauteur du terrain en (x, z) monde. */
export function reliefHeight(x: number, z: number, relief: Relief): number {
  if (relief.amplitude === 0) return 0;
  const r = Math.hypot(x, z);
  if (r >= relief.outer) return 0;
  const t = Math.min(1, Math.max(0, (r - relief.inner) / (relief.outer - relief.inner)));
  const fade = 1 - t * t * (3 - 2 * t);
  let sum = -CENTRE;
  for (const { a, kx, kz, phase } of WAVES) sum += a * Math.sin(kx * x + kz * z + phase);
  return relief.amplitude * fade * sum;
}

/** Valeur de l'uniform `uRelief` pour un relief donné. */
export function reliefUniform(relief: Relief): [number, number, number] {
  return [relief.amplitude, relief.inner, relief.outer];
}

const glsl = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** `vcGroundHeight(xz monde)` : la même formule que `reliefHeight`, pour les shaders. */
export const RELIEF_GLSL = `
  uniform vec3 uRelief;

  float vcGroundHeight(vec2 p) {
    float fade = 1.0 - smoothstep(uRelief.y, uRelief.z, length(p));
    float sum = ${glsl(-CENTRE)};
${WAVES.map(
  ({ a, kx, kz, phase }) => `    sum += ${glsl(a)} * sin(dot(p, vec2(${glsl(kx)}, ${glsl(kz)})) + ${glsl(phase)});`,
).join('\n')}
    return uRelief.x * fade * sum;
  }
`;
