/**
 * Où se trouve le promeneur, pour ce qui réagit à sa présence dans la scène
 * (portes qui s'ouvrent, VillageMeshes). Publié par WalkControls à chaque
 * frame ; null hors promenade. Un objet module plutôt qu'un store : lu et
 * écrit à chaque frame, il ne doit déclencher aucun rendu React.
 */

import type { Vec3 } from './walkWorld';

export const walkerPresence: { feet: Vec3 | null } = { feet: null };
