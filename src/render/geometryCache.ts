/**
 * Cache global de géométries partagées.
 *
 * Toutes les géométries du village passent par ici : chaque combinaison de
 * paramètres n'est construite qu'UNE seule fois puis réutilisée par tous les
 * parts qui en ont besoin (le merge clone les attributs, jamais la géométrie).
 *
 * Toutes les géométries sont :
 *  - non-indexées (mergeables trivialement entre elles),
 *  - centrées sur l'origine,
 *  - munies de position + normal (les matériaux n'utilisent pas de texture).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import type { CornerRadii } from '../utils/cellUtils';
import { getRoundedRectContourPoints } from '../utils/cellUtils';

/**
 * Borne du cache (LRU). Un village complet n'utilise que quelques centaines
 * de géométries, mais chaque cran d'un slider de forme (rayons, flèche…) en
 * crée de nouvelles : sans borne, le cache grossit indéfiniment pendant qu'on
 * les manipule. Les géométries du cache ne sont jamais rendues directement
 * (le merge copie leurs attributs), donc pas de ressource GPU à libérer :
 * les oublier suffit.
 */
const MAX_CACHED_GEOMETRIES = 1500;

// Map = ordre d'insertion : la première clé est la moins récemment utilisée.
const cache = new Map<string, THREE.BufferGeometry>();

function getGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = cache.get(key);
  if (geo) {
    cache.delete(key);
  } else {
    geo = build();
    if (geo.index) geo = geo.toNonIndexed();
  }
  cache.set(key, geo);

  if (cache.size > MAX_CACHED_GEOMETRIES) {
    cache.delete(cache.keys().next().value!);
  }
  return geo;
}

/** Nombre de géométries en cache (tests / debug). */
export function geometryCacheSize(): number {
  return cache.size;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ── Primitives ───────────────────────────────────────────────────────────────

export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  return getGeo(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

/**
 * Budget de détail des arrondis. Un RoundedBoxGeometry coûte 6·6·(2s+1)²
 * sommets (non indexé) : 324 à s=1, 900 à s=2, 2 916 à s=4, 6 084 à s=6.
 * Toutes les petites pièces du village (pierres, quoins, cadres, portes…)
 * ont des rayons de l'ordre du centimètre, soit moins d'un pixel à distance
 * de vue : au-delà d'un segment (simple chanfrein aux normales lissées) le
 * surcoût est invisible — il représentait ~94 % des sommets du village.
 */
function roundedBoxSegments(radius: number, requested: number): number {
  if (radius <= 0.015) return 1;
  return Math.min(requested, 2);
}

export function roundedBoxGeo(w: number, h: number, d: number, radius: number, smoothness = 2): THREE.BufferGeometry {
  const segments = roundedBoxSegments(radius, smoothness);
  return getGeo(
    `rbox|${w}|${h}|${d}|${r3(radius)}|${segments}`,
    () => new RoundedBoxGeometry(w, h, d, segments, radius),
  );
}

export function cylinderGeo(rTop: number, rBottom: number, h: number, segments: number): THREE.BufferGeometry {
  return getGeo(`cyl|${rTop}|${rBottom}|${h}|${segments}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments));
}

export function sphereGeo(r: number, ws = 12, hs = 12): THREE.BufferGeometry {
  return getGeo(`sph|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

export function torusArcGeo(r: number, tube: number, radialSegs: number, tubularSegs: number, arc: number): THREE.BufferGeometry {
  return getGeo(
    `torus|${r}|${tube}|${radialSegs}|${tubularSegs}|${r3(arc)}`,
    () => new THREE.TorusGeometry(r, tube, radialSegs, tubularSegs, arc),
  );
}

// ── Corps de cellule : contour "carré à coins arrondis" extrudé ──────────────

const radiiKey = (radii: CornerRadii) =>
  `${r3(radii.backLeft)},${r3(radii.backRight)},${r3(radii.frontLeft)},${r3(radii.frontRight)}`;

/**
 * Ex-ShapedBox : section XZ à radii par coin, extrudée sur Y et recentrée.
 * Coins exposés → arrondis (tour), coins joints → angle droit.
 */
export function shapedBoxGeo(w: number, h: number, d: number, radii: CornerRadii): THREE.BufferGeometry {
  return getGeo(`shaped|${r3(w)}|${r3(h)}|${r3(d)}|${radiiKey(radii)}`, () => {
    const points = getRoundedRectContourPoints(w / 2, d / 2, radii);
    const shape = new THREE.Shape();
    points.forEach(([px, py], i) => (i === 0 ? shape.moveTo(px, py) : shape.lineTo(px, py)));
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    // Plan shape XY → scène XZ, extrusion Z → hauteur Y, recentrée.
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -h / 2, 0));
    geo.computeVertexNormals();
    return geo;
  });
}

// ── Cadre percé (fenêtres) : remplace le CSG runtime ─────────────────────────

function roundedRectShape<T extends THREE.Shape | THREE.Path>(target: T, w: number, h: number, r: number): T {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  target.moveTo(-hw + rr, -hh);
  target.lineTo(hw - rr, -hh);
  target.absarc(hw - rr, -hh + rr, rr, -Math.PI / 2, 0, false);
  target.lineTo(hw, hh - rr);
  target.absarc(hw - rr, hh - rr, rr, 0, Math.PI / 2, false);
  target.lineTo(-hw + rr, hh);
  target.absarc(-hw + rr, hh - rr, rr, Math.PI / 2, Math.PI, false);
  target.lineTo(-hw, -hh + rr);
  target.absarc(-hw + rr, -hh + rr, rr, Math.PI, Math.PI * 1.5, false);
  return target;
}

/**
 * Plaque rectangulaire arrondie percée d'une ouverture arrondie, extrudée sur
 * Z et centrée. Équivalent visuel du CSG Base−Subtraction utilisé avant pour
 * les cadres de fenêtres, pour une fraction du coût.
 */
export function frameWithHoleGeo(
  outerW: number, outerH: number, outerR: number,
  innerW: number, innerH: number, innerR: number,
  depth: number,
): THREE.BufferGeometry {
  const key = `frame|${outerW}|${outerH}|${r3(outerR)}|${innerW}|${innerH}|${r3(innerR)}|${depth}`;
  return getGeo(key, () => {
    const shape = roundedRectShape(new THREE.Shape(), outerW, outerH, outerR);
    shape.holes.push(roundedRectShape(new THREE.Path(), innerW, innerH, innerR));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -depth / 2));
    geo.computeVertexNormals();
    return geo;
  });
}

// ── Pignon de toit (prisme triangulaire) ─────────────────────────────────────

/**
 * Prisme triangulaire du pignon (ex-buildGableGeometry de RoofCell).
 * eaveY/ridgeY en espace local cellule.
 */
export function gableGeo(eaveY: number, ridgeY: number): THREE.BufferGeometry {
  return getGeo(`gable|${r3(eaveY)}|${r3(ridgeY)}`, () => {
    const hw = 0.525; // demi-largeur de base (léger débord)
    const hd = 0.035; // demi-épaisseur

    // Chaque face a ses propres copies de sommets pour des arêtes nettes.
    const pos = new Float32Array([
      // Face avant (z = +hd)
      -hw, eaveY, hd, hw, eaveY, hd, 0, ridgeY, hd,
      // Face arrière (z = -hd)
      hw, eaveY, -hd, -hw, eaveY, -hd, 0, ridgeY, -hd,
      // Dessous
      -hw, eaveY, hd, -hw, eaveY, -hd, hw, eaveY, -hd, hw, eaveY, hd,
      // Pan gauche
      -hw, eaveY, hd, 0, ridgeY, hd, 0, ridgeY, -hd, -hw, eaveY, -hd,
      // Pan droit
      hw, eaveY, hd, hw, eaveY, -hd, 0, ridgeY, -hd, 0, ridgeY, hd,
    ]);

    const idx = new Uint16Array([
      0, 1, 2,
      3, 4, 5,
      6, 7, 8, 6, 8, 9,
      10, 11, 12, 10, 12, 13,
      14, 15, 16, 14, 16, 17,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  });
}
