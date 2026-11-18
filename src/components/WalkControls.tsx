/**
 * Mode promenade : la caméra devient les yeux d'un promeneur (vue à la
 * première personne). Monté par VoxelScene à la place des contrôles
 * d'orbite — OrbitControls reste monté mais désactivé, il garde son point
 * visé pour le retour.
 *
 * Souris : pointer lock (le regard suit la souris, le curseur disparaît) ;
 * Échap le relâche (le navigateur l'impose) et met la promenade en pause ;
 * Échap une seconde fois, ou le bouton, ramène à l'orbite. Clavier : voir
 * walkInput.ts. La physique (walker.ts) est pure ; ce composant ne fait que
 * relier entrées, pas de temps et caméra.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useUiStore } from '../store/uiStore';
import { useControlStore } from '../store/controlStore';
import { EYE_HEIGHT, MAX_PITCH } from '../walk/walkConfig';
import { inputFromKeys, WALK_KEYS } from '../walk/walkInput';
import { clearHeading, createWalker, easeEye, findSpawn, isFree, stepWalker, type WalkerState } from '../walk/walker';
import type { WalkWorld } from '../walk/walkWorld';
import { walkerPresence } from '../walk/walkerPresence';

/** Radians par pixel de souris, à la sensibilité 1 (réglage `walkMouseSensitivity`). */
const MOUSE_SENSITIVITY = 0.0022;
/** Plan proche : les murs des coques font quelques centimètres, la caméra doit pouvoir s'en approcher. */
const WALK_NEAR = 0.02;

interface SavedView {
  position: Vector3;
  quaternion: Quaternion;
  near: number;
  fov: number;
}

export function WalkControls({ world }: { world: WalkWorld }) {
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);

  const walker = useRef<WalkerState | null>(null);
  const look = useRef({ yaw: 0, pitch: 0 });
  const pressed = useRef(new Set<string>());
  const worldRef = useRef(world);

  // Le village peut changer pendant la promenade (annuler, API) : si le
  // promeneur se retrouve dans un mur, il réapparaît à la place libre la plus proche.
  useEffect(() => {
    worldRef.current = world;
    const state = walker.current;
    if (state && !isFree(world, ...state.position)) {
      walker.current = createWalker(findSpawn(world, state.position[0], state.position[2]));
      invalidate();
    }
  }, [world, invalidate]);

  // Entrée / sortie : caméra du promeneur, puis retour exact à la vue d'orbite.
  useEffect(() => {
    const { camera, controls } = get();
    const saved: SavedView = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      near: camera.near,
      fov: camera instanceof PerspectiveCamera ? camera.fov : 45,
    };

    // On part de la place libre la plus proche du point visé par l'orbite,
    // tourné vers lui (au bord du village : face aux maisons), ou dans la
    // direction où regardait la caméra si on y est — sauf mur juste devant.
    const target = (controls as unknown as { target?: Vector3 } | null)?.target ?? new Vector3();
    const spawn = findSpawn(worldRef.current, target.x, target.z);
    const toTarget = new Vector3(target.x - spawn[0], 0, target.z - spawn[2]);
    const direction = toTarget.length() > 0.5 ? toTarget : camera.getWorldDirection(new Vector3());
    const preferred = Math.atan2(-direction.x, -direction.z);
    look.current = { yaw: clearHeading(worldRef.current, spawn, preferred), pitch: 0 };
    walker.current = createWalker(spawn);

    camera.near = WALK_NEAR;
    if (camera instanceof PerspectiveCamera) camera.fov = useControlStore.getState().walkFov;
    camera.updateProjectionMatrix();
    invalidate();

    return () => {
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.near = saved.near;
      if (camera instanceof PerspectiveCamera) camera.fov = saved.fov;
      camera.updateProjectionMatrix();
      walkerPresence.feet = null;
      (controls as unknown as { update?: () => void } | null)?.update?.();
      invalidate();
    };
  }, [get, invalidate]);

  // Champ de vision réglé pendant la promenade (panneau).
  const walkFov = useControlStore((state) => state.walkFov);
  useEffect(() => {
    const { camera } = get();
    if (!(camera instanceof PerspectiveCamera) || camera.fov === walkFov) return;
    camera.fov = walkFov;
    camera.updateProjectionMatrix();
    invalidate();
  }, [get, invalidate, walkFov]);

  // Pointer lock, souris et clavier.
  useEffect(() => {
    const canvas = get().gl.domElement;
    const { setWalkLocked, setViewMode } = useUiStore.getState();
    const locked = () => document.pointerLockElement === canvas;
    const lock = () => {
      // Refusé sans geste utilisateur récent : le clic sur le canvas réessaie.
      Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    };

    const onLockChange = () => {
      setWalkLocked(locked());
      pressed.current.clear();
      invalidate();
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!locked()) return;
      const view = look.current;
      const { walkMouseSensitivity, walkInvertY } = useControlStore.getState();
      const turn = MOUSE_SENSITIVITY * walkMouseSensitivity;
      view.yaw -= event.movementX * turn;
      const lift = event.movementY * turn * (walkInvertY ? -1 : 1);
      view.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, view.pitch - lift));
      invalidate();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && !locked()) {
        setViewMode('orbit');
        return;
      }
      if (!locked() || !WALK_KEYS.has(event.code)) return;
      event.preventDefault();
      pressed.current.add(event.code);
      invalidate();
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.current.delete(event.code);
    const onBlur = () => pressed.current.clear();

    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', lock);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    lock();
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', lock);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (locked()) document.exitPointerLock();
      setWalkLocked(false);
    };
  }, [get, invalidate]);

  const euler = useRef(new Euler(0, 0, 0, 'YXZ'));
  const eye = useRef<number | null>(null);
  useFrame(({ camera }, delta) => {
    let state = walker.current;
    if (!state) return;
    const { yaw, pitch } = look.current;
    if (document.pointerLockElement === get().gl.domElement) {
      state = stepWalker(worldRef.current, state, inputFromKeys(pressed.current, yaw), delta);
      walker.current = state;
      // Rendu à la demande : tant que l'on se promène, chaque frame appelle la suivante.
      invalidate();
    }
    walkerPresence.feet = state.position;
    const [x, y, z] = state.position;
    eye.current = easeEye(eye.current, y + EYE_HEIGHT, state.grounded, delta);
    camera.position.set(x, eye.current, z);
    // Les yeux rejoignent encore leur hauteur (marche) : une frame de plus.
    if (Math.abs(eye.current - (y + EYE_HEIGHT)) > 1e-4) invalidate();
    camera.quaternion.setFromEuler(euler.current.set(pitch, yaw, 0));
  });

  return null;
}
