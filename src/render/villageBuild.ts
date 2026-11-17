/**
 * Construction du village hors du thread principal.
 *
 * `VillageBuildClient` envoie la grille à un Web Worker (villageWorker.ts) qui
 * tient un `VillageChunkCache` : l'interface ne fige plus pendant un clic ou
 * une génération. Le worker ne renvoie que les chunks refusionnés, leurs
 * tableaux transférés sans copie ; les chunks inchangés gardent leur
 * géométrie côté page (même objet : rien à recharger sur le GPU).
 *
 * Une seule construction à la fois : pendant qu'elle tourne, seule la
 * dernière demande est gardée. Le résultat est livré avec la demande qu'il
 * construit : la scène y aligne sol et arbres, pour que terrain et village
 * changent dans la même image (voir VoxelScene). Les blocs qui devaient
 * encore apparaître sont recalés sur l'heure de livraison : leur animation
 * ne se joue pas pendant l'attente, sans rien à l'écran. Chaque réponse est appliquée dans l'ordre (les
 * chunks « repris » se réfèrent à la réponse précédente). Sans `Worker`
 * (tests, vieux navigateurs), le même cache tourne sur place.
 */

import * as THREE from 'three';
import type { GridCell } from '../types';
import type { MaterialSpec } from './parts';
import type { Relief } from './relief';
import type { RenderSettings } from './renderSettings';
import { VillageChunkCache, type MergedGroup } from './buildVillage';

type Vec3 = [number, number, number];

/** Repère monde de la grille : affine, transmis comme origine + trois vecteurs de base. */
export interface WorldMapping {
  origin: Vec3;
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
}

export interface BuildRequest {
  cells: GridCell[];
  settings: RenderSettings;
  width: number;
  depth: number;
  relief: Relief;
  mapping: WorldMapping;
}

/** Attributs d'un groupe fusionné (format de mergeParts), transférables. */
interface GroupArrays {
  index: Uint16Array | Uint32Array;
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  aCell: Int16Array;
  aSpawn: Float32Array;
}

/** Message page → worker. Le relief n'est envoyé que s'il a changé (le worker garde le même objet : son cache en dépend). */
export interface WorkerRequest {
  id: number;
  cells: GridCell[];
  settings: RenderSettings;
  width: number;
  depth: number;
  relief?: Relief;
  mapping: WorldMapping;
}

/** Message worker → page : chaque chunk, repris (`arrays` absent) ou refusionné. */
export interface WorkerResponse {
  id: number;
  groups: Array<{ key: string; mat: MaterialSpec; arrays?: GroupArrays }>;
}

/** Échantillonne le repère monde d'une grille (fonction affine) en données transmissibles. */
export function sampleMapping(toWorld: (x: number, y: number, z: number) => Vec3): WorldMapping {
  const origin = toWorld(0, 0, 0);
  const minus = (v: Vec3): Vec3 => [v[0] - origin[0], v[1] - origin[1], v[2] - origin[2]];
  return { origin, ex: minus(toWorld(1, 0, 0)), ey: minus(toWorld(0, 1, 0)), ez: minus(toWorld(0, 0, 1)) };
}

export function mappingFunction({ origin, ex, ey, ez }: WorldMapping) {
  return (x: number, y: number, z: number): Vec3 => [
    origin[0] + x * ex[0] + y * ey[0] + z * ez[0],
    origin[1] + x * ex[1] + y * ey[1] + z * ez[1],
    origin[2] + x * ex[2] + y * ey[2] + z * ez[2],
  ];
}

/** Côté worker : tableaux d'un groupe fusionné, et la liste à transférer. */
export function groupArrays(geometry: THREE.BufferGeometry): { arrays: GroupArrays; transfer: ArrayBuffer[] } {
  const get = (name: string) => (geometry.getAttribute(name) as THREE.BufferAttribute).array;
  const arrays: GroupArrays = {
    index: geometry.index!.array as Uint16Array | Uint32Array,
    position: get('position') as Float32Array,
    normal: get('normal') as Int8Array,
    color: get('color') as Uint8Array,
    aCell: get('aCell') as Int16Array,
    aSpawn: get('aSpawn') as Float32Array,
  };
  const { index, position, normal, color, aCell, aSpawn } = arrays;
  const transfer = [index, position, normal, color, aCell, aSpawn].map((a) => a.buffer as ArrayBuffer);
  return { arrays, transfer };
}

/** Côté page : géométrie d'un groupe fusionné, mêmes attributs que mergeParts. */
export function groupGeometry(arrays: GroupArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(arrays.index, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.color, 3, true));
  geometry.setAttribute('aCell', new THREE.BufferAttribute(arrays.aCell, 4));
  geometry.setAttribute('aSpawn', new THREE.BufferAttribute(arrays.aSpawn, 1));
  return geometry;
}

/**
 * Côté worker (ou sur place) : un `VillageChunkCache` et le relief reçu, gardé
 * tel quel tant qu'il ne change pas. Renvoie la réponse et ce qu'elle transfère.
 */
export class VillageBuildHost {
  private cache = new VillageChunkCache();
  private relief: Relief | null = null;
  private sent = new WeakSet<THREE.BufferGeometry>();

  handle(request: WorkerRequest, transfer: boolean): { response: WorkerResponse; transfer: ArrayBuffer[] } {
    if (request.relief) this.relief = request.relief;
    const groups = this.cache.build(request.cells, mappingFunction(request.mapping), request.settings, {
      width: request.width,
      depth: request.depth,
      relief: this.relief ?? undefined,
    });
    const buffers: ArrayBuffer[] = [];
    const response: WorkerResponse = {
      id: request.id,
      groups: groups.map(({ key, mat, geometry }) => {
        // Déjà envoyé : la page a cette géométrie (ses tableaux ont même pu être transférés).
        if (this.sent.has(geometry)) return { key, mat };
        this.sent.add(geometry);
        const { arrays, transfer: list } = groupArrays(geometry);
        if (transfer) buffers.push(...list);
        return { key, mat, arrays };
      }),
    };
    return { response, transfer: buffers };
  }
}

/**
 * Durée au-delà de laquelle un bloc a fini d'apparaître (≥ POP_DURATION de
 * growMaterial.ts, pas importé ici : ce module tourne aussi dans le worker).
 */
const SPAWN_SETTLED = 1;

/**
 * Décale de `delay` les horodatages d'apparition encore « en cours » à
 * l'envoi de la demande (`sentAt`) ; renvoie le tableau tel quel s'il n'y en a pas.
 * Copie plutôt que modification : sans worker, le tableau est celui du cache.
 */
export function retimeSpawns(spawns: Float32Array, sentAt: number, delay: number): Float32Array {
  const from = sentAt - SPAWN_SETTLED;
  if (delay <= 0 || !spawns.some((t) => t > from)) return spawns;
  return spawns.map((t) => (t > from ? t + delay : t));
}

/** Demande livrée : celle que reflètent les groupes, et le retard de livraison (s). */
export interface BuildDelivery {
  request: BuildRequest;
  delay: number;
}

/** Côté page : envoie les demandes (une à la fois, la plus récente) et reconstruit les groupes. */
export class VillageBuildClient {
  private worker: Worker | null = null;
  private local: VillageBuildHost | null = null;
  private nextId = 1;
  private busy = false;
  private pending: BuildRequest | null = null;
  private inflight: { request: BuildRequest; sentAt: number } | null = null;
  private sentRelief: Relief | null = null;
  private geometries = new Map<string, THREE.BufferGeometry>();

  constructor(private onResult: (groups: MergedGroup[], delivery: BuildDelivery) => void) {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./villageWorker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.receive(event.data));
    } else {
      this.local = new VillageBuildHost();
    }
  }

  /** Aucune construction en cours ni en attente. */
  get idle(): boolean {
    return !this.busy && this.pending === null;
  }

  request(request: BuildRequest): void {
    this.pending = request;
    if (!this.busy) this.flush();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }

  private flush(): void {
    const request = this.pending;
    if (!request) return;
    this.pending = null;
    this.busy = true;
    const message: WorkerRequest = {
      id: this.nextId++,
      // Copie à plat : les cellules de la grille restent la propriété de la page.
      cells: request.cells.map((cell) => ({ ...cell })),
      settings: request.settings,
      width: request.width,
      depth: request.depth,
      mapping: request.mapping,
      relief: request.relief !== this.sentRelief ? request.relief : undefined,
    };
    this.sentRelief = request.relief;
    // Même horloge que `cell.spawnedAt` (villageGrid.ts).
    this.inflight = { request, sentAt: performance.now() / 1000 };
    if (this.worker) {
      this.worker.postMessage(message);
    } else {
      // Sur place : même chemin que le worker, réponse différée comme lui.
      const { response } = this.local!.handle(message, false);
      queueMicrotask(() => this.receive(response));
    }
  }

  private receive(response: WorkerResponse): void {
    const { request, sentAt } = this.inflight!;
    const delay = performance.now() / 1000 - sentAt;
    const next = new Map<string, THREE.BufferGeometry>();
    const groups: MergedGroup[] = response.groups.map(({ key, mat, arrays }) => {
      const geometry = arrays
        ? groupGeometry({ ...arrays, aSpawn: retimeSpawns(arrays.aSpawn, sentAt, delay) })
        : this.geometries.get(key)!;
      next.set(key, geometry);
      return { key, mat, geometry };
    });
    this.geometries = next;
    this.busy = false;
    this.inflight = null;
    this.onResult(groups, { request, delay });
    this.flush();
  }
}
