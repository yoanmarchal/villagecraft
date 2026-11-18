/**
 * Constantes du mode promenade (vue à la première personne).
 *
 * Échelle de la scène : 1 unité ≈ 2,8 m (une porte de 0,71 fait ~2 m, voir
 * docs/interiors.md). Les valeurs sont écrites en mètres puis converties,
 * pour rester lisibles.
 */

export const METERS_PER_UNIT = 2.8;

const m = (meters: number) => meters / METERS_PER_UNIT;

/** Hauteur du promeneur, des pieds au sommet du crâne. */
export const WALKER_HEIGHT = m(1.75);
/** Hauteur des yeux au-dessus des pieds. */
export const EYE_HEIGHT = m(1.62);
/** Demi-côté de la boîte de collision (le promeneur est un pavé vertical). */
export const WALKER_RADIUS = m(0.25);
/** Marche franchie sans sauter (bordure, seuil, soubassement bas). */
export const STEP_HEIGHT = m(0.4);

/** Vitesse de marche et de course (unités / s). */
export const WALK_SPEED = m(1.6);
export const RUN_SPEED = m(4.5);
/** Temps pour atteindre la vitesse visée (s) : démarrage et arrêt sans à-coup. */
export const SPEED_RESPONSE = 0.12;

/** Gravité (unités / s²) et vitesse initiale d'un saut de ~45 cm. */
export const GRAVITY = m(9.81);
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * m(0.45));

/** Pas maximal d'intégration (s) : au-delà, la frame est découpée. */
export const MAX_SUBSTEP = 1 / 120;
/** Frame la plus longue prise en compte (onglet en arrière-plan, gel). */
export const MAX_FRAME = 0.1;

/** Inclinaison maximale du regard (rad), un peu moins que la verticale. */
export const MAX_PITCH = Math.PI / 2 - 0.05;
