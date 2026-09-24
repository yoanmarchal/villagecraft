/** Nombre d'étages de la grille. */
export const GRID_HEIGHT = 10;

/**
 * Bornes du côté de la grille (slider "gridSize", liens de partage). À 12,
 * un village plein fait ~850 k sommets et ~60 ms de reconstruction par clic.
 */
export const GRID_SIZE_MIN = 2;
export const GRID_SIZE_MAX = 12;

/** Taille de grille pour laquelle les distances par défaut (caméra, brouillard) ont été réglées. */
const REFERENCE_GRID_SIZE = 5;

/**
 * Facteur d'échelle de la scène : les distances de caméra et de brouillard
 * sont réglées pour une grille de 5 ; au-delà on les étire d'autant, pour
 * qu'un grand village tienne à l'écran sans disparaître dans le brouillard.
 */
export function sceneScale(gridSize: number): number {
  return Math.max(1, gridSize / REFERENCE_GRID_SIZE);
}

/**
 * Recul initial de la caméra : plus doux que `sceneScale`, sinon un grand
 * village n'occupe qu'un coin de l'écran (on peut toujours dézoomer).
 */
export function initialCameraScale(gridSize: number): number {
  return Math.max(1, gridSize / 8);
}

/**
 * Demi-côté du volume de la caméra d'ombre de la lumière directionnelle
 * (orthographique, ±5 par défaut dans three.js — trop étroit au-delà d'une
 * grille de ~5). Couvre la grille plus la portée des ombres des bâtiments.
 */
export function shadowCameraHalfSize(gridSize: number): number {
  return gridSize * 0.75 + 4;
}
