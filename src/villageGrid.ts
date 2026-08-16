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
    this.grid[x][y][z].isAutoRoof = false;
    this.recomputeProceduralLogic();
  }

  public removeTopBlockInColumn(x: number, z: number): number | null {
    if (!this.isValidCoordinate(x, 0, z)) {
      return null;
    }

    for (let y = this.sizeY - 1; y >= 0; y -= 1) {
      const cell = this.grid[x][y][z];
      // On ignore les caps de toit auto-générés : "retirer le sommet" doit
      // retirer le vrai bloc du dessus, le cap disparaîtra de lui-même au
      // prochain recalcul (syncAutoRoofs).
      if (!cell.isOccupied || cell.isAutoRoof) {
        continue;
      }

      this.removeBlock(x, y, z);
      return y;
    }

    return null;
  }

  /**
   * Topmost occupied cell in the column, auto-roof cap included — used to
   * decide where the next real block goes: it always builds strictly above
   * whatever is currently there, cap or not, so adding a block on a capped
   * single-story column visibly grows it (the old cap gets promoted to a
   * real wall by `syncAutoRoofs` once something real sits above it).
   */
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

  /**
   * Topmost *real* (user-placed) cell in the column, ignoring any
   * auto-generated roof cap — used for removal, so "remove the top block"
   * always demolishes an actual wall instead of fighting the self-healing
   * cap (which would just regrow on the next recompute).
   */
  public getTopRealOccupiedY(x: number, z: number): number | null {
    if (!this.isValidCoordinate(x, 0, z)) {
      return null;
    }

    for (let y = this.sizeY - 1; y >= 0; y -= 1) {
      const cell = this.grid[x][y][z];
      if (cell.isOccupied && !cell.isAutoRoof) {
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
          this.grid[x][y][z].isAutoRoof = false;
        }
      }
    }
  }

  public generateTerrain(
    gridSize: number = 2,
    options: { occupancyChance?: number; minHeight?: number; maxHeight?: number } = {},
  ): void {
    this.clear();

    const { occupancyChance = 0.7, minHeight = 1, maxHeight = 3 } = options;
    const clampedMaxHeight = Math.max(1, Math.min(maxHeight, this.sizeY));
    const clampedMinHeight = Math.max(1, Math.min(minHeight, clampedMaxHeight));

    // Randomly skip some columns so the footprint isn't a solid gridSize x gridSize
    // slab, and give each occupied column its own random height so the plot has
    // some vertical variety instead of everything being a single story.
    const occupiedColumns: Array<{ x: number; z: number }> = [];
    for (let x = 0; x < gridSize; x += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        if (Math.random() < occupancyChance) {
          occupiedColumns.push({ x, z });
        }
      }
    }

    // Never generate an empty plot: fall back to a single random column.
    if (occupiedColumns.length === 0) {
      occupiedColumns.push({
        x: Math.floor(Math.random() * gridSize),
        z: Math.floor(Math.random() * gridSize),
      });
    }

    for (const { x, z } of occupiedColumns) {
      const height = clampedMinHeight + Math.floor(Math.random() * (clampedMaxHeight - clampedMinHeight + 1));
      for (let y = 0; y < height; y += 1) {
        this.addBlock(x, y, z);
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

  /**
   * Une colonne réduite à son seul rez-de-chaussée (y=0) ne peut jamais
   * devenir un toit via la règle "sommet de colonne" normale, puisque y=0
   * est toujours forcé en Foundation/Mur. On lui ajoute donc ici un cap de
   * toit auto-généré à y=1 pour qu'un bâtiment d'un seul étage soit quand
   * même coiffé automatiquement, sans que l'utilisateur ait à cliquer une
   * seconde fois. Dès qu'un vrai bloc est posé plus haut (colonne à 2+
   * étages), la règle normale prend le relais et ce cap est retiré.
   */
  private syncAutoRoofs(): void {
    for (let x = 0; x < this.sizeX; x += 1) {
      for (let z = 0; z < this.sizeZ; z += 1) {
        let topOccupiedY = -1;
        for (let y = this.sizeY - 1; y >= 0; y -= 1) {
          if (this.grid[x][y][z].isOccupied) {
            topOccupiedY = y;
            break;
          }
        }

        // Un cap n'est plus "au sommet" dès qu'un vrai bloc a été construit
        // par-dessus (cf getTopOccupiedY, qui laisse toujours placer au-dessus
        // du cap plutôt que de le réclamer sur place) : il devient alors un
        // mur permanent, pas juste un cap qu'on retire.
        for (let y = 0; y < topOccupiedY; y += 1) {
          const cell = this.grid[x][y][z];
          if (cell.isAutoRoof) {
            cell.isAutoRoof = false;
            cell.placementOrder = this.nextPlacementOrder;
            this.nextPlacementOrder += 1;
          }
        }

        let realTopY = -1;
        for (let y = this.sizeY - 1; y >= 0; y -= 1) {
          const cell = this.grid[x][y][z];
          if (cell.isOccupied && !cell.isAutoRoof) {
            realTopY = y;
            break;
          }
        }

        const autoRoofY = realTopY === 0 && this.isValidCoordinate(x, 1, z) ? 1 : null;

        for (let y = 0; y < this.sizeY; y += 1) {
          const cell = this.grid[x][y][z];
          if (!cell.isAutoRoof || y === autoRoofY) {
            continue;
          }
          // Cap devenu obsolète (colonne démolie).
          cell.isOccupied = false;
          cell.isAutoRoof = false;
          cell.type = BlockType.Empty;
          cell.color = undefined;
          cell.propertyBundle = undefined;
        }

        if (autoRoofY !== null) {
          const cell = this.grid[x][autoRoofY][z];
          if (!cell.isOccupied) {
            cell.isOccupied = true;
            cell.isAutoRoof = true;
          }
        }
      }
    }
  }

  private recomputeProceduralLogic(): void {
    this.syncAutoRoofs();

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
