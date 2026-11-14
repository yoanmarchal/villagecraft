/**
 * Forme du terrain d'un village : ce qui, avec les blocs, fait un village
 * (sauvegardé, partagé, annulable) — pas un réglage d'affichage.
 *
 * - `seed` : graine des ondulations (relief.ts). Tirée au hasard à chaque
 *   génération ; 0 = le terrain d'origine (villages d'avant les graines).
 * - `sculpt` : modelage à la main, en crans par case de la grille (outils
 *   « relever » / « creuser »). Une case relevée soulève une bosse douce qui
 *   déborde sur ses voisines (relief.ts) ; seules les cases non nulles sont
 *   stockées, triées (z, puis x) pour que deux formes égales s'écrivent pareil.
 *
 * Valeurs immuables : toute modification rend un nouvel objet (ou le même si
 * rien ne change), ce dont se servent l'historique et les mémos de la scène.
 */

export type SculptEntry = readonly [x: number, z: number, steps: number];

export interface TerrainShape {
  readonly seed: number;
  readonly sculpt: readonly SculptEntry[];
}

/** Terrain d'origine, sans modelage. */
export const DEFAULT_TERRAIN: TerrainShape = { seed: 0, sculpt: [] };

/** Crans de modelage au plus, en relevé comme en creux, par case. */
export const SCULPT_MAX_STEPS = 8;

const bySlot = (a: SculptEntry, b: SculptEntry) => a[1] - b[1] || a[0] - b[0];

/** Graine de terrain à partir d'un entier quelconque : entier 32 bits non nul (0 = terrain d'origine). */
export function terrainSeed(value: number): number {
  return (value >>> 0) % 0xffffffff || 1;
}

/** Relève (`delta` > 0) ou creuse (`delta` < 0) la case (x, z). Rend `shape` tel quel si la case est déjà à sa borne. */
export function sculptTerrain(shape: TerrainShape, x: number, z: number, delta: number): TerrainShape {
  const current = shape.sculpt.find((entry) => entry[0] === x && entry[1] === z)?.[2] ?? 0;
  const steps = Math.max(-SCULPT_MAX_STEPS, Math.min(SCULPT_MAX_STEPS, current + delta));
  if (steps === current) return shape;
  const sculpt = shape.sculpt.filter((entry) => entry[0] !== x || entry[1] !== z);
  if (steps !== 0) sculpt.push([x, z, steps]);
  return { seed: shape.seed, sculpt: sculpt.sort(bySlot) };
}

/** Modelage décalé de (offsetX, offsetZ) dans une grille de côté `size` (redimensionnement) ; ce qui déborde est omis. */
export function shiftTerrain(shape: TerrainShape, offsetX: number, offsetZ: number, size: number): TerrainShape {
  const sculpt = shape.sculpt
    .map(([x, z, steps]): SculptEntry => [x + offsetX, z + offsetZ, steps])
    .filter(([x, z]) => x >= 0 && z >= 0 && x < size && z < size);
  return { seed: shape.seed, sculpt };
}

export function terrainEquals(a: TerrainShape, b: TerrainShape): boolean {
  return (
    a === b ||
    (a.seed === b.seed &&
      a.sculpt.length === b.sculpt.length &&
      a.sculpt.every(([x, z, steps], i) => x === b.sculpt[i][0] && z === b.sculpt[i][1] && steps === b.sculpt[i][2]))
  );
}

/** Forme lue d'une sauvegarde ou d'un lien : tout ce qui est invalide est écarté plutôt que refusé. */
export function parseTerrain(value: unknown, gridSize: number): TerrainShape {
  if (typeof value !== 'object' || value === null) return DEFAULT_TERRAIN;
  const { seed, sculpt } = value as { seed?: unknown; sculpt?: unknown };
  const slots = new Map<string, SculptEntry>();
  if (Array.isArray(sculpt)) {
    for (const entry of sculpt as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(Number.isInteger)) continue;
      const [x, z, steps] = entry as [number, number, number];
      if (x < 0 || z < 0 || x >= gridSize || z >= gridSize || steps === 0) continue;
      slots.set(`${x},${z}`, [x, z, Math.max(-SCULPT_MAX_STEPS, Math.min(SCULPT_MAX_STEPS, steps))]);
    }
  }
  return {
    seed: typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : 0,
    sculpt: [...slots.values()].sort(bySlot),
  };
}
