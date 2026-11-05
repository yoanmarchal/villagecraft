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
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { CellFace, CornerRadii, HollowShape } from '../utils/cellUtils';
import { FACE_ROTATION_Y, getRoundedRectContourPoints } from '../utils/cellUtils';
import { seededRandom } from '../utils/noise';

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

// ── Coque creuse : bloc − volume intérieur − ouvertures (CSG) ────────────────

/** Épaisseur des murs d'un bloc creux. */
export const WALL_T = 0.08;
/**
 * Épaisseur du plancher et du plafond d'un bloc creux. Chaque bloc a les
 * deux, même sous un autre bloc creux (dalle de 2 × FLOOR_T entre étages) :
 * tous les plafonds d'un étage sont ainsi à la même hauteur. Un plafond
 * ouvert sous les étages et fermé sous les toits faisait un ressaut de
 * FLOOR_T, où pendaient les bords des toits adossés (égouts, pans) —
 * enfouis jusque-là dans les blocs pleins.
 */
export const FLOOR_T = 0.06;
/** Débord des volumes soustraits au-delà des faces, pour éviter les faces coplanaires en CSG. */
const CSG_EPS = 0.02;

export type OpeningKind = 'window' | 'door' | 'slit';

/** Ouverture traversante sur une face extérieure ; `scale` rétrécit sa largeur (coins arrondis). */
export interface OpeningSpec {
  face: CellFace;
  kind: OpeningKind;
  scale: number;
}

/**
 * Dimensions (largeur nominale, hauteur, centre Y) des ouvertures — les
 * mêmes que les vitres/vantaux des builders, qui viennent s'y loger. La
 * porte descend jusqu'au plancher.
 *
 * Les ouvertures sont percées à angles VIFS : un volume de découpe arrondi
 * (12 segments par coin) faisait exploser le découpage CSG — ~14 000 sommets
 * pour une coque à 4 fenêtres contre ~1 600 en rectangle. Côté rue, les coins
 * sont de toute façon couverts par le cadre arrondi.
 */
export const OPENING_SIZES: Record<OpeningKind, { w: number; h: number; y: number }> = {
  window: { w: 0.54, h: 0.44, y: 0 },
  door: { w: 0.40, h: 0.71, y: -0.095 },
  slit: { w: 0.08, h: 0.32, y: 0 },
};

type CornerName = 'backLeft' | 'backRight' | 'frontLeft' | 'frontRight';

/**
 * Section XZ (scène) du volume intérieur : rectangle borné à `0.5 − WALL_T`
 * côté mur, prolongé au-delà de la cellule côté `open`, avec coins arrondis
 * (rayon du mur − épaisseur) entre deux murs, ou entaillés d'un pilier
 * d'angle (coin rentrant). Parcours BR → FR → FL → BL.
 */
function innerSectionXZ(shape: HollowShape, radii: CornerRadii, openBound = 0.5 + CSG_EPS): Array<[number, number]> {
  const { sides, pillars } = shape;
  const bound = (face: CellFace) => (sides[face] === 'open' ? openBound : 0.5 - WALL_T);
  const xMax = bound('right');
  const xMin = -bound('left');
  const zMax = bound('front');
  const zMin = -bound('back');
  const inner = 0.5 - WALL_T;

  const corners: Array<{ name: CornerName; sx: 1 | -1; sz: 1 | -1; xSide: CellFace; zSide: CellFace; incomingX: boolean }> = [
    { name: 'backRight', sx: 1, sz: -1, xSide: 'right', zSide: 'back', incomingX: false },
    { name: 'frontRight', sx: 1, sz: 1, xSide: 'right', zSide: 'front', incomingX: true },
    { name: 'frontLeft', sx: -1, sz: 1, xSide: 'left', zSide: 'front', incomingX: false },
    { name: 'backLeft', sx: -1, sz: -1, xSide: 'left', zSide: 'back', incomingX: true },
  ];

  const points: Array<[number, number]> = [];
  for (const { name, sx, sz, xSide, zSide, incomingX } of corners) {
    const cx = sx > 0 ? xMax : xMin;
    const cz = sz > 0 ? zMax : zMin;
    const bothClosed = sides[xSide] !== 'open' && sides[zSide] !== 'open';
    const r = bothClosed ? Math.max(0, radii[name] - WALL_T) : 0;

    if (pillars[name]) {
      const px = sx * inner;
      const pz = sz * inner;
      points.push(...(incomingX
        ? [[cx, pz], [px, pz], [px, cz]] as Array<[number, number]>
        : [[px, cz], [px, pz], [cx, pz]] as Array<[number, number]>));
    } else if (r > 0.001) {
      // Arc du point tangent au côté X (direction (sx, 0)) au point tangent au côté Z (direction (0, sz)).
      const ox = cx - sx * r;
      const oz = cz - sz * r;
      const aX = sx > 0 ? 0 : Math.PI;
      const aZ = aX + (sx * sz > 0 ? Math.PI / 2 : -Math.PI / 2);
      const [a0, a1] = incomingX ? [aX, aZ] : [aZ, aX];
      const ARC_SEGS = 8;
      for (let i = 0; i <= ARC_SEGS; i += 1) {
        const a = a0 + ((a1 - a0) * i) / ARC_SEGS;
        points.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]);
      }
    } else {
      points.push([cx, cz]);
    }
  }
  return points;
}

/** Prisme vertical de section `sectionXZ` (coordonnées scène), de y0 à y1. */
function verticalPrism(sectionXZ: Array<[number, number]>, y0: number, y1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Plan de la shape XY → scène XZ avec z = −y (même convention que shapedBoxGeo).
  sectionXZ.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y0, 0));
  return geo;
}

/** Volume qui perce une ouverture de part en part dans le mur de la face `face`. */
function openingCutter({ face, kind, scale }: OpeningSpec): THREE.BufferGeometry {
  const { w, h, y } = OPENING_SIZES[kind];
  const z0 = 0.5 - WALL_T - CSG_EPS;
  const z1 = 0.5 + 0.06;
  const geo = new THREE.BoxGeometry(w * scale, h, z1 - z0);
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y, (z0 + z1) / 2));
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(FACE_ROTATION_Y[face]));
  return geo;
}

const csgEvaluator = new Evaluator();
csgEvaluator.attributes = ['position', 'normal'];
csgEvaluator.useGroups = false;

/** Brush CSG sur une COPIE des attributs : le CSG attache un BVH à sa géométrie, jamais à celle du cache. */
function toBrush(geo: THREE.BufferGeometry): Brush {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  g.setAttribute('normal', geo.getAttribute('normal').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const brush = new Brush(g);
  brush.updateMatrixWorld();
  return brush;
}

const openingKey = (o: OpeningSpec) => `${o.face[0]}${o.kind[0]}${r3(o.scale)}`;

/**
 * Coque maçonnée d'un bloc creux : le corps plein (`shapedBoxGeo`, même
 * contour qu'avant, pour que pierres et quoins restent alignés) moins le
 * volume intérieur (plancher et plafond `FLOOR_T`, murs `WALL_T`, ouvert
 * vers les voisins creux) moins les
 * ouvertures traversantes. CSG calculé une seule fois par combinaison.
 */
export function hollowShellGeo(radii: CornerRadii, shape: HollowShape, openings: OpeningSpec[]): THREE.BufferGeometry {
  const { sides, pillars } = shape;
  const sidesKey = (['front', 'back', 'left', 'right'] as const).map((f) => sides[f][0]).join('');
  const pillarsKey = (['backLeft', 'backRight', 'frontLeft', 'frontRight'] as const).map((c) => (pillars[c] ? 1 : 0)).join('');
  const openingsKey = openings.map(openingKey).sort().join(',');
  const key = `hollow|${radiiKey(radii)}|${sidesKey}|${pillarsKey}|${openingsKey}`;

  return getGeo(key, () => {
    const cutters = [verticalPrism(innerSectionXZ(shape, radii), -0.5 + FLOOR_T, 0.5 - FLOOR_T), ...openings.map(openingCutter)];
    let result = toBrush(shapedBoxGeo(1, 1, 1, radii));
    for (const cutter of cutters) {
      const next = csgEvaluator.evaluate(result, toBrush(cutter), SUBTRACTION);
      result.geometry.dispose();
      result = next;
      cutter.dispose();
    }

    const src = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', src.getAttribute('position'));
    out.setAttribute('normal', src.getAttribute('normal'));
    return out;
  });
}

/**
 * Nappe horizontale épousant l'intérieur d'une coque creuse (contour arrondi
 * des tours, piliers d'angle compris), arrêtée pile au bord de la cellule
 * côté `open` pour se raccorder sans chevauchement à celle du voisin.
 * Épaisseur `thickness`, de y = 0 à y = thickness. Sert au parquet et au
 * plafond des intérieurs.
 */
export function hollowSheetGeo(radii: CornerRadii, shape: HollowShape, thickness: number): THREE.BufferGeometry {
  const { sides, pillars } = shape;
  const sidesKey = (['front', 'back', 'left', 'right'] as const).map((f) => sides[f][0]).join('');
  const pillarsKey = (['backLeft', 'backRight', 'frontLeft', 'frontRight'] as const).map((c) => (pillars[c] ? 1 : 0)).join('');
  return getGeo(`sheet|${radiiKey(radii)}|${sidesKey}|${pillarsKey}|${r3(thickness)}`, () => {
    const geo = verticalPrism(innerSectionXZ(shape, radii, 0.5), 0, thickness);
    geo.computeVertexNormals();
    return geo;
  });
}

// ── Toiture de tour : surfaces entre anneaux homothétiques du contour ───────

/**
 * Contour de la tour dans le plan XZ, avec la même orientation que
 * `shapedBoxGeo` (plan XY de la shape → scène XZ, z = −y) pour que les coins
 * arrondis de la toiture tombent pile sur ceux du mur.
 */
function towerContourXZ(halfSize: number, radii: CornerRadii): Array<[number, number]> {
  return getRoundedRectContourPoints(halfSize, halfSize, radii).map(([x, y]) => [x, -y]);
}

/** Ajoute un triangle en l'orientant pour que sa face regarde du côté de `facing`. */
function pushTriangle(
  positions: number[],
  normals: number[],
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  vertexNormals: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  facing: THREE.Vector3,
): void {
  const [a, b, c] = vertices;
  const faceNormal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const order = faceNormal.dot(facing) >= 0 ? [0, 1, 2] : [0, 2, 1];
  for (const i of order) {
    positions.push(vertices[i].x, vertices[i].y, vertices[i].z);
    normals.push(vertexNormals[i].x, vertexNormals[i].y, vertexNormals[i].z);
  }
}

/**
 * Bande de toiture de tour : surface réglée entre deux anneaux du contour
 * de la tour, à l'échelle s0 (hauteur y0) et s1 (hauteur y1). s1 = 0 ferme
 * la bande en pointe. Empiler des bandes de pentes différentes donne un
 * profil à coyau (égout évasé puis cône raide), comme les toits de tours en
 * ardoise. Normales analytiques : lisses le long du contour, vives entre
 * deux bandes de pentes différentes (cassure du coyau).
 */
export function spireBandGeo(
  halfSize: number,
  radii: CornerRadii,
  y0: number,
  s0: number,
  y1: number,
  s1: number,
): THREE.BufferGeometry {
  const key = `spire|${r3(halfSize)}|${radiiKey(radii)}|${r3(y0)}|${r3(s0)}|${r3(y1)}|${r3(s1)}`;
  return getGeo(key, () => {
    const contour = towerContourXZ(halfSize, radii);
    const n = contour.length;

    const ring = (s: number, y: number) => contour.map(([x, z]) => new THREE.Vector3(x * s, y, z * s));
    const lower = ring(s0, y0);
    const upper = ring(s1, y1);

    // Normale par colonne : produit vectoriel de la tangente au contour et
    // de la génératrice (lower → upper), orientée vers l'extérieur.
    const columnNormals = contour.map(([x, z], j) => {
      const [xp, zp] = contour[(j - 1 + n) % n];
      const [xn, zn] = contour[(j + 1) % n];
      const tangent = new THREE.Vector3(xn - xp, 0, zn - zp);
      const generatrix = new THREE.Vector3(x * (s1 - s0), y1 - y0, z * (s1 - s0));
      const normal = new THREE.Vector3().crossVectors(tangent, generatrix).normalize();
      if (normal.x * x + normal.z * z < 0) normal.negate();
      return normal;
    });

    const positions: number[] = [];
    const normals: number[] = [];
    for (let j = 0; j < n; j += 1) {
      const k = (j + 1) % n;
      const facing = columnNormals[j].clone().add(columnNormals[k]);
      pushTriangle(positions, normals, [lower[j], lower[k], upper[k]], [columnNormals[j], columnNormals[k], columnNormals[k]], facing);
      pushTriangle(positions, normals, [lower[j], upper[k], upper[j]], [columnNormals[j], columnNormals[k], columnNormals[j]], facing);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  });
}

/** Disque plat du contour de la tour (échelle s, hauteur y), tourné vers le bas : dessous de l'avant-toit. */
export function towerSoffitGeo(halfSize: number, radii: CornerRadii, y: number, s: number): THREE.BufferGeometry {
  return getGeo(`soffit|${r3(halfSize)}|${radiiKey(radii)}|${r3(y)}|${r3(s)}`, () => {
    const contour = towerContourXZ(halfSize, radii).map(([x, z]) => new THREE.Vector3(x * s, y, z * s));
    const center = new THREE.Vector3(0, y, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const positions: number[] = [];
    const normals: number[] = [];
    contour.forEach((point, j) => {
      const next = contour[(j + 1) % contour.length];
      pushTriangle(positions, normals, [center, point, next], [down, down, down], down);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  });
}

// ── Arche : bloc maçonné évidé par un arc surbaissé ──────────────────────────

/**
 * Cercle de l'intrados d'un arc surbaissé de `span` cases, qui s'appuie sur
 * les bords bas de la rue (x = ±span/2, y = −0.5) et monte de `rise` en son
 * milieu. Coordonnées centrées sur le milieu de l'arche.
 */
function archCircle(rise: number, span: number): { centerY: number; radius: number; springAngle: number } {
  const halfSpan = span / 2;
  const radius = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  const centerY = -0.5 + rise - radius;
  const springAngle = Math.atan2(-0.5 - centerY, halfSpan); // angle du point d'appui droit
  return { centerY, radius, springAngle };
}

const ARC_SEGMENTS_PER_CELL = 24;

/**
 * Corps de l'arche, tranche n° `slice` (0 = côté x négatif) d'une arche de
 * `span` cases : la cellule entière en maçonnerie, dont le dessous est
 * creusé par l'arc (intrados) — comme un pont ou une porte de ville, et non
 * un portique sur piliers. Profil dans le plan XY (portée selon X), extrudé
 * sur Z (sens du passage), centré sur la cellule.
 */
export function archBodyGeo(rise: number, span = 1, slice = 0): THREE.BufferGeometry {
  return getGeo(`archBody|${r3(rise)}|${span}|${slice}`, () => {
    const { centerY, radius } = archCircle(rise, span);
    const x0 = -span / 2 + slice;
    const x1 = x0 + 1;
    const offset = x0 + 0.5; // centre de la tranche dans le repère de l'arche
    const intrados = (x: number) => Math.max(-0.5, centerY + Math.sqrt(Math.max(0, radius * radius - x * x)));

    const shape = new THREE.Shape();
    shape.moveTo(x1 - offset, intrados(x1));
    shape.lineTo(x1 - offset, 0.5);
    shape.lineTo(x0 - offset, 0.5);
    shape.lineTo(x0 - offset, intrados(x0));
    for (let i = 1; i < ARC_SEGMENTS_PER_CELL; i += 1) {
      const x = x0 + i / ARC_SEGMENTS_PER_CELL;
      shape.lineTo(x - offset, intrados(x));
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -0.5));
    geo.computeVertexNormals();
    return geo;
  });
}

/** Angle (radians, 0 = +X) du milieu du claveau n° `index` sur `count`. */
function archVoussoirMidAngle(rise: number, span: number, index: number, count: number): number {
  const { springAngle } = archCircle(rise, span);
  return springAngle + ((Math.PI - 2 * springAngle) * (index + 0.5)) / count;
}

/** Abscisse (repère centré sur l'arche) du milieu du claveau n° `index` — sert à le rattacher à une case. */
export function archVoussoirMidX(rise: number, span: number, index: number, count: number): number {
  const { radius } = archCircle(rise, span);
  return Math.cos(archVoussoirMidAngle(rise, span, index, count)) * radius;
}

/**
 * Claveau n° `index` (sur `count`) d'une arche de `span` cases : secteur de
 * couronne autour de l'intrados, d'épaisseur `depth` selon Z, centré en
 * z = 0, dans le repère centré sur l'arche. Un petit jour angulaire sépare
 * les claveaux ; `extraHeight` allonge la clé de voûte.
 */
export function archVoussoirGeo(
  rise: number,
  index: number,
  count: number,
  ringWidth: number,
  depth: number,
  extraHeight = 0,
  span = 1,
): THREE.BufferGeometry {
  const key = `voussoir|${r3(rise)}|${index}|${count}|${r3(ringWidth)}|${r3(depth)}|${r3(extraHeight)}|${span}`;
  return getGeo(key, () => {
    const { centerY, radius, springAngle } = archCircle(rise, span);
    const arc = Math.PI - 2 * springAngle;
    const gap = 0.012 / radius; // joint constant (~1.2 cm) quel que soit le rayon
    const a0 = springAngle + (arc * index) / count + gap / 2;
    const a1 = springAngle + (arc * (index + 1)) / count - gap / 2;
    const inner = radius;
    const outer = radius + ringWidth + extraHeight;

    const shape = new THREE.Shape();
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const point: [number, number] = [Math.cos(a) * inner, centerY + Math.sin(a) * inner];
      if (i === 0) shape.moveTo(...point);
      else shape.lineTo(...point);
    }
    for (let i = steps; i >= 0; i -= 1) {
      const a = a0 + ((a1 - a0) * i) / steps;
      shape.lineTo(Math.cos(a) * outer, centerY + Math.sin(a) * outer);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -depth / 2));
    geo.computeVertexNormals();
    return geo;
  });
}

// ── Pavés : dalle de rue d'une cellule ───────────────────────────────────────

/** Nombre de variantes de dalle pavée (tirées puis tournées selon la cellule). */
export const COBBLE_TILE_VARIANTS = 3;
const COBBLES_PER_SIDE = 6;

/**
 * Une cellule de rue pavée (1 × 1, posée sur y = 0) : 6 × 6 pavés
 * irréguliers (taille, hauteur, décalage, légère rotation) fusionnés en une
 * seule géométrie, déterministe par variante. Une rue entière ne coûte
 * ainsi qu'une part par cellule.
 */
export function cobbleTileGeo(variant: number): THREE.BufferGeometry {
  return getGeo(`cobbles|${variant}`, () => {
    const random = seededRandom(0xc0bb1e + variant * 7919);
    const pitch = 1 / COBBLES_PER_SIDE;
    const positions: number[] = [];
    const normals: number[] = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();

    for (let i = 0; i < COBBLES_PER_SIDE; i += 1) {
      for (let j = 0; j < COBBLES_PER_SIDE; j += 1) {
        // Rangs décalés d'un demi-pavé une ligne sur deux, comme un vrai
        // pavage : le dernier pavé d'un rang décalé déborderait de la dalle,
        // il devient un demi-pavé calé contre le bord opposé.
        const staggered = j % 2 === 1;
        const isHalf = staggered && i === COBBLES_PER_SIDE - 1;
        const w = (isHalf ? pitch / 2 : pitch) * (0.78 + random() * 0.14);
        const d = pitch * (0.78 + random() * 0.14);
        const h = 0.028 + random() * 0.018;
        const jitter = () => (random() - 0.5) * pitch * 0.1;
        const x = isHalf ? -0.5 + pitch / 4 : -0.5 + pitch * (i + 0.5) + (staggered ? pitch / 2 : 0) + jitter();
        const z = -0.5 + pitch * (j + 0.5) + jitter();
        euler.set((random() - 0.5) * 0.08, (random() - 0.5) * 0.25, (random() - 0.5) * 0.08);
        quaternion.setFromEuler(euler);
        matrix.compose(new THREE.Vector3(x, h / 2, z), quaternion, new THREE.Vector3(1, 1, 1));

        const box = new THREE.BoxGeometry(w, h, d).toNonIndexed();
        box.applyMatrix4(matrix);
        positions.push(...(box.getAttribute('position').array as Float32Array));
        normals.push(...(box.getAttribute('normal').array as Float32Array));
        box.dispose();
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
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
