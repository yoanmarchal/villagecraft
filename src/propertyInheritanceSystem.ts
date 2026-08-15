import { type GridCell, BlockType, type PropertyBundle } from './types';
import { useControlStore } from './store/controlStore';

/** Couleur de base pilotée par le panneau de contrôle (mur ou toit selon le type de cellule). */
export function computePropertyBundle(cell: GridCell): PropertyBundle {
  const { wallBaseColor, roofBaseColor } = useControlStore.getState();
  const color = cell.type === BlockType.Roof ? roofBaseColor : wallBaseColor;
  return { color };
}
