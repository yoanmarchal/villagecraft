/** Écran tactile sans souris : pas de survol, pas de pointer lock. */
export const isTouchOnly = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;
