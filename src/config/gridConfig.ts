/** Nombre d'étages de la grille. */
export const GRID_HEIGHT = 10;

/**
 * Bornes du côté de la grille (slider "gridSize", liens de partage, API). Un
 * village généré de 20 × 20 fait ~2 M sommets (~80 Mo de géométrie) ; un clic
 * y coûte ~170 ms de construction, dans le worker (l'interface ne fige pas) —
 * voir `npm run perf`. Au-delà, il faudra instancier les pierres et
 * simplifier les bâtiments lointains.
 */
export const GRID_SIZE_MIN = 2;
export const GRID_SIZE_MAX = 20;

/** Taille de grille pour laquelle les distances par défaut (caméra, brouillard) ont été réglées. */
const REFERENCE_GRID_SIZE = 5;

/**
 * Facteur d'échelle de la scène : les distances de caméra et de brouillard
 * sont réglées pour une grille de 5 ; au-delà on les étire d'autant, pour
 * qu'un grand village tienne à l'écran sans disparaître dans le brouillard.
 */
export function sceneScale(gridSize: number): number {
  const linear = gridSize / REFERENCE_GRID_SIZE;
  // Au-delà de 12, moitié moins vite : à 20, le recul maximal et la prairie
  // plate (paysage, landscape.ts) laissaient le village perdu au milieu.
  const knee = LARGE_GRID / REFERENCE_GRID_SIZE;
  return Math.max(1, linear <= knee ? linear : knee + (linear - knee) / 2);
}

/** Au-delà de cette taille, scène et génération sont réglées pour les grandes grilles (rien ne change jusque-là). */
export const LARGE_GRID = 12;

/**
 * Recul initial de la caméra : plus doux que `sceneScale`, sinon un grand
 * village n'occupe qu'un coin de l'écran (on peut toujours dézoomer).
 */
export function initialCameraScale(gridSize: number): number {
  if (gridSize <= LARGE_GRID) return Math.max(1, gridSize / 8);
  // Plus lent au-delà : à 20, le village n'occupait qu'un tiers de l'écran.
  return LARGE_GRID / 8 + ((gridSize - LARGE_GRID) / 8) * 0.35;
}

/**
 * Demi-côté du volume de la caméra d'ombre de la lumière directionnelle
 * (orthographique, ±5 par défaut dans three.js — trop étroit au-delà d'une
 * grille de ~5). Couvre la grille plus la portée des ombres des bâtiments.
 */
export function shadowCameraHalfSize(gridSize: number): number {
  return gridSize * 0.75 + 4;
}
