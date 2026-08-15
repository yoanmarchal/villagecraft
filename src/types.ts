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
