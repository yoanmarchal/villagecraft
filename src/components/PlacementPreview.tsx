import { RoundedBox } from '@react-three/drei';
import type { ToolMode } from '../store/uiStore';

interface PlacementPreviewProps {
  previewCell: { x: number; z: number } | null;
  mode: ToolMode;
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
  getNextPlacementY: (x: number, z: number, minimumY: number) => number | null;
  getRemovalY: (x: number, z: number) => number | null;
}

/**
 * Fantôme sous le curseur : bloc clair là où le prochain bloc sera posé
 * (construction), ou enveloppe rouge autour du bloc qui sera retiré
 * (démolition).
 */
export function PlacementPreview({
  previewCell,
  mode,
  toWorldPosition,
  getNextPlacementY,
  getRemovalY,
}: PlacementPreviewProps) {
  if (!previewCell) {
    return null;
  }

  const isDemolish = mode === 'demolish';
  const y = isDemolish ? getRemovalY(previewCell.x, previewCell.z) : getNextPlacementY(previewCell.x, previewCell.z, 0);
  if (y === null) {
    return null;
  }

  const position = toWorldPosition(previewCell.x, y, previewCell.z);

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
