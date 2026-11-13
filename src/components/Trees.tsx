/**
 * Arbres du paysage, hors de la grille : deux `InstancedMesh` (feuillus,
 * conifères), placés par `scatterTrees()` (landscape.ts, déterministe).
 * Décor pur — jamais raycasté : les clics passent par le plan invisible de
 * VoxelScene.
 *
 * Chaque essence est une seule géométrie fusionnée (tronc + houppier) aux
 * couleurs par sommet, assombries vers le bas du feuillage (fausse occlusion) ;
 * la teinte varie par instance (`instanceColor`) et un bruit monde marbre le
 * feuillage (surfaceDetail.ts).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { scatterTrees, type TreeInstance, type TreeKind } from '../render/landscape';
import type { Relief } from '../render/relief';
import { injectWorldDetail } from '../render/surfaceDetail';

interface TreesProps {
  gridSize: number;
  flatRadius: number;
  /** Rayon du semis : au-delà, le brouillard cache tout. */
  reach: number;
  /** Relief du terrain aux abords du village (relief.ts). */
  relief: Relief;
}

const TRUNK_COLOR = new THREE.Color('#5b4636');
const BROADLEAF_COLOR = new THREE.Color('#5d8239');
const CONIFER_COLOR = new THREE.Color('#3d6645');

/** Pseudo-aléatoire stable par sommet (jamais Math.random : géométrie identique d'un montage à l'autre). */
const vertexHash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Colore tous les sommets d'une géométrie ; `shade(y)` module la luminosité selon la hauteur. */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color, shade: (y: number) => number = () => 1) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const k = shade(position.getY(i));
    colors[i * 3] = color.r * k;
    colors[i * 3 + 1] = color.g * k;
    colors[i * 3 + 2] = color.b * k;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Position + couleur seulement, soudé, normales lissées : les primitives fusionnées doivent avoir les mêmes attributs. */
function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const part of parts) {
    part.deleteAttribute('uv');
    part.deleteAttribute('normal');
  }
  const merged = mergeVertices(mergeGeometries(parts.map((part) => (part.index ? part.toNonIndexed() : part))));
  merged.computeVertexNormals();
  for (const part of parts) part.dispose();
  return merged;
}

/** Bosses lisses (somme de sinus) : un houppier modelé, pas hérissé. */
const lump = (x: number, y: number, z: number) =>
  Math.sin(x * 5.3 + y * 1.7) * Math.sin(y * 4.1 + z * 2.3) * Math.sin(z * 4.7 + x * 1.3);

/** Feuillu : tronc évasé, deux maîtresses branches, houppier fait de masses bosselées. */
function broadleafGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.075, 0.15, 1.25, 8, 3).translate(0, 0.62, 0), TRUNK_COLOR);
  const branches = [
    [0.5, 0.26],
    [-0.45, -0.3],
  ].map(([lean, turn]) =>
    paint(
      new THREE.CylinderGeometry(0.035, 0.06, 0.75, 6)
        .translate(0, 0.37, 0)
        .rotateZ(lean)
        .rotateY(turn)
        .translate(0, 1.0, 0),
      TRUNK_COLOR,
    ),
  );
  const blobs: Array<[number, number, number, number]> = [
    [0, 1.85, 0, 0.74],
    [0.55, 1.55, 0.14, 0.5],
    [-0.5, 1.6, -0.24, 0.54],
    [0.08, 1.5, 0.56, 0.46],
    [-0.1, 1.55, -0.55, 0.44],
    [-0.14, 2.32, -0.06, 0.5],
    [0.34, 2.18, 0.26, 0.4],
    [-0.42, 2.05, 0.3, 0.38],
  ];
  const canopy = blobs.map(([x, y, z, radius]) => {
    const blob = new THREE.IcosahedronGeometry(radius, 3);
    const position = blob.attributes.position;
    for (let k = 0; k < position.count; k += 1) {
      const px = position.getX(k);
      const py = position.getY(k);
      const pz = position.getZ(k);
      // Chaque sommet est poussé le long de son rayon : grosses bosses + petit bruit.
      const bump =
        1 + 0.2 * lump(px + x, py + y, pz + z) + 0.07 * (vertexHash(px * 9 + x, py * 9 + y, pz * 9 + z) - 0.5);
      position.setXYZ(k, px * bump + x, py * bump * 0.84 + y, pz * bump + z);
    }
    // Plus sombre dessous et au cœur (fausse occlusion), plus clair au sommet.
    return paint(blob, BROADLEAF_COLOR, (h) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(h, 1.1, 2.5));
  });
  return finish([trunk, ...branches, ...canopy]);
}

/** Conifère : tronc + jupes de branches tombantes, au bord dentelé, qui se recouvrent. */
function coniferGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.045, 0.1, 1.0, 6).translate(0, 0.5, 0), TRUNK_COLOR);
  const TIERS = 7;
  const foliage = Array.from({ length: TIERS }, (_, tier) => {
    const t = tier / (TIERS - 1);
    const radius = 0.68 - 0.5 * t;
    const height = 0.72 - 0.22 * t;
    const y = 0.85 + tier * 0.34;
    const cone = new THREE.ConeGeometry(radius, height, 11, 3, true);
    const position = cone.attributes.position;
    for (let k = 0; k < position.count; k += 1) {
      const px = position.getX(k);
      const py = position.getY(k);
      const pz = position.getZ(k);
      // Vers le bas de la jupe : bord dentelé (une pointe par branche) qui retombe.
      const skirt = 1 - (py + height / 2) / height;
      const angle = Math.atan2(pz, px);
      const tooth = 1 + skirt * 0.22 * Math.sin(angle * 5.5 + tier * 1.9);
      position.setXYZ(k, px * tooth, py - skirt * skirt * 0.1 * (1 + Math.sin(angle * 5.5 + tier * 1.9)), pz * tooth);
    }
    cone.translate(0, y, 0);
    return paint(cone, CONIFER_COLOR, (h) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(h, y - height / 2, y + height / 2));
  });
  return finish([trunk, ...foliage]);
}

const FOLIAGE_ALBEDO = `
  {
    float leafMottle = vcFbm(vDetailPos * 3.1);
    float leafGrain = vcNoise(vDetailPos * 21.0) * (1.0 - smoothstep(6.0, 24.0, length(vViewPosition)));
    diffuseColor.rgb *= 0.74 + 0.6 * leafMottle + 0.16 * leafGrain;
    vcDetailHeight = leafMottle * 0.09 + leafGrain * 0.02;
  }
`;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

interface TreeGroupProps {
  kind: TreeKind;
  trees: TreeInstance[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

function TreeGroup({ kind, trees, geometry, material }: TreeGroupProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const instances = useMemo(() => trees.filter((tree) => tree.kind === kind), [trees, kind]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    instances.forEach((tree, index) => {
      _position.set(tree.x, tree.y - 0.03, tree.z);
      _quaternion.setFromAxisAngle(_up, tree.rotation);
      // Les conifères sont plus élancés ; chaque arbre a ses proportions.
      const girth = tree.scale * (0.85 + tree.tint * 0.3);
      _scale.set(girth, tree.scale * (kind === 'conifer' ? 1.25 : 1), girth);
      mesh.setMatrixAt(index, _matrix.compose(_position, _quaternion, _scale));
      // Teinte : du vert sombre au vert doré, autour de la couleur de l'essence.
      _color.setRGB(0.8 + tree.tint * 0.42, 0.86 + ((tree.tint * 7) % 1) * 0.26, 0.74 + tree.tint * 0.3);
      mesh.setColorAt(index, _color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [instances, kind, invalidate]);

  if (instances.length === 0) return null;
  // `key` : un InstancedMesh ne peut pas changer de capacité, il est recréé.
  return (
    <instancedMesh
      key={instances.length}
      ref={ref}
      args={[geometry, material, instances.length]}
      castShadow
      receiveShadow
    />
  );
}

export function Trees({ gridSize, flatRadius, reach, relief }: TreesProps) {
  const trees = useMemo(() => scatterTrees(gridSize, flatRadius, reach, relief), [gridSize, flatRadius, reach, relief]);

  const [assets] = useState(() => {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      // Les jupes des conifères sont des cônes ouverts : leur dessous doit se voir.
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => injectWorldDetail(shader, { albedo: FOLIAGE_ALBEDO });
    return { material, broadleaf: broadleafGeometry(), conifer: coniferGeometry() };
  });
  useEffect(
    () => () => {
      assets.material.dispose();
      assets.broadleaf.dispose();
      assets.conifer.dispose();
    },
    [assets],
  );

  return (
    <>
      <TreeGroup kind="broadleaf" trees={trees} geometry={assets.broadleaf} material={assets.material} />
      <TreeGroup kind="conifer" trees={trees} geometry={assets.conifer} material={assets.material} />
    </>
  );
}
