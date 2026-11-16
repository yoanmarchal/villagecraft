/**
 * Polygones du plan horizontal (x, z) : trémies d'escalier, emprises au sol
 * des escaliers et des meubles, contour intérieur des coques. Polygones
 * simples (convexes ou non), sommets dans l'ordre, sans répéter le premier.
 */

export type Point = [number, number];
export type Polygon = Point[];

/** Aire signée (positive si les sommets tournent de +x vers +z). */
export function signedArea(polygon: Polygon): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    area += x0 * z1 - x1 * z0;
  }
  return area / 2;
}

/** Point strictement à l'intérieur (règle pair-impair ; un point sur le bord est indéterminé). */
export function pointInPolygon([x, z]: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Paramètre t (sur a→b) et u (sur c→d) de l'intersection propre des deux segments, ou null. */
function crossing(a: Point, b: Point, c: Point, d: Point): { t: number; u: number } | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-12) return null; // parallèles
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / denominator;
  const u = (qx * rz - qz * rx) / denominator;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? { t, u } : null;
}

/**
 * Les deux polygones se chevauchent : deux bords se croisent, ou l'un a un
 * sommet dans l'autre. Deux polygones qui se touchent seulement par un bord
 * ne se chevauchent pas forcément — garder une marge (`offsetRect`).
 */
export function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (crossing(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a)) || centroidInside(a, b);
}

/** Deux polygones superposés exactement (mêmes sommets) : aucun croisement ni sommet strictement dedans. */
function centroidInside(a: Polygon, b: Polygon): boolean {
  const cx = a.reduce((sum, [x]) => sum + x, 0) / a.length;
  const cz = a.reduce((sum, [, z]) => sum + z, 0) / a.length;
  return pointInPolygon([cx, cz], a) && pointInPolygon([cx, cz], b);
}

/** `inner` est entièrement dans `outer` (sommets dedans, aucun bord qui en sorte). */
export function polygonInside(inner: Polygon, outer: Polygon): boolean {
  if (!inner.every((p) => pointInPolygon(p, outer))) return false;
  for (let i = 0; i < inner.length; i += 1) {
    for (let j = 0; j < outer.length; j += 1) {
      if (crossing(inner[i], inner[(i + 1) % inner.length], outer[j], outer[(j + 1) % outer.length])) return false;
    }
  }
  return true;
}

/**
 * Portions (paramètre t de a→b, entre 0 et 1) du segment qui sont à
 * l'intérieur du polygone, triées et fusionnées.
 */
export function insideIntervals(a: Point, b: Point, polygon: Polygon): Array<[number, number]> {
  const cuts = [0, 1];
  for (let i = 0; i < polygon.length; i += 1) {
    const hit = crossing(a, b, polygon[i], polygon[(i + 1) % polygon.length]);
    if (hit) cuts.push(hit.t);
    // Sommet du polygone posé sur le segment : aussi une coupure possible.
    const [px, pz] = polygon[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length2 = dx * dx + dz * dz;
    if (length2 > 0) {
      const t = ((px - a[0]) * dx + (pz - a[1]) * dz) / length2;
      const ex = a[0] + t * dx - px;
      const ez = a[1] + t * dz - pz;
      if (t > 0 && t < 1 && ex * ex + ez * ez < 1e-12) cuts.push(t);
    }
  }
  cuts.sort((p, q) => p - q);

  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const [t0, t1] = [cuts[i], cuts[i + 1]];
    if (t1 - t0 < 1e-9) continue;
    const mid = (t0 + t1) / 2;
    if (!pointInPolygon([a[0] + mid * (b[0] - a[0]), a[1] + mid * (b[1] - a[1])], polygon)) continue;
    const last = intervals[intervals.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else intervals.push([t0, t1]);
  }
  return intervals;
}

/**
 * Portions du segment a→b hors de tous les polygones, en coordonnées le long
 * du segment (de 0 à sa longueur). `pad` élargit chaque portion intérieure
 * de part et d'autre (demi-largeur d'une poutre qui croise un bord en biais).
 */
export function outsideSpans(a: Point, b: Point, polygons: Polygon[], pad = 0): Array<[number, number]> {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const blocked = polygons
    .flatMap((polygon) => insideIntervals(a, b, polygon))
    .map(([t0, t1]): [number, number] => [t0 * length - pad, t1 * length + pad])
    .sort((p, q) => p[0] - q[0]);
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s0, s1] of blocked) {
    if (s0 > cursor) spans.push([cursor, Math.min(s0, length)]);
    cursor = Math.max(cursor, s1);
  }
  if (cursor < length) spans.push([cursor, length]);
  return spans.filter(([s0, s1]) => s1 - s0 > 1e-6);
}

/**
 * Portions d'une poutre de demi-largeur `halfWidth`, d'axe a→b, hors de tous
 * les polygones : ni son axe ni ses deux rives n'y entrent.
 */
export function outsideSpansOfBeam(
  a: Point,
  b: Point,
  halfWidth: number,
  polygons: Polygon[],
): Array<[number, number]> {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length === 0) return [];
  // Normale à l'axe, pour les deux rives.
  const nx = (-(b[1] - a[1]) / length) * halfWidth;
  const nz = ((b[0] - a[0]) / length) * halfWidth;
  const blocked: Array<[number, number]> = [];
  for (const side of [0, 1, -1]) {
    const a2: Point = [a[0] + side * nx, a[1] + side * nz];
    const b2: Point = [b[0] + side * nx, b[1] + side * nz];
    for (const polygon of polygons) {
      for (const [t0, t1] of insideIntervals(a2, b2, polygon)) blocked.push([t0 * length, t1 * length]);
    }
  }
  blocked.sort((p, q) => p[0] - q[0]);
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s0, s1] of blocked) {
    if (s0 > cursor) spans.push([cursor, Math.min(s0, length)]);
    cursor = Math.max(cursor, s1);
  }
  if (cursor < length) spans.push([cursor, length]);
  return spans.filter(([s0, s1]) => s1 - s0 > 1e-6);
}

/** Rectangle aligné sur les axes, [x0, x1] × [z0, z1]. */
export function rect(x0: number, z0: number, x1: number, z1: number): Polygon {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/**
 * Polygone déplacé de `distance` vers l'extérieur le long de la normale de
 * chaque bord (sommets à l'intersection des bords décalés). Pour des
 * polygones aux angles pas trop aigus : trémies, emprises.
 */
export function offsetPolygon(polygon: Polygon, distance: number): Polygon {
  const sign = signedArea(polygon) > 0 ? 1 : -1;
  const n = polygon.length;
  const normals = polygon.map(([x0, z0], i) => {
    const [x1, z1] = polygon[(i + 1) % n];
    const length = Math.hypot(x1 - x0, z1 - z0) || 1;
    // Normale extérieure : à droite du bord si le polygone tourne dans le sens positif.
    return [(sign * (z1 - z0)) / length, (sign * -(x1 - x0)) / length] as Point;
  });
  return polygon.map(([x, z], i) => {
    const [ax, az] = normals[(i - 1 + n) % n];
    const [bx, bz] = normals[i];
    const dot = ax * bx + az * bz;
    const scale = distance / Math.max(0.2, 1 + dot);
    return [x + (ax + bx) * scale, z + (az + bz) * scale];
  });
}
