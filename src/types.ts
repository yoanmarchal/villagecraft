export enum BlockType {
  Empty = 'EMPTY',
  Foundation = 'FOUNDATION',
  Wall = 'WALL',
  WallWithWindow = 'WALL_WINDOW',
  Roof = 'ROOF',
  Arch = 'ARCH',
}

export interface GridCell {
  x: number;
  y: number;
  z: number;
  isOccupied: boolean;
  type: BlockType;
  placementOrder: number;
  /**
   * True for a roof cap the grid added on its own above a lone ground-floor
   * cell (see `VillageGrid.syncAutoRoofs`) — not a block the user placed.
   * Clicking to build on top of it, or removing the wall below it, should
   * claim/clear it transparently rather than treating it as a real block.
   */
  isAutoRoof?: boolean;
  /**
   * True for an arch the grid added on its own over a lane between two
   * facing buildings (see `VillageGrid.syncAutoArches`) — like `isAutoRoof`,
   * not a user block: not saved, ignored by clicks and demolition.
   */
  isAutoArch?: boolean;
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
