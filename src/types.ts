export enum BlockType {
  Empty = 'EMPTY',
  Foundation = 'FOUNDATION',
  Wall = 'WALL',
  WallWithWindow = 'WALL_WINDOW',
  Roof = 'ROOF',
  Arch = 'ARCH',
}

export interface PropertyBundle {
  color: string;
}

export interface GridCell {
  x: number;
  y: number;
  z: number;
  isOccupied: boolean;
  type: BlockType;
  color?: string;
  placementOrder: number;
  propertyBundle?: PropertyBundle;
  /**
   * True for a roof cap the grid added on its own above a lone ground-floor
   * cell (see `VillageGrid.syncAutoRoofs`) — not a block the user placed.
   * Clicking to build on top of it, or removing the wall below it, should
   * claim/clear it transparently rather than treating it as a real block.
   */
  isAutoRoof?: boolean;
  /**
   * `performance.now()/1000` au dernier changement visuel (type ou couleur) —
   * pilote l'animation d'apparition/transition du bloc (voir growMaterial.ts).
   */
  spawnedAt?: number;
}

export interface CellCoordinate {
  x: number;
  y: number;
  z: number;
}

// Pour le système de "saved space" - zones protégées pour éviter les superpositions
// entre éléments décoratifs (ex: stone patches ne doivent pas chevaucher fenêtres/portes)
export interface ProtectedArea {
  marginX?: number;
  marginY: number;
  centerX?: number;
  centerY?: number;
}

export type ProtectedAreasConfig = Record<string, ProtectedArea>;
