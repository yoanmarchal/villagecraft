import { useEffect, useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import { BufferAttribute, BufferGeometry } from 'three';
import type { ToolMode } from '../store/uiStore';
import { TERRAIN_FINE_STEP } from './Terrain';

interface PlacementPreviewProps {
  previewCell: { x: number; z: number } | null;
  mode: ToolMode;
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
  getNextPlacementY: (x: number, z: number, minimumY: number) => number | null;
  getRemovalY: (x: number, z: number) => number | null;
  /** Niveau de la colonne sur le terrain en pente (ground.ts). */
  baseAt: (x: number, z: number) => number;
  /** Hauteur du terrain en (x, z) monde. */
  heightAt: (worldX: number, worldZ: number) => number;
}

/** Garde au-dessus de l'herbe (évite le z-fighting avec le terrain). */
const PATCH_LIFT = 0.012;

/**
 * Case visée par les outils du terrain : une pastille drapée sur le sol, sur
 * la maille fine du terrain (elle en suit donc exactement la surface).
 */
function SculptPatch({
  centre,
  heightAt,
  color,
}: {
  centre: [number, number];
  heightAt: PlacementPreviewProps['heightAt'];
  color: string;
}) {
  const [cx, cz] = centre;
  const geometry = useMemo(() => {
    const n = Math.round(1 / TERRAIN_FINE_STEP);
    const positions: number[] = [];
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        const x = cx - 0.5 + i / n;
        const z = cz - 0.5 + j / n;
        positions.push(x, heightAt(x, z) + PATCH_LIFT, z);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const a = j * (n + 1) + i;
        const b = a + n + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const patch = new BufferGeometry();
    patch.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    patch.setIndex(indices);
    return patch;
  }, [cx, cz, heightAt]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

/**
 * Fantôme sous le curseur : bloc clair là où le prochain bloc sera posé
 * (construction), enveloppe rouge autour du bloc qui sera retiré
 * (démolition), ou pastille au sol sur la case qui sera relevée / creusée.
 */
export function PlacementPreview({
  previewCell,
  mode,
  toWorldPosition,
  getNextPlacementY,
  getRemovalY,
  baseAt,
  heightAt,
}: PlacementPreviewProps) {
  if (!previewCell) {
    return null;
  }
  const { x, z } = previewCell;

  if (mode === 'raise' || mode === 'lower') {
    const [wx, , wz] = toWorldPosition(x, 0, z);
    return <SculptPatch centre={[wx, wz]} heightAt={heightAt} color={mode === 'raise' ? '#ffe9a8' : '#7fb4e6'} />;
  }

  const isDemolish = mode === 'demolish';
  const y = isDemolish ? getRemovalY(x, z) : getNextPlacementY(x, z, 0);
  if (y === null) {
    return null;
  }

  const [wx, wy, wz] = toWorldPosition(x, y, z);
  const position: [number, number, number] = [wx, wy + baseAt(x, z), wz];

  return isDemolish ? (
    // Légèrement plus grand que la cellule pour envelopper le bloc existant.
    <RoundedBox args={[1.06, 1.06, 1.06]} radius={0.1} smoothness={4} position={position}>
      <meshBasicMaterial color="#d9412b" transparent opacity={0.3} depthWrite={false} />
    </RoundedBox>
  ) : (
    <RoundedBox args={[0.9, 0.9, 0.9]} radius={0.08} smoothness={4} position={position}>
      <meshStandardMaterial color="#ffd4a3" transparent opacity={0.35} depthWrite={false} />
    </RoundedBox>
  );
}
