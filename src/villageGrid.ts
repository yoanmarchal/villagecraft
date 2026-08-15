import { BlockType, type CellCoordinate, type GridCell } from './types';
import { computePropertyBundle } from './propertyInheritanceSystem';

export class VillageGrid {
  private readonly sizeX: number;
  private readonly sizeY: number;
  private readonly sizeZ: number;
  private readonly grid: GridCell[][][];
  private nextPlacementOrder: number = 0;

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.grid = this.createEmptyGrid();
  }

  public addBlock(x: number, y: number, z: number): void {
    if (!this.isValidCoordinate(x, y, z)) {
      return;
    }

    const cell = this.grid[x][y][z];
    if (!cell.isOccupied) {
      cell.placementOrder = this.nextPlacementOrder;
      this.nextPlacementOrder += 1;
      cell.isOccupied = true;
    }
    this.recomputeProceduralLogic();
  }

  public addBlockInColumn(x: number, z: number, minimumY = 0): number | null {
    if (!this.isValidCoordinate(x, minimumY, z)) {
      return null;
    }

    let targetY = minimumY;

    for (let y = minimumY; y < this.sizeY; y += 1) {
      if (!this.grid[x][y][z].isOccupied) {
        targetY = y;
        break;
      }

      targetY = y + 1;
    }

    if (!this.isValidCoordinate(x, targetY, z)) {
      return null;
    }

    const cell = this.grid[x][targetY][z];
    if (!cell.isOccupied) {
      cell.placementOrder = this.nextPlacementOrder;
      this.nextPlacementOrder += 1;
      cell.isOccupied = true;
    }
    this.recomputeProceduralLogic();
    return targetY;
  }

  public removeBlock(x: number, y: number, z: number): void {
    if (!this.isValidCoordinate(x, y, z)) {
      return;
    }

    this.grid[x][y][z].isOccupied = false;
    this.grid[x][y][z].type = BlockType.Empty;
    this.grid[x][y][z].color = undefined;
    this.grid[x][y][z].placementOrder = -1;
    this.grid[x][y][z].propertyBundle = undefined;
    this.recomputeProceduralLogic();
  }

  public removeTopBlockInColumn(x: number, z: number): number | null {
    if (!this.isValidCoordinate(x, 0, z)) {
      return null;
    }

    for (let y = this.sizeY - 1; y >= 0; y -= 1) {
      const cell = this.grid[x][y][z];
      if (!cell.isOccupied) {
        continue;
      }

      this.removeBlock(x, y, z);
      return y;
    }

    return null;
  }

  public getTopOccupiedY(x: number, z: number): number | null {
    if (!this.isValidCoordinate(x, 0, z)) {
      return null;
    }

    for (let y = this.sizeY - 1; y >= 0; y -= 1) {
      if (this.grid[x][y][z].isOccupied) {
        return y;
      }
    }

    return null;
  }

  public getNextPlacementY(x: number, z: number, minimumY = 0): number | null {
    if (!this.isValidCoordinate(x, minimumY, z)) {
      return null;
    }

    const topY = this.getTopOccupiedY(x, z);
    const targetY = topY === null ? minimumY : topY + 1;

    if (!this.isValidCoordinate(x, targetY, z)) {
      return null;
    }

    return targetY;
  }

  /** Recompute per-cell colors/types from current occupancy without changing which cells are occupied. */
  public recolor(): void {
    this.recomputeProceduralLogic();
  }

  public clear(): void {
    this.nextPlacementOrder = 0;
    for (let x = 0; x < this.sizeX; x += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let z = 0; z < this.sizeZ; z += 1) {
          this.grid[x][y][z].isOccupied = false;
          this.grid[x][y][z].type = BlockType.Empty;
          this.grid[x][y][z].color = undefined;
          this.grid[x][y][z].placementOrder = -1;
          this.grid[x][y][z].propertyBundle = undefined;
        }
      }
    }
  }

  public generateTerrain(gridSize: number = 2): void {
    this.clear();

    // Generate exactly gridSize x gridSize blocks (2x2 = 4 blocks, 3x3 = 9 blocks, etc.)
    // This creates a simple flat grid with exactly the specified number of blocks
    for (let x = 0; x < gridSize; x += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        this.addBlock(x, 0, z);
      }
    }
  }

  public getGrid(): GridCell[][][] {
    return this.grid;
  }

  public getCell({ x, y, z }: CellCoordinate): GridCell | null {
    if (!this.isValidCoordinate(x, y, z)) {
      return null;
    }

    return this.grid[x][y][z];
  }

  public getOccupiedCells(): GridCell[] {
    const cells: GridCell[] = [];

    for (let x = 0; x < this.sizeX; x += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let z = 0; z < this.sizeZ; z += 1) {
          const cell = this.grid[x][y][z];
          if (cell.isOccupied) {
            cells.push(cell);
          }
        }
      }
    }

    return cells;
  }

  public toWorldPosition(x: number, y: number, z: number): [number, number, number] {
    return [x - this.sizeX / 2 + 0.5, y + 0.5, z - this.sizeZ / 2 + 0.5];
  }

  public fromWorldPosition(worldX: number, worldZ: number): { x: number; z: number } {
    return {
      x: Math.floor(worldX + this.sizeX / 2),
      z: Math.floor(worldZ + this.sizeZ / 2),
    };
  }

  private createEmptyGrid(): GridCell[][][] {
    const grid: GridCell[][][] = [];

    for (let x = 0; x < this.sizeX; x += 1) {
      grid[x] = [];
      for (let y = 0; y < this.sizeY; y += 1) {
        grid[x][y] = [];
        for (let z = 0; z < this.sizeZ; z += 1) {
          grid[x][y][z] = { x, y, z, isOccupied: false, type: BlockType.Empty, placementOrder: -1 };
        }
      }
    }

    return grid;
  }

  private recomputeProceduralLogic(): void {
    for (let x = 0; x < this.sizeX; x += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let z = 0; z < this.sizeZ; z += 1) {
          const cell = this.grid[x][y][z];

          if (!cell.isOccupied) {
            cell.type = BlockType.Empty;
            cell.color = undefined;
            cell.propertyBundle = undefined;
            continue;
          }

          const cellAbove = this.getNeighborCell(x, y + 1, z);
          const cellLeft = this.getNeighborCell(x - 1, y, z);
          const cellRight = this.getNeighborCell(x + 1, y, z);
          const cellFront = this.getNeighborCell(x, y, z - 1);
          const cellBack = this.getNeighborCell(x, y, z + 1);

          const hasLeftNeighbor = cellLeft?.isOccupied ?? false;
          const hasRightNeighbor = cellRight?.isOccupied ?? false;
          const hasFrontNeighbor = cellFront?.isOccupied ?? false;
          const hasBackNeighbor = cellBack?.isOccupied ?? false;

          const horizontalNeighborCount = [hasLeftNeighbor, hasRightNeighbor, hasFrontNeighbor, hasBackNeighbor]
            .filter(Boolean).length;

          const isTopMost = !cellAbove?.isOccupied;

          // Logique simplifiée pour les arches
          const isArch = this.isSimpleArch(x, y, z, hasLeftNeighbor, hasRightNeighbor, hasFrontNeighbor, hasBackNeighbor);

          if (y === 0) {
            // Au sol : fondation ou mur avec fenêtre selon les faces exposées
            const hasExposedFace = !hasLeftNeighbor || !hasRightNeighbor || !hasFrontNeighbor || !hasBackNeighbor;
            cell.type = hasExposedFace ? BlockType.WallWithWindow : BlockType.Foundation;
          } else if (isArch) {
            cell.type = BlockType.Arch;
          } else if (isTopMost) {
            // Bloc le plus haut d'une colonne → toit
            cell.type = BlockType.Roof;
          } else if (horizontalNeighborCount < 4) {
            // NEW RULE: Only show windows on one block per floor when adjacent
            // Check if there's already a window on this floor in adjacent columns
            const hasWindowOnSameFloor = this.hasWindowOnSameFloor(x, y, z, hasLeftNeighbor, hasRightNeighbor, hasFrontNeighbor, hasBackNeighbor);
            cell.type = hasWindowOnSameFloor ? BlockType.Wall : BlockType.WallWithWindow;
          } else {
            // Murs pleins pour les intérieurs
            cell.type = BlockType.Wall;
          }

          // Calculer le PropertyBundle simplifié
          cell.propertyBundle = computePropertyBundle(cell);
          cell.color = cell.propertyBundle.color;
        }
      }
    }
  }

  private isSimpleArch(x: number, y: number, z: number,
                     hasLeft: boolean, hasRight: boolean,
                     hasFront: boolean, hasBack: boolean): boolean {
    // Logique d'arche simplifiée : deux voisins opposés, pas de support en dessous ou voisins plus hauts
    const oppositePairs = (
      (hasLeft && hasRight) ? 1 : 0
    ) + (
      (hasFront && hasBack) ? 1 : 0
    );

    if (oppositePairs !== 1) return false;

    const hasSupportBelow = this.getNeighborCell(x, y - 1, z)?.isOccupied ?? false;
    if (hasSupportBelow) return false;

    // Vérifier que les voisins porteurs ont au moins un étage au-dessus
    if (hasLeft && hasRight) {
      const leftHasAbove = this.getNeighborCell(x - 1, y + 1, z)?.isOccupied ?? false;
      const rightHasAbove = this.getNeighborCell(x + 1, y + 1, z)?.isOccupied ?? false;
      return leftHasAbove && rightHasAbove;
    } else if (hasFront && hasBack) {
      const frontHasAbove = this.getNeighborCell(x, y + 1, z - 1)?.isOccupied ?? false;
      const backHasAbove = this.getNeighborCell(x, y + 1, z + 1)?.isOccupied ?? false;
      return frontHasAbove && backHasAbove;
    }

    return false;
  }

  private getNeighborCell(x: number, y: number, z: number): GridCell | null {
    if (!this.isValidCoordinate(x, y, z)) {
      return null;
    }

    return this.grid[x][y][z];
  }

  private isValidCoordinate(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  /**
   * Check if there's already a window on the same floor in adjacent blocks
   * This implements the rule: only one window per floor when blocks are adjacent
   */
  private hasWindowOnSameFloor(x: number, y: number, z: number,
                              hasLeft: boolean, hasRight: boolean,
                              hasFront: boolean, hasBack: boolean): boolean {
    // Check left neighbor on same floor
    if (hasLeft) {
      const leftCell = this.getNeighborCell(x - 1, y, z);
      if (leftCell?.type === BlockType.WallWithWindow) {
        return true;
      }
    }

    // Check right neighbor on same floor
    if (hasRight) {
      const rightCell = this.getNeighborCell(x + 1, y, z);
      if (rightCell?.type === BlockType.WallWithWindow) {
        return true;
      }
    }

    // Check front neighbor on same floor
    if (hasFront) {
      const frontCell = this.getNeighborCell(x, y, z - 1);
      if (frontCell?.type === BlockType.WallWithWindow) {
        return true;
      }
    }

    // Check back neighbor on same floor
    if (hasBack) {
      const backCell = this.getNeighborCell(x, y, z + 1);
      if (backCell?.type === BlockType.WallWithWindow) {
        return true;
      }
    }

    // No window found on same floor
    return false;
  }
}
