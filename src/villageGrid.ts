import { BlockType, type CellCoordinate, type GridCell } from './types';
import { createValueNoise, seededRandom } from './utils/noise';

/** Taille (en cases) des "taches" du bruit : des îlots de ~3-4 cases. */
const NOISE_CELL_SCALE = 3.5;
/** Densité de bruit sous laquelle une case reste vide. */
const OCCUPANCY_THRESHOLD = 0.42;
/** Part minimale des cases constructibles (hors rues) à occuper. */
const MIN_OCCUPANCY = 0.4;
/** Probabilité qu'une colonne soit rehaussée de 2 étages. */
const LANDMARK_CHANCE = 0.06;
/** Largeur maximale (en cases) d'une rue enjambée par une arche automatique. */
export const MAX_ARCH_SPAN = 2;

/**
 * Indices de rangées laissées vides en guise de rues (grilles ≥ 6) : une
 * tous les 4-5 cases, avec un départ aléatoire.
 */
function pickStreets(size: number, random: () => number): Set<number> {
  const streets = new Set<number>();
  if (size < 6) return streets;
  for (let i = 2 + Math.floor(random() * 2); i < size - 1; i += 4 + Math.floor(random() * 2)) {
    streets.add(i);
  }
  return streets;
}

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
    this.occupy(cell);
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
    this.occupy(cell);
    this.recomputeProceduralLogic();
    return targetY;
  }

  public removeBlock(x: number, y: number, z: number): void {
    if (!this.isValidCoordinate(x, y, z)) {
      return;
    }

    this.grid[x][y][z].isOccupied = false;
    this.grid[x][y][z].type = BlockType.Empty;
    this.grid[x][y][z].placementOrder = -1;
    this.grid[x][y][z].isAutoRoof = false;
    this.grid[x][y][z].isAutoArch = false;
    this.recomputeProceduralLogic();
  }

  /**
   * Retire le bloc réel visible en haut de la colonne (jamais un cap de toit
   * auto-généré — il disparaît de lui-même au recalcul si plus rien ne le
   * justifie).
   *
   * Cas piégeux : si la colonne n'a que 2 étages réels, retirer le sommet la
   * laisse à 1 seul étage réel — ce qui fait *immédiatement* regénérer un cap
   * auto au même Y (règle "une colonne à 1 étage est toujours coiffée",
   * voir syncAutoRoofs). Le rendu est alors pixel-identique à avant le
   * retrait (les deux se dessinent en toit), donc le clic paraît n'avoir
   * rien fait — et il fallait auparavant re-cliquer pour voir un changement.
   * On détecte ce cas et on continue le retrait jusqu'à un changement
   * visible (ou colonne vide), pour qu'un clic = un changement visible, toujours.
   */
  public removeTopBlockInColumn(x: number, z: number): number | null {
    const firstY = this.getTopRealOccupiedY(x, z);
    if (firstY === null) {
      return null;
    }

    let y: number | null = firstY;
    while (y !== null) {
      this.removeBlock(x, y, z);
      if (!this.grid[x][y][z].isAutoRoof) {
        break;
      }
      y = this.getTopRealOccupiedY(x, z);
    }

    return firstY;
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
      const cell = this.grid[x][y][z];
      if (cell.isOccupied && !cell.isAutoArch) {
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
      if (cell.isOccupied && !cell.isAutoRoof && !cell.isAutoArch) {
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

  public clear(): void {
    this.nextPlacementOrder = 0;
    for (let x = 0; x < this.sizeX; x += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let z = 0; z < this.sizeZ; z += 1) {
          this.grid[x][y][z].isOccupied = false;
          this.grid[x][y][z].type = BlockType.Empty;
          this.grid[x][y][z].placementOrder = -1;
          this.grid[x][y][z].isAutoRoof = false;
          this.grid[x][y][z].isAutoArch = false;
        }
      }
    }
  }

  /**
   * Génère un village procédural sur les `gridSize` × `gridSize` premières
   * cases. Un bruit de valeur lissé décide de l'occupation et de la hauteur,
   * ce qui forme des îlots de bâtiments plutôt qu'un semis aléatoire ; sur
   * les grandes grilles, quelques rangées vides font office de rues. Même
   * graine → même village.
   */
  public generateTerrain(gridSize: number = this.sizeX, seed: number = Math.floor(Math.random() * 2 ** 32)): void {
    this.clear();

    const size = Math.max(1, Math.min(gridSize, this.sizeX, this.sizeZ));
    const random = seededRandom(seed);
    const noise = createValueNoise(seed);

    const streetsX = pickStreets(size, random);
    const streetsZ = pickStreets(size, random);
    // Hauteur max qui croît avec la grille (3 étages à 5, 5 à 12), sous le plafond de la grille.
    const maxHeight = Math.max(1, Math.min(this.sizeY - 1, 2 + Math.floor(size / 4)));

    // Un seul recalcul pour tout le terrain (et non un par bloc via addBlock).
    const blocks: Array<[number, number, number]> = [];
    const addColumn = (x: number, z: number, height: number) => {
      for (let y = 0; y < height; y += 1) blocks.push([x, y, z]);
    };

    const lots: Array<{ x: number; z: number; density: number }> = [];
    for (let x = 0; x < size; x += 1) {
      for (let z = 0; z < size; z += 1) {
        if (streetsX.has(x) || streetsZ.has(z)) continue;
        lots.push({ x, z, density: noise(x / NOISE_CELL_SCALE, z / NOISE_CELL_SCALE) });
      }
    }

    // Seuil abaissé si le bruit est trop "creux" sur cette graine : sur une
    // petite grille, une seule tache basse laisserait la parcelle presque vide.
    const byDensity = lots.map((lot) => lot.density).sort((a, b) => b - a);
    const minOccupied = Math.ceil(lots.length * MIN_OCCUPANCY);
    const threshold = Math.min(OCCUPANCY_THRESHOLD, byDensity[minOccupied - 1] ?? OCCUPANCY_THRESHOLD);

    for (const { x, z, density } of lots) {
      if (density < threshold) continue;

      const t = (density - threshold) / (1 - threshold);
      let height = 1 + Math.floor(t * maxHeight);
      // Quelques colonnes plus hautes, pour des repères (clochers, tours).
      if (random() < LANDMARK_CHANCE) height += 2;
      addColumn(x, z, Math.min(height, this.sizeY - 1));
    }

    // Jamais de parcelle vide : une colonne au centre à défaut.
    if (blocks.length === 0) {
      const center = Math.floor(size / 2);
      addColumn(center, center, Math.min(2, this.sizeY - 1));
    }

    this.importBlocks(blocks);
  }

  public get width(): number {
    return this.sizeX;
  }

  public get depth(): number {
    return this.sizeZ;
  }

  /**
   * Blocs réels (hors caps de toit auto) dans leur ordre de pose — de quoi
   * reconstruire la grille à l'identique via `importBlocks` (sauvegarde,
   * redimensionnement).
   */
  public exportBlocks(): Array<[number, number, number]> {
    return this.getOccupiedCells()
      .filter((cell) => !cell.isAutoRoof && !cell.isAutoArch)
      .sort((a, b) => a.placementOrder - b.placementOrder)
      .map((cell) => [cell.x, cell.y, cell.z]);
  }

  /**
   * Pose une liste de blocs (dans l'ordre donné) décalés de (offsetX, offsetZ),
   * en ignorant ceux hors grille, puis ne recalcule qu'une seule fois.
   */
  public importBlocks(blocks: ReadonlyArray<readonly [number, number, number]>, offsetX = 0, offsetZ = 0): void {
    for (const [bx, y, bz] of blocks) {
      const x = bx + offsetX;
      const z = bz + offsetZ;
      if (!this.isValidCoordinate(x, y, z)) {
        continue;
      }
      this.occupy(this.grid[x][y][z]);
    }
    this.recomputeProceduralLogic();
  }

  /**
   * Remplace tout le contenu par `blocks` (annuler/rétablir). Contrairement à
   * `clear()` + `importBlocks()`, les types des cellules sont conservés
   * jusqu'au recalcul : seules les cellules qui changent réellement rejouent
   * leur animation d'apparition.
   */
  public replaceBlocks(blocks: ReadonlyArray<readonly [number, number, number]>): void {
    this.nextPlacementOrder = 0;
    for (let x = 0; x < this.sizeX; x += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let z = 0; z < this.sizeZ; z += 1) {
          const cell = this.grid[x][y][z];
          cell.isOccupied = false;
          cell.isAutoRoof = false;
          cell.isAutoArch = false;
          cell.placementOrder = -1;
        }
      }
    }
    this.importBlocks(blocks);
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

  /**
   * Marque la cellule comme bloc réel posé par l'utilisateur. Un cap de toit
   * auto à cet endroit est "réclamé" : il devient un vrai bloc (sinon il
   * resterait exclu de la sauvegarde et ignoré par la démolition).
   */
  private occupy(cell: GridCell): void {
    if (cell.isOccupied && !cell.isAutoRoof && !cell.isAutoArch) {
      return;
    }
    cell.isOccupied = true;
    cell.isAutoRoof = false;
    cell.isAutoArch = false;
    cell.placementOrder = this.nextPlacementOrder;
    this.nextPlacementOrder += 1;
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
          if (this.grid[x][y][z].isOccupied && !this.grid[x][y][z].isAutoArch) {
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
          if (cell.isOccupied && !cell.isAutoRoof && !cell.isAutoArch) {
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

  /**
   * Arches automatiques. Une rue de 1 à MAX_ARCH_SPAN cases (jamais plus), ouverte au sol,
   * entre deux bâtiments qui se font face avec au moins deux niveaux visibles
   * (occupés en y = 0 et y = 1, cap de toit compris : une maison d'un clic
   * suffit) est enjambée par une arche au premier étage. Une seule arche par
   * tronçon de rue, au milieu, pour ne pas transformer la rue en tunnel.
   *
   * Comme les caps de toit, ce ne sont pas des blocs de l'utilisateur : elles
   * apparaissent et disparaissent avec les bâtiments qui les portent, ne sont
   * pas sauvegardées, et un clic dans la ruelle bâtit toujours au sol.
   */
  private syncAutoArches(): void {
    const ARCH_Y = 1;
    if (this.sizeY < ARCH_Y + 1) return;

    // Occupation "réelle" pour la règle : les arches auto elles-mêmes ne comptent pas.
    const solid = (x: number, y: number, z: number) => {
      const cell = this.getNeighborCell(x, y, z);
      return !!cell && cell.isOccupied && !cell.isAutoArch;
    };

    // Porteur : bâti au sol et au premier étage. Passage : vide aux deux niveaux.
    const support = (x: number, z: number) => solid(x, 0, z) && solid(x, ARCH_Y, z);
    const open = (x: number, z: number) =>
      this.isValidCoordinate(x, 0, z) && !solid(x, 0, z) && !solid(x, ARCH_Y, z);

    const wanted = new Set<string>();
    /**
     * Rues enjambées selon un axe. `at(o, i)` → (x, z), `i` le long de la
     * portée, `o` le long de la rue. Dans chaque rangée, un passage = cases
     * ouvertes consécutives (1 à MAX_ARCH_SPAN) bordées par deux porteurs ; les
     * passages identiques de rangées voisines forment un tronçon de rue, dont
     * on couvre la rangée du milieu.
     */
    const collect = (outer: number, inner: number, at: (o: number, i: number) => [number, number]) => {
      const gapsByRow: Array<Array<[number, number]>> = [];
      for (let o = 0; o < outer; o += 1) {
        const gaps: Array<[number, number]> = [];
        for (let i = 1; i < inner - 1; i += 1) {
          if (!support(...at(o, i - 1)) || !open(...at(o, i))) continue;
          let end = i;
          while (end + 1 < inner && open(...at(o, end + 1))) end += 1;
          if (end + 1 < inner && support(...at(o, end + 1)) && end - i + 1 <= MAX_ARCH_SPAN) {
            gaps.push([i, end]);
          }
          i = end;
        }
        gapsByRow.push(gaps);
      }

      const taken = (o: number, [a, b]: [number, number]) => {
        for (let i = a; i <= b; i += 1) if (wanted.has(at(o, i).join(','))) return true;
        return false;
      };
      const done = new Set<string>();
      for (let o = 0; o < outer; o += 1) {
        for (const gap of gapsByRow[o]) {
          const id = `${gap[0]}-${gap[1]}`;
          if (done.has(`${o}|${id}`)) continue;
          let last = o;
          while (last + 1 < outer && gapsByRow[last + 1].some(([a, b]) => `${a}-${b}` === id)) last += 1;
          for (let r = o; r <= last; r += 1) done.add(`${r}|${id}`);
          const row = o + Math.floor((last - o) / 2);
          if (taken(row, gap)) continue; // carrefour : déjà couvert dans l'autre sens
          for (let i = gap[0]; i <= gap[1]; i += 1) wanted.add(at(row, i).join(','));
        }
      }
    };
    collect(this.sizeZ, this.sizeX, (z, x) => [x, z]); // portée selon X
    collect(this.sizeX, this.sizeZ, (x, z) => [x, z]); // portée selon Z

    for (let x = 0; x < this.sizeX; x += 1) {
      for (let z = 0; z < this.sizeZ; z += 1) {
        const cell = this.grid[x][ARCH_Y][z];
        const want = wanted.has(`${x},${z}`);
        if (cell.isAutoArch && !want) {
          cell.isOccupied = false;
          cell.isAutoArch = false;
          cell.type = BlockType.Empty;
        } else if (want && !cell.isOccupied) {
          cell.isOccupied = true;
          cell.isAutoArch = true;
        }
      }
    }
  }

  private recomputeProceduralLogic(): void {
    // Toits → arches → toits : les arches s'appuient sur les caps de toit des
    // maisons d'un étage (il faut qu'ils existent déjà), et une arche qui
    // disparaît (passage bâti) doit laisser sa place au cap de la colonne
    // dans la même passe — sinon le résultat dépendrait de l'ordre des clics.
    this.syncAutoRoofs();
    this.syncAutoArches();
    this.syncAutoRoofs();

    const now = performance.now() / 1000;

    for (let x = 0; x < this.sizeX; x += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let z = 0; z < this.sizeZ; z += 1) {
          const cell = this.grid[x][y][z];

          if (!cell.isOccupied) {
            cell.type = BlockType.Empty;
            continue;
          }

          const prevType = cell.type;

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
            const hasWindowOnSameFloor = this.hasWindowOnSameFloor(x, y, z);
            cell.type = hasWindowOnSameFloor ? BlockType.Wall : BlockType.WallWithWindow;
          } else {
            // Murs pleins pour les intérieurs
            cell.type = BlockType.Wall;
          }

          // Bloc neuf ou dont la forme a changé (ex: mur devenu toit après
          // démolition du voisin) → rejoue la transition d'apparition.
          if (cell.type !== prevType) {
            cell.spawnedAt = now;
          }
        }
      }
    }
  }

  private isSimpleArch(x: number, y: number, z: number,
                     hasLeft: boolean, hasRight: boolean,
                     hasFront: boolean, hasBack: boolean): boolean {
    // Deux voisins opposés sur un seul axe, et rien dessous (le passage).
    // Pas d'exigence de murs au-dessus : entre deux maisons d'un étage, le
    // voisin porteur est un toit (cap auto) — l'arche s'y adosse quand même.
    const oppositePairs = (
      (hasLeft && hasRight) ? 1 : 0
    ) + (
      (hasFront && hasBack) ? 1 : 0
    );

    if (oppositePairs !== 1) return false;

    const hasSupportBelow = this.getNeighborCell(x, y - 1, z)?.isOccupied ?? false;
    if (hasSupportBelow) return false;

    return true;
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
   * Règle "une seule fenêtre par étage entre blocs adjacents", appliquée en
   * glouton dans l'ordre de parcours de `recomputeProceduralLogic` (x, puis
   * y, puis z). On ne regarde donc que les voisins (x-1) et (z-1), déjà typés
   * pendant CETTE passe : les voisins (x+1)/(z+1) portent encore le type de
   * la passe précédente, ce qui faisait dépendre les fenêtres de l'ordre des
   * clics. Ainsi le résultat ne dépend que de la forme du village. Les
   * voisins (x+1)/(z+1) feront à leur tour le test contre cette cellule.
   */
  private hasWindowOnSameFloor(x: number, y: number, z: number): boolean {
    const leftCell = this.getNeighborCell(x - 1, y, z);
    const frontCell = this.getNeighborCell(x, y, z - 1);
    return (
      (leftCell?.isOccupied === true && leftCell.type === BlockType.WallWithWindow) ||
      (frontCell?.isOccupied === true && frontCell.type === BlockType.WallWithWindow)
    );
  }
}

// La grille vit dans un useState d'App : un remplacement à chaud garderait
// l'instance existante, donc l'ancien code des règles (arches, toits…).
// Toute modification de ce module recharge donc la page.
import.meta.hot?.accept(() => window.location.reload());
