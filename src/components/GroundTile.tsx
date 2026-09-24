/**
 * Socle "diorama" du village : une dalle d'herbe dont le dessus affleure
 * y = 0 (le pied des blocs), posée sur un bloc de terre légèrement en
 * retrait. Remplace l'ancien plan semi-transparent, de la même couleur que
 * les murs, sur lequel les bâtiments se fondaient.
 */

import { RoundedBox } from '@react-three/drei';

interface GroundTileProps {
  width: number;
  depth: number;
  grassColor: string;
  roughness: number;
}

/** Débord de l'herbe autour de la grille, de chaque côté. */
const GRASS_MARGIN = 0.45;
const GRASS_THICKNESS = 0.16;
const EARTH_DEPTH = 0.9;
const EARTH_COLOR = '#8a6b4e';

export function GroundTile({ width, depth, grassColor, roughness }: GroundTileProps) {
  return (
    <group>
      <RoundedBox
        args={[width + GRASS_MARGIN * 2, GRASS_THICKNESS, depth + GRASS_MARGIN * 2]}
        radius={0.06}
        smoothness={2}
        position={[0, -GRASS_THICKNESS / 2, 0]}
        receiveShadow
      >
        <meshStandardMaterial color={grassColor} roughness={roughness} />
      </RoundedBox>
      <RoundedBox
        args={[width + GRASS_MARGIN * 2 - 0.12, EARTH_DEPTH, depth + GRASS_MARGIN * 2 - 0.12]}
        radius={0.08}
        smoothness={2}
        position={[0, -GRASS_THICKNESS - EARTH_DEPTH / 2 + 0.02, 0]}
        receiveShadow
      >
        <meshStandardMaterial color={EARTH_COLOR} roughness={1} />
      </RoundedBox>
    </group>
  );
}
