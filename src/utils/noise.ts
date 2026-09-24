/**
 * Aléatoire déterministe pour la génération procédurale : même graine →
 * même village (reproductible, testable).
 */

/** PRNG mulberry32 : rapide, 32 bits, largement suffisant ici. Retourne des valeurs dans [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Valeur pseudo-aléatoire stable dans [0, 1) pour un point entier du réseau. */
function latticeValue(seed: number, x: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Bruit de valeur 2D lissé, sommé sur deux octaves (fBm). Retourne une
 * fonction (x, z) → [0, 1] continue : des cellules voisines ont des valeurs
 * proches, ce qui forme des îlots plutôt qu'un semis aléatoire.
 */
export function createValueNoise(seed: number): (x: number, z: number) => number {
  const octave = (x: number, z: number, octaveSeed: number) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = smoothstep(x - x0);
    const tz = smoothstep(z - z0);
    const a = latticeValue(octaveSeed, x0, z0);
    const b = latticeValue(octaveSeed, x0 + 1, z0);
    const c = latticeValue(octaveSeed, x0, z0 + 1);
    const d = latticeValue(octaveSeed, x0 + 1, z0 + 1);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  };

  return (x, z) => (octave(x, z, seed) * 2 + octave(x * 2, z * 2, seed + 1)) / 3;
}
