/**
 * Clavier du mode promenade. On lit `KeyboardEvent.code` (position physique
 * de la touche), pas `key` : WASD en QWERTY tombe sur ZQSD en AZERTY, sans
 * table par disposition.
 */

import type { WalkInput } from './walker';

const FORWARD = ['KeyW', 'ArrowUp'];
const BACKWARD = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RUN = ['ShiftLeft', 'ShiftRight'];
const JUMP = ['Space'];

/** Touches que le mode promenade capture (leur action par défaut est annulée). */
export const WALK_KEYS = new Set([...FORWARD, ...BACKWARD, ...LEFT, ...RIGHT, ...RUN, ...JUMP]);

const any = (pressed: ReadonlySet<string>, codes: string[]) => codes.some((code) => pressed.has(code));
const axis = (pressed: ReadonlySet<string>, positive: string[], negative: string[]) =>
  Number(any(pressed, positive)) - Number(any(pressed, negative));

/** Entrée du promeneur d'après les touches enfoncées et le cap du regard. */
export function inputFromKeys(pressed: ReadonlySet<string>, yaw: number): WalkInput {
  return {
    forward: axis(pressed, FORWARD, BACKWARD),
    strafe: axis(pressed, RIGHT, LEFT),
    yaw,
    run: any(pressed, RUN),
    jump: any(pressed, JUMP),
  };
}
