import { type GridCell, type CellCoordinate, DecorationStyle, type MergeFlags, type PropertyBundle } from './types';
import { getBuildingId, getPaletteByIndex, type ColorPalette } from './colorPalettes';
import { useControlStore } from './store/controlStore';

export class PropertyInheritanceSystem {
  private readonly grid: GridCell[][][];
  private readonly sizeX: number;
  private readonly sizeZ: number;

  constructor(grid: GridCell[][][], sizeX: number, sizeZ: number) {
    this.grid = grid;
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
  }

  public computePropertyBundle(cell: GridCell): PropertyBundle {
    const buildingId = getBuildingId(cell.x, cell.z, this.sizeX);
    const palette = getPaletteByIndex(buildingId);

    // Utiliser la couleur de base du bâtiment avec une légère variation déterministe
    const baseColor = palette.primary;
    const color = this.applyDeterministicColorVariation(baseColor, cell);

    // Toujours utiliser le style standard et fusion simple
    return {
      color,
      decorationStyle: DecorationStyle.Standard,
      mergeFlags: {
        mergeWithNeighbors: this.shouldMergeWithNeighbors(cell, buildingId),
        suppressQuoin: {
          backLeft: false,
          backRight: false,
          frontLeft: false,
          frontRight: false
        },
        suppressBaseTrim: {
          front: false,
          back: false,
          left: false,
          right: false
        },
        suppressCornice: false
      }
    };
  }

  private shouldMergeWithNeighbors(cell: GridCell, buildingId: number): boolean {
    // Vérifier si la cellule a des voisins du même bâtiment
    const neighbors = this.getAdjacentNeighbors(cell);
    return neighbors.some(neighbor =>
      getBuildingId(neighbor.x, neighbor.z, this.sizeX) === buildingId
    );
  }

  private getAdjacentNeighbors(cell: GridCell): GridCell[] {
    const neighbors: GridCell[] = [];
    const directions = [
      [-1, 0], [1, 0], [0, -1], [0, 1] // gauche, droite, avant, arrière
    ];

    for (const [dx, dz] of directions) {
      const neighbor = this.getNeighborCell(cell.x + dx, cell.y, cell.z + dz);
      if (neighbor?.isOccupied) {
        neighbors.push(neighbor);
      }
    }

    return neighbors;
  }

  private getNeighborCell(x: number, y: number, z: number): GridCell | null {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.grid[x].length || z < 0 || z >= this.grid[x][y].length) {
      return null;
    }
    return this.grid[x][y][z];
  }

  private applyDeterministicColorVariation(baseColor: string, cell: GridCell): string {
    // Calculer une variation déterministe basée sur les coordonnées
    const seed = this.getDeterministicColorSeed(cell.x, cell.y, cell.z);
    const variation = this.seedToVariation(seed);

    // Appliquer la variation à la couleur de base
    return this.applyColorVariation(baseColor, variation);
  }

  private getDeterministicColorSeed(x: number, y: number, z: number): number {
    // Utiliser un mélange simple des coordonnées pour créer une graine déterministe
    return (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  }

  private seedToVariation(seed: number): number {
    // Convertir la graine en une variation entre -colorJitterIntensity et +colorJitterIntensity
    const normalized = (seed & 0xFFFFFF) / 0xFFFFFF; // 0-1
    const { colorJitterIntensity } = useControlStore.getState();
    return (normalized - 0.5) * 2 * colorJitterIntensity;
  }

  private applyColorVariation(baseColor: string, variation: number): string {
    const rgb = this.hexToRgb(baseColor);

    // Appliquer la variation à chaque composante
    const r = Math.min(255, Math.max(0, rgb.r + (variation * 255)));
    const g = Math.min(255, Math.max(0, rgb.g + (variation * 255)));
    const b = Math.min(255, Math.max(0, rgb.b + (variation * 255)));

    return this.rgbToHex(r, g, b);
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b };
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => {
      const hex = Math.round(x).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }
}
