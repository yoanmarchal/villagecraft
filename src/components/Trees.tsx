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
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { scatterTrees, type TreeInstance, type TreeKind } from '../render/landscape';
import { injectWorldDetail } from '../render/surfaceDetail';

interface TreesProps {
  gridSize: number;
  flatRadius: number;
  /** Rayon du semis : au-delà, le brouillard cache tout. */
  reach: number;
}

const TRUNK_COLOR = new THREE.Color('#5b4636');
const BROADLEAF_COLOR = new THREE.Color('#6a9440');
const CONIFER_COLOR = new THREE.Color('#44724a');

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

/** Feuillu : tronc + houppier fait de quelques masses bosselées. */
function broadleafGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.07, 0.12, 1.1, 7).translate(0, 0.55, 0), TRUNK_COLOR);
  const blobs: Array<[number, number, number, number]> = [
    [0, 1.75, 0, 0.78],
    [0.48, 1.45, 0.12, 0.52],
    [-0.42, 1.5, -0.22, 0.56],
    [0.05, 1.4, 0.5, 0.48],
    [-0.1, 2.2, -0.08, 0.5],
  ];
  const canopy = blobs.map(([x, y, z, radius]) => {
    const blob = new THREE.IcosahedronGeometry(radius, 2);
    const position = blob.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const px = position.getX(i);
      const py = position.getY(i);
      const pz = position.getZ(i);
      // Bosses : chaque sommet est poussé le long de son rayon.
      const bump = 0.82 + 0.36 * vertexHash(px * 3.1 + x, py * 3.1 + y, pz * 3.1 + z);
      position.setXYZ(i, px * bump + x, py * bump * 0.86 + y, pz * bump + z);
    }
    return paint(blob, BROADLEAF_COLOR, (h) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(h, 1.0, 2.3));
  });
  return finish([trunk, ...canopy]);
}

/** Conifère : tronc + étages de cônes qui se recouvrent. */
function coniferGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.05, 0.1, 0.9, 6).translate(0, 0.45, 0), TRUNK_COLOR);
  const tiers: Array<[number, number, number]> = [
    [0.62, 1.1, 0.95],
    [0.5, 1.0, 1.55],
    [0.36, 0.9, 2.1],
    [0.22, 0.8, 2.6],
  ];
  const foliage = tiers.map(([radius, height, y]) =>
    paint(new THREE.ConeGeometry(radius, height, 9, 2).translate(0, y, 0), CONIFER_COLOR, (h) => {
      // Sombre au cœur de chaque étage, plus clair vers sa pointe.
      return 0.6 + 0.4 * THREE.MathUtils.smoothstep(h, y - height / 2, y + height / 2);
    }),
  );
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

export function Trees({ gridSize, flatRadius, reach }: TreesProps) {
  const trees = useMemo(() => scatterTrees(gridSize, flatRadius, reach), [gridSize, flatRadius, reach]);

  const [assets] = useState(() => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
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
