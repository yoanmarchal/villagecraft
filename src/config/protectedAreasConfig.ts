/**
 * Configuration centralisée des zones protégées ("saved space")
 * pour éviter les superpositions entre éléments décoratifs.
 * 
 * Ces valeurs définissent les marges de sécurité autour des éléments fonctionnels
 * (fenêtres, portes, meurtrières, quoins, base trim, decorative bands) où les stone patches ne doivent pas être placés.
 */

import type { ProtectedArea, ProtectedAreasConfig } from '../types';

/**
 * Coordonnées des 4 coins d'une face (normalisées à -0.5..0.5)
 * Utilisées pour vérifier les superpositions avec les quoins
 */
export const FACE_CORNERS: [number, number][] = [
  [-0.5, 0.5],   // Haut-gauche
  [0.5, 0.5],    // Haut-droite
  [-0.5, -0.5],  // Bas-gauche
  [0.5, -0.5],   // Bas-droite
];

/**
 * Vérifie si une position (x, y) sur une face est dans une zone protégée spécifique
 */
export function isInProtectedArea(
  area: ProtectedArea,
  x: number,
  y: number,
  stoneWidth: number,
  stoneHeight: number
): boolean {
  const closestX = Math.abs(x - (area.centerX ?? 0)) - stoneWidth / 2;
  const closestY = Math.abs(y - (area.centerY ?? 0)) - stoneHeight / 2;
  return closestX < (area.marginX ?? 0) && closestY < area.marginY;
}

/**
 * Vérifie si une position (x, y) est dans l'une des zones protégées de la configuration
 */
export function checkInProtectedZones(
  protectedAreas: ProtectedAreasConfig,
  x: number,
  y: number,
  stoneWidth: number,
  stoneHeight: number
): boolean {
  for (const [areaKey, area] of Object.entries(protectedAreas)) {
    // Pour les zones de coins (spéciales)
    if (areaKey === 'corner') {
      const cornerMarginX = area.marginX ?? 0;
      const cornerMarginY = area.marginY;
      
      for (const [cornerX, cornerY] of FACE_CORNERS) {
        const distX = Math.abs(x - cornerX) - stoneWidth / 2;
        const distY = Math.abs(y - cornerY) - stoneHeight / 2;
        if (distX < cornerMarginX && distY < cornerMarginY) {
          return true;
        }
      }
    } else {
      // Pour les zones centrales (fenêtres, portes, etc.)
      if (isInProtectedArea(area, x, y, stoneWidth, stoneHeight)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Zones protégées pour WallWithWindowCell
 * Protège les fenêtres, portes, meurtrières et decorative bands contre les superpositions avec les stone patches
 */
export const WINDOW_PROTECTED_AREAS: ProtectedAreasConfig = {
  // Fenêtre : cadre 0.6×0.5, vitre 0.54×0.44
  // Zone à protéger : demi-largeur = 0.3, demi-hauteur = 0.25
  // Marge légèrement supérieure pour sécurité : 0.32 × 0.27
  window: { marginX: 0.32, marginY: 0.27, centerX: 0, centerY: 0 },
  
  // Porte : cadre 0.48×0.8, panneau 0.4×0.7
  // Positionnée en bas (centerY ≈ -0.10)
  // Demi-largeur = 0.24, demi-hauteur = 0.40
  // Marge : 0.26 × 0.42
  door: { marginX: 0.26, marginY: 0.42, centerX: 0, centerY: -0.10 },
  
  // Meurtrière : 0.14×0.4
  // Demi-largeur = 0.07, demi-hauteur = 0.20
  // Marge : 0.09 × 0.23
  arrowSlit: { marginX: 0.09, marginY: 0.23, centerX: 0, centerY: 0 },
  
  // Decorative Band Top : bande circulaire à y=0.35, radius=0.505, height=0.08
  // Zone à protéger : marge pour éviter les superpositions avec les pierres
  // Les pierres sont à 0.5125 (au-dessus de 0.505)
  // Marge radiale de 0.40 pour couvrir la largeur du band
  bandTop: { marginX: 0.40, marginY: 0.04, centerX: 0, centerY: 0.35 },
  
  // Decorative Band Bottom : bande circulaire à y=-0.35, radius=0.505, height=0.08
  // Zone à protéger : marge pour éviter les superpositions avec les pierres
  bandBottom: { marginX: 0.40, marginY: 0.04, centerX: 0, centerY: -0.35 },
};

/**
 * Zones protégées pour StandardCell
 * Protège les quoins (coins), la base trim et les decorative bands contre les superpositions avec les stone patches
 */
export const STANDARD_PROTECTED_AREAS: ProtectedAreasConfig = {
  
  // Zone de la base trim : bande horizontale en bas à y = -0.46
  // Hauteur de la base trim : 0.08
  // Marge verticale de 0.10 pour éviter les superpositions
  baseTrim: { marginY: 0.10, centerY: -0.46 },
  
  // Decorative Band Top : bande horizontale à y=0.455, taille 1.05×0.08×1.05
  // Marge verticale pour éviter les superpositions avec les stone patches
  // Hauteur : 0.08, donc marge verticale de 0.10
  bandTop: { marginX: 0.05, marginY: 0.10, centerX: 0, centerY: 0.455 },
  
  // Decorative Band Bottom : bande horizontale à y=-0.455 (symétrique du bandTop)
  // Même configuration que bandTop mais en bas
  bandBottom: { marginX: 0.05, marginY: 0.10, centerX: 0, centerY: -0.455 },
};
