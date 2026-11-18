/**
 * Village édité par le serveur MCP, sans navigateur : la même `VillageGrid`
 * que l'app, modifiée comme le feraient des clics (règles de toits, d'arches,
 * de fenêtres comprises). Le résultat se partage par un lien de l'app.
 */

import { describeVillage, type VillageDescription } from '../../src/api/describeVillage';
import { GRID_HEIGHT, GRID_SIZE_MAX, GRID_SIZE_MIN } from '../../src/config/gridConfig';
import { decodeVillage, encodeVillage, HASH_KEY } from '../../src/store/villageCode';
import type { SavedVillage } from '../../src/store/villageStorage';
import { DEFAULT_TERRAIN } from '../../src/terrainShape';
import { VillageGrid } from '../../src/villageGrid';

export class VillageSession {
  private grid: VillageGrid;

  constructor(
    /** URL de l'app, pour les liens de partage (`…/#v=<code>`). */
    readonly appUrl: string,
    size = 8,
  ) {
    this.grid = VillageSession.emptyGrid(size);
  }

  private static emptyGrid(size: number): VillageGrid {
    if (!Number.isInteger(size) || size < GRID_SIZE_MIN || size > GRID_SIZE_MAX) {
      throw new Error(`grid size must be an integer from ${GRID_SIZE_MIN} to ${GRID_SIZE_MAX}`);
    }
    return new VillageGrid(size, GRID_HEIGHT, size);
  }

  private checkColumn(x: number, z: number): void {
    const size = this.grid.width;
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= size || z >= size) {
      throw new Error(`column (${x}, ${z}) is outside the ${size}×${size} grid`);
    }
  }

  /** Hauteur d'une colonne en blocs posés (0 : libre). */
  height(x: number, z: number): number {
    const top = this.grid.getTopRealOccupiedY(x, z);
    return top === null ? 0 : top + 1;
  }

  /** Nouveau village vide, ou généré avec une graine (même graine → même village). */
  reset(size: number, seed?: number | null): void {
    this.grid = VillageSession.emptyGrid(size);
    if (seed !== undefined && seed !== null) this.grid.generateTerrain(size, seed);
  }

  /** Charge un village depuis un code `#v=…` ou une URL de partage. */
  load(codeOrUrl: string): void {
    const code = codeOrUrl.includes(`${HASH_KEY}=`) ? codeOrUrl.split(`${HASH_KEY}=`).pop()! : codeOrUrl;
    const village = decodeVillage(code.trim());
    if (!village) throw new Error('invalid village code or link');
    this.grid = VillageSession.emptyGrid(village.gridSize);
    this.grid.importBlocks(village.blocks);
    this.grid.setTerrain(village.terrain ?? DEFAULT_TERRAIN);
  }

  /** Pose `count` blocs sur la colonne, comme des clics ; renvoie la hauteur (y) de chacun. */
  build(x: number, z: number, count = 1): number[] {
    this.checkColumn(x, z);
    const placed: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const y = this.grid.getNextPlacementY(x, z, 0);
      if (y === null) break;
      this.grid.addBlock(x, y, z);
      placed.push(y);
    }
    return placed;
  }

  /** Retire `count` blocs du haut de la colonne ; renvoie la hauteur de chacun. */
  demolish(x: number, z: number, count = 1): number[] {
    this.checkColumn(x, z);
    const removed: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const y = this.grid.removeTopBlockInColumn(x, z);
      if (y === null) break;
      removed.push(y);
    }
    return removed;
  }

  /**
   * Bâtiment rectangulaire : chaque colonne de (x, z) à (x + width − 1,
   * z + depth − 1) monte à `storeys` étages habitables, plus le toit (le bloc
   * du sommet devient le toit). Une colonne déjà plus haute est laissée telle quelle.
   */
  buildRect(x: number, z: number, width: number, depth: number, storeys: number): number {
    if (!Number.isInteger(storeys) || storeys < 1 || storeys > GRID_HEIGHT - 1) {
      throw new Error(`storeys must be an integer from 1 to ${GRID_HEIGHT - 1}`);
    }
    if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 1 || depth < 1) {
      throw new Error('width and depth must be positive integers');
    }
    this.checkColumn(x, z);
    this.checkColumn(x + width - 1, z + depth - 1);
    let added = 0;
    for (let cx = x; cx < x + width; cx += 1) {
      for (let cz = z; cz < z + depth; cz += 1) {
        // storeys étages + le toit : blocs posés de y = 0 à y = storeys.
        for (let y = this.height(cx, cz); y <= storeys; y += 1) {
          this.grid.addBlock(cx, y, cz);
          added += 1;
        }
      }
    }
    return added;
  }

  /** Relève (`steps` > 0) ou creuse le terrain sous la case. */
  sculpt(x: number, z: number, steps: number): boolean {
    this.checkColumn(x, z);
    return this.grid.sculptTerrain(x, z, steps);
  }

  clear(): void {
    this.grid.clear();
  }

  village(): SavedVillage {
    return { gridSize: this.grid.width, blocks: this.grid.exportBlocks(), terrain: this.grid.terrain };
  }

  code(): string {
    return encodeVillage(this.village());
  }

  shareLink(): string {
    return `${this.appUrl.replace(/#.*$/, '')}#${HASH_KEY}=${this.code()}`;
  }

  describe(): VillageDescription {
    return describeVillage(this.grid);
  }
}
