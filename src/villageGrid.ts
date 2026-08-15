import { BlockType, type CellCoordinate, type GridCell, type PropertyBundle } from './types';
import { type ColorPalette, getBuildingId, getPaletteByIndex, randomColorVariation } from './colorPalettes';
import { PropertyInheritanceSystem } from './propertyInheritanceSystem';

// Simple 2D Perlin noise implementation for terrain generation
class PerlinNoise {
  private seed: number;
  private permutation: number[];

  constructor(seed: number) {
    this.seed = seed;
    this.permutation = this.generatePermutation();
  }

  private generatePermutation(): number[] {
    const permutation = [];
    for (let i = 0; i < 256; i++) {
      permutation[i] = i;
    }

    // Shuffle the permutation array using the seed
    for (let i = 0; i < 256; i++) {
      const j = Math.floor(this.random() * 256);
      [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }

    return permutation;
  }

  private random(): number {
    // Simple pseudo-random number generator
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  public noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const a = this.permutation[X] + Y;
    const aa = this.permutation[a];
    const ab = this.permutation[a + 1];
    const b = this.permutation[X + 1] + Y;
    const ba = this.permutation[b];
    const bb = this.permutation[b + 1];

    return this.lerp(v, this.lerp(u, this.grad(this.permutation[aa], xf, yf), this.grad(this.permutation[ba], xf - 1, yf)),
                           this.lerp(u, this.grad(this.permutation[ab], xf, yf - 1), this.grad(this.permutation[bb], xf - 1, yf - 1)));
  }
}

export class VillageGrid {
  private readonly sizeX: number;
  private readonly sizeY: number;
  private readonly sizeZ: number;
  private readonly grid: GridCell[][][];
  private readonly buildingPalettes: Map<number, ColorPalette> = new Map();
  private nextPlacementOrder: number = 0;
  private noiseGenerator: PerlinNoise;

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.grid = this.createEmptyGrid();
    this.noiseGenerator = new PerlinNoise(42); // Default seed
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

  public generateTerrain(seed: number, heightScale: number = 3, gridSize: number = 2): void {
    this.clear();
    this.noiseGenerator = new PerlinNoise(seed);

    // Generate exactly gridSize x gridSize blocks (2x2 = 4 blocks, 3x3 = 9 blocks, etc.)
    // This creates a simple flat grid with exactly the specified number of blocks
    const maxHeight = 1; // Always 1 block high for simple grid

    // Generate exactly gridSize x gridSize blocks
    for (let x = 0; x < gridSize; x += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        // Add exactly 1 block per position (flat grid)
        this.addBlock(x, 0, z);
      }
    }
  }

  public updateNoiseParameters(seed: number, gridSize: number = 2): void {
    this.noiseGenerator = new PerlinNoise(seed);

    // Regenerate terrain with new parameters including grid size
    this.generateTerrain(seed, 2, gridSize);
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

  public getTypeCounts(): Record<BlockType, number> {
    const counts: Record<BlockType, number> = {
      [BlockType.Empty]: 0,
      [BlockType.Foundation]: 0,
      [BlockType.Wall]: 0,
      [BlockType.WallWithWindow]: 0,
      [BlockType.Roof]: 0,
      [BlockType.Arch]: 0,
    };

    for (const cell of this.getOccupiedCells()) {
      counts[cell.type] += 1;
    }

    return counts;
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
    // Créer le système d'héritage de propriétés simplifié
    const inheritanceSystem = new PropertyInheritanceSystem(this.grid, this.sizeX, this.sizeZ);

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

          const cellBelow = this.getNeighborCell(x, y - 1, z);
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
          const hasSupportBelow = cellBelow?.isOccupied ?? false;

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
          cell.propertyBundle = inheritanceSystem.computePropertyBundle(cell);
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

  private getBuildingPalette(x: number, z: number): ColorPalette {
    const buildingId = getBuildingId(x, z, this.sizeX);
    
    if (!this.buildingPalettes.has(buildingId)) {
      this.buildingPalettes.set(buildingId, getPaletteByIndex(buildingId));
    }
    
    return this.buildingPalettes.get(buildingId)!;
  }

  private getColorForCell(cell: GridCell): string {
    const palette = this.getBuildingPalette(cell.x, cell.z);
    let baseColor: string;

    switch (cell.type) {
      case BlockType.Foundation:
        baseColor = palette.foundation;
        break;
      case BlockType.Wall:
        baseColor = palette.primary;
        break;
      case BlockType.WallWithWindow:
        baseColor = palette.accent;
        break;
      case BlockType.Roof:
        baseColor = palette.roof;
        break;
      case BlockType.Arch:
        baseColor = palette.primary;
        break;
      default:
        baseColor = '#b8b8b8';
    }

    // Ajouter une légère variation aléatoire pour éviter l'uniformité
    return randomColorVariation(baseColor, 0.06);
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
