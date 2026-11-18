/**
 * Physique du promeneur : déplacement au clavier, gravité, saut, collisions
 * contre les volumes du `WalkWorld` et suivi du terrain.
 *
 * Pur et déterministe (pas d'horloge, pas de three) : la scène appelle
 * `stepWalker` à chaque frame avec le temps écoulé, les tests aussi.
 *
 * Le promeneur est un pavé vertical [x ± R] × [y, y + H] × [z ± R], `y` au
 * niveau des pieds. Le mouvement est résolu axe par axe (x puis z puis y) :
 * un mur arrête la composante qui y entre et laisse glisser le long de lui.
 * Une marche d'au plus `STEP_HEIGHT` est franchie sans sauter ; le terrain
 * (champ de hauteur) n'arrête jamais, il porte.
 */

import {
  GRAVITY,
  JUMP_SPEED,
  MAX_FRAME,
  MAX_SUBSTEP,
  RUN_SPEED,
  SPEED_RESPONSE,
  STEP_HEIGHT,
  WALK_SPEED,
  WALKER_HEIGHT,
  WALKER_RADIUS,
} from './walkConfig';
import type { Aabb, Vec3, WalkWorld } from './walkWorld';

export interface WalkerState {
  /** Pieds du promeneur (monde). */
  position: Vec3;
  velocity: Vec3;
  /** Posé au sol (ou sur un volume) : peut sauter, suit les descentes. */
  grounded: boolean;
}

export interface WalkInput {
  /** Avancer (+1) / reculer (−1). */
  forward: number;
  /** Pas de côté vers la droite (+1) / la gauche (−1). */
  strafe: number;
  /** Cap du regard (rad, autour de +y ; 0 = vers −z, comme une caméra three). */
  yaw: number;
  run: boolean;
  jump: boolean;
}

/** Marge qui garde le promeneur à l'écart des faces qu'il touche. */
const SKIN = 1e-4;
/** Tolérance verticale : un volume dont le dessus est à ce niveau des pieds les porte. */
const SUPPORT_EPS = 1e-3;
/** Part de la vitesse visée que l'on peut encore imposer en l'air. */
const AIR_CONTROL = 0.25;
/**
 * Demi-côté de l'appui : on se tient sur ce qui est sous le centre des
 * pieds, la pointe peut dépasser d'une marche. Se poser sur le plus haut
 * volume sous toute l'emprise faisait monter deux marches trop tôt — et
 * buter du crâne contre le bord de la trémie.
 */
const FOOT = 0.02;
/** Tête : plus étroite que les épaules (passe sous le bord d'une trémie), sur cette hauteur. */
const HEAD_R = WALKER_RADIUS * 0.4;
const HEAD_H = WALKER_HEIGHT * 0.16;

const R = WALKER_RADIUS;
const H = WALKER_HEIGHT;

const across = (box: Aabb, x: number, z: number, r: number) =>
  box.min[0] < x + r && box.max[0] > x - r && box.min[2] < z + r && box.max[2] > z - r;

/**
 * Rayon (en plan) de la partie du promeneur aux pieds (x, y, z) que `box`
 * arrête — le corps (R) ou seulement la tête (HEAD_R) — ou 0 s'il passe.
 * Un volume qui ne dépasse pas `STEP_HEIGHT` au-dessus des pieds n'arrête
 * jamais : c'est une marche, on la monte (ou la pointe la surplombe).
 */
function blockingRadius(box: Aabb, x: number, y: number, z: number, margin = 0): number {
  if (box.max[1] <= y + STEP_HEIGHT || box.min[1] >= y + H) return 0;
  if (box.min[1] < y + H - HEAD_H && across(box, x, z, R + margin)) return R + margin;
  if (box.max[1] > y + H - HEAD_H && across(box, x, z, HEAD_R + margin)) return HEAD_R + margin;
  return 0;
}

const nearby = (world: WalkWorld, x: number, z: number, margin: number) =>
  world.solidsIn(x - R - margin, z - R - margin, x + R + margin, z + R + margin);

/** Rien n'arrête le promeneur aux pieds (x, y, z), ni ne l'approche à moins de `margin` en plan. */
export function isFree(world: WalkWorld, x: number, y: number, z: number, margin = 0): boolean {
  return nearby(world, x, z, margin).every((box) => blockingRadius(box, x, y, z, margin) === 0);
}

/**
 * Hauteur sur laquelle se tiennent des pieds au niveau `y` : le terrain sous
 * le centre, ou le plus haut volume sous le centre qui ne dépasse pas `y` de
 * plus d'une marche.
 */
function supportHeight(world: WalkWorld, x: number, y: number, z: number, solids: Aabb[]): number {
  let floor = world.groundAt(x, z);
  for (const box of solids) {
    const top = box.max[1];
    if (top <= y + STEP_HEIGHT && top > floor && across(box, x, z, FOOT)) floor = top;
  }
  return floor;
}

/**
 * Déplace `position` de `delta` sur l'axe `axis` (0 = x, 2 = z), s'arrête
 * contre ce qui dépasse une marche — à la hauteur où l'on se tiendra là
 * (marche montée : la tête doit passer). Retourne false si bloqué.
 */
function moveAxis(world: WalkWorld, position: Vec3, axis: 0 | 2, delta: number, canStep: boolean): boolean {
  if (delta === 0) return true;
  const next: Vec3 = [position[0], position[1], position[2]];
  next[axis] += delta;
  const solids = nearby(world, next[0], next[2], 0);
  const stand = canStep ? Math.max(next[1], supportHeight(world, next[0], next[1], next[2], solids)) : next[1];
  let limit = next[axis];
  let blocked = false;
  for (const box of solids) {
    const r = blockingRadius(box, next[0], stand, next[2]);
    if (r === 0) continue;
    blocked = true;
    // Arrêt contre la face la plus proche dans le sens du mouvement.
    limit = delta > 0 ? Math.min(limit, box.min[axis] - r - SKIN) : Math.max(limit, box.max[axis] + r + SKIN);
  }
  if (!blocked) {
    position[axis] = next[axis];
    return true;
  }
  // Jamais de recul : déjà au contact (ou coincé), on reste sur place.
  position[axis] =
    delta > 0
      ? Math.max(position[axis], Math.min(limit, next[axis]))
      : Math.min(position[axis], Math.max(limit, next[axis]));
  return false;
}

function substep(world: WalkWorld, state: WalkerState, input: WalkInput, dt: number): WalkerState {
  const position: Vec3 = [...state.position];
  const velocity: Vec3 = [...state.velocity];
  let { grounded } = state;

  // Vitesse horizontale visée, dans le repère du regard.
  const length = Math.hypot(input.forward, input.strafe);
  const speed = (input.run ? RUN_SPEED : WALK_SPEED) / Math.max(1, length);
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const targetX = (-sin * input.forward + cos * input.strafe) * speed;
  const targetZ = (-cos * input.forward - sin * input.strafe) * speed;
  const response = Math.min(1, dt / SPEED_RESPONSE) * (grounded ? 1 : AIR_CONTROL);
  velocity[0] += (targetX - velocity[0]) * response;
  velocity[2] += (targetZ - velocity[2]) * response;

  if (input.jump && grounded) {
    velocity[1] = JUMP_SPEED;
    grounded = false;
  }

  if (!moveAxis(world, position, 0, velocity[0] * dt, grounded)) velocity[0] = 0;
  if (!moveAxis(world, position, 2, velocity[2] * dt, grounded)) velocity[2] = 0;

  // Bord du paysage : on ne sort pas du monde.
  const distance = Math.hypot(position[0], position[2]);
  if (distance > world.reach) {
    position[0] *= world.reach / distance;
    position[2] *= world.reach / distance;
  }

  // Vertical : gravité, plafond, sol.
  const before = position[1];
  velocity[1] -= GRAVITY * dt;
  position[1] += velocity[1] * dt;
  const solids = nearby(world, position[0], position[2], 0);
  if (velocity[1] > 0) {
    for (const box of solids) {
      if (box.min[1] >= before + H - SUPPORT_EPS && blockingRadius(box, position[0], position[1], position[2]) > 0) {
        position[1] = box.min[1] - H;
        velocity[1] = 0;
      }
    }
  }
  const floor = supportHeight(world, position[0], before, position[2], solids);
  if (position[1] <= floor) {
    position[1] = floor;
    velocity[1] = 0;
    grounded = true;
  } else if (grounded && velocity[1] <= 0 && before - floor <= STEP_HEIGHT) {
    // Descente (pente, marche) : on reste collé au sol au lieu de rebondir.
    position[1] = floor;
    velocity[1] = 0;
  } else {
    grounded = false;
  }

  return { position, velocity, grounded };
}

/** Avance le promeneur de `dt` secondes (découpées en pas de `MAX_SUBSTEP` au plus). */
export function stepWalker(world: WalkWorld, state: WalkerState, input: WalkInput, dt: number): WalkerState {
  const total = Math.min(Math.max(dt, 0), MAX_FRAME);
  const count = Math.ceil(total / MAX_SUBSTEP);
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = substep(world, next, input, total / count);
    // Un saut ne part qu'une fois, au premier pas où il est possible.
    if (input.jump && !next.grounded) input = { ...input, jump: false };
  }
  return next;
}

/** Dégagement visé autour du point d'apparition : on arrive dans une rue, pas le nez contre un mur. */
export const SPAWN_CLEARANCE = 0.5;

/**
 * Point d'apparition libre le plus proche de (x, z) : on tourne autour, par
 * anneaux carrés de `step`, jusqu'à trouver une place où le promeneur tient
 * debout sur le terrain, à `SPAWN_CLEARANCE` de tout volume — à défaut
 * (ruelles étroites partout), simplement libre ; à défaut encore (tout est
 * bâti), le point demandé.
 */
export function findSpawn(world: WalkWorld, x: number, z: number, step = 0.25, maxRings = 160): Vec3 {
  return (
    searchSpawn(world, x, z, step, maxRings, SPAWN_CLEARANCE) ??
    searchSpawn(world, x, z, step, maxRings, 0) ?? [x, world.groundAt(x, z), z]
  );
}

function searchSpawn(world: WalkWorld, x: number, z: number, step: number, maxRings: number, margin: number) {
  for (let ring = 0; ring <= maxRings; ring += 1) {
    // Les points de l'anneau, du plus proche au plus lointain (les coins en dernier).
    const offsets: [number, number][] = [];
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) offsets.push([i, j]);
      }
    }
    offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [i, j] of offsets) {
      const px = x + i * step;
      const pz = z + j * step;
      if (Math.hypot(px, pz) > world.reach) continue;
      const py = world.groundAt(px, pz);
      if (isFree(world, px, py, pz, margin)) return [px, py, pz] as Vec3;
    }
  }
  return null;
}

export function createWalker(position: Vec3): WalkerState {
  return { position: [...position], velocity: [0, 0, 0], grounded: true };
}

/** Espace libre voulu devant soi à l'arrivée (une case). */
const SPAWN_VIEW = 1;

/**
 * Cap d'arrivée depuis `position` : sur 16 directions, celle la plus proche
 * de `preferredYaw` qui laisse au moins `SPAWN_VIEW` de libre devant soi
 * (ou le plus de place possible, si aucune) — on arrive face à la rue ou au
 * village, pas le nez contre un mur.
 */
export function clearHeading(world: WalkWorld, position: Vec3, preferredYaw: number): number {
  const [x, y, z] = position;
  const headings = Array.from({ length: 16 }, (_, i) => {
    const yaw = preferredYaw + (i * Math.PI) / 8;
    let free = 0;
    while (free < SPAWN_VIEW) {
      const next = free + 0.1;
      if (!isFree(world, x - Math.sin(yaw) * next, y, z - Math.cos(yaw) * next)) break;
      free = next;
    }
    return { yaw, free };
  });
  const needed = Math.min(SPAWN_VIEW, Math.max(...headings.map((h) => h.free))) - 1e-9;
  let best = headings[0];
  for (const heading of headings) {
    if (heading.free < needed) continue;
    if (best.free < needed || Math.cos(heading.yaw - preferredYaw) > Math.cos(best.yaw - preferredYaw)) best = heading;
  }
  return best.yaw;
}

/** Temps de réponse de la hauteur des yeux (s) : une marche montée ou descendue est amortie. */
const EYE_RESPONSE = 0.08;

/**
 * Hauteur des yeux affichée : au sol, elle rejoint `target` en douceur (une
 * marche d'escalier, ~17 cm d'un coup, faisait sauter l'image) ; en l'air,
 * ou pour un écart plus grand qu'une marche (réapparition), elle le suit
 * exactement — un saut ou une chute ne doivent pas traîner.
 */
export function easeEye(shown: number | null, target: number, grounded: boolean, dt: number): number {
  if (shown === null || !grounded || Math.abs(target - shown) > STEP_HEIGHT * 1.5) return target;
  return target + (shown - target) * Math.exp(-Math.max(dt, 0) / EYE_RESPONSE);
}
