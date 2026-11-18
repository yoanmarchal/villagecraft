/**
 * Échelle du village : combien mesure une case, en mètres.
 *
 * Tout ce que construit le générateur est en unités de case (1 unité = une
 * case = un étage, de plancher à plancher). L'architecture suit la case :
 * murs, fenêtres, toits, pierres. Ce qui est à l'échelle d'une personne
 * garde sa taille réelle quelle que soit la case : le promeneur, les portes,
 * les marches et garde-corps, les meubles, le décor des rues. Ces tailles
 * s'écrivent en mètres (`meters()`), ou — pour les objets dessinés à
 * l'échelle de référence — s'appliquent avec `HUMAN_SCALE`.
 *
 * Changer `CELL_METERS` agrandit ou rétrécit les maisons autour d'une
 * personne ; tout le reste doit suivre (tests : scale.test.ts).
 */

/** Hauteur d'un étage (côté d'une case), en mètres. */
export const CELL_METERS = 3.36;

/**
 * Échelle à laquelle meubles, décor et portes ont été dessinés (1 case =
 * 2,8 m) : leurs cotes en unités valent pour cette case-là.
 */
export const DESIGN_CELL_METERS = 2.8;

/** Facteur à appliquer à un objet dessiné à l'échelle de référence pour qu'il garde sa taille réelle. */
export const HUMAN_SCALE = DESIGN_CELL_METERS / CELL_METERS;

/** Longueur en mètres → unités de case. */
export const meters = (length: number) => length / CELL_METERS;
