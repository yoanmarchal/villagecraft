Cahier des Charges : Projet "villagecraft"
1. Présentation du Projet
L'objectif est de développer une application web interactive en 3D permettant à l'utilisateur de générer un village de manière organique et procédurale. En cliquant sur une grille, l'utilisateur pose des blocs élémentaires, et l'application calcule automatiquement la forme visuelle la plus logique (maison, toit, arche, escalier) en fonction de l'environnement direct.

2. Architecture Technique & Stack Cible
Pour respecter un cadre robuste et performant, nous utiliserons des technologies fortement typées et éprouvées pour la 3D sur le web :

Langage : TypeScript (impératif pour la clarté des structures de données et des types de blocs).

Moteur 3D : Three.js (via la bibliothèque @react-three/fiber si tu utilises React, ou en TypeScript pur pour un contrôle total).

Bundler : Vite.js (rapide et moderne).

3. Spécifications Fonctionnelles
A. Le Système de Grille (Le Monde)
Le monde est représenté par une grille en 3D (X, Y, Z) de taille définie (ex: 20x20x10).

Chaque case de la grille (un "Voxel") peut être soit vide, soit occupée par un élément de construction.

B. L'Algorithme Génératif (Le Cœur du Jeu)
Pour que le village se génère "tout seul", le programme doit analyser les voisins de chaque bloc posé :

Si un bloc est seul sur le sol : Il devient une maison simple avec un toit.

Si on empile un bloc sur une maison : Le bloc du dessous perd son toit et devient un étage, le bloc du dessus prend le toit.

Si deux blocs sont côte à côte en hauteur mais vides en dessous : L'algorithme génère une arche ou un pont entre les deux.

Note technique : Pour un rendu parfait, on utilise souvent une version simplifiée de l'algorithme WFC (Wave Function Collapse) ou un système de "Marching Cubes" / "Auto-tiling 3D".

C. Interactions Utilisateur (UI/UX)
Clic gauche : Ajouter un bloc sur la case survolée.

Clic droit : Supprimer le bloc visé.

Caméra : Rotation et zoom à la souris (OrbitControls).

4. Spécifications Techniques & Modélisation (TypeScript)
Pour te lancer, voici comment structurer tes données de manière fortement typée. C'est la base de ton moteur de génération.

Les Types de Blocs (Enum)
TypeScript
export enum BlockType {
  Empty = "EMPTY",
  Foundation = "FOUNDATION",
  Wall = "WALL",
  WallWithWindow = "WALL_WINDOW",
  Roof = "ROOF",
  Arch = "ARCH"
}
La Structure d'une Case (Interface)
TypeScript
export interface GridCell {
  x: number;
  y: number;
  z: number;
  isOccupied: boolean;
  type: BlockType;
  color?: string;
}
Le Gestionnaire de Grille (Classe)
Voici la classe principale qui stocke le village et contient la fonction magique updateCellNeighbours qui va décider quel modèle 3D afficher.

TypeScript
export class VillageGrid {
  private sizeX: number;
  private sizeY: number;
  private sizeZ: number;
  private grid: GridCell[][][];

  constructor(sx: number, sy: number, sz: number) {
    this.sizeX = sx;
    this.sizeY = sy;
    this.sizeZ = sz;
    this.grid = this.createEmptyGrid();
  }

  private createEmptyGrid(): GridCell[][][] {
    const tempGrid: GridCell[][][] = [];
    for (let x = 0; x < this.sizeX; x++) {
      tempGrid[x] = [];
      for (let y = 0; y < this.sizeY; y++) {
        tempGrid[x][y] = [];
        for (let z = 0; z < this.sizeZ; z++) {
          tempGrid[x][y][z] = { x, y, z, isOccupied: false, type: BlockType.Empty };
        }
      }
    }
    return tempGrid;
  }

  public addBlock(x: number, y: number, z: number): void {
    if (this.isValidCoordinate(x, y, z)) {
      this.grid[x][y][z].isOccupied = true;
      this.updateProceduralLogic(x, y, z);
    }
  }

  private updateProceduralLogic(x: number, y: number, z: number): void {
    const currentCell = this.grid[x][y][z];
    const cellBelow = this.isValidCoordinate(x, y - 1, z) ? this.grid[x][y - 1][z] : null;

    // Logique simplifiée : si c'est au sol (y=0), c'est une fondation ou un mur
    if (y === 0) {
      currentCell.type = BlockType.Foundation;
    } else if (cellBelow && cellBelow.isOccupied) {
      currentCell.type = BlockType.Roof;
      // Le bloc d'en dessous perd son statut de toit et devient un mur simple
      if (cellBelow.type === BlockType.Roof) {
        cellBelow.type = BlockType.Wall;
      }
    }
    
    // TODO: Analyser les voisins (X+1, X-1, Z+1, Z-1) pour créer des fenêtres ou des arches
  }

  private isValidCoordinate(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  public getGrid(): GridCell[][][] {
    return this.grid;
  }
}
5. Étapes de Développement Recommandées (Feuille de route)
Étape 1 : Mettre en place la scène 3D (Three.js) avec une grille de cubes de base (des boîtes grises) pour valider le clic et l'ajout/suppression.

Étape 2 : Implémenter la classe VillageGrid en TypeScript pour gérer l'état de la grille.

Étape 3 : Écrire les règles algorithmiques (si j'ai un voisin à gauche et à droite, alors mon type change).

Étape 4 : Remplacer les cubes gris par de vrais petits assets 3D (faits sur Blender ou trouvés en ligne : un petit toit rouge, un mur en pierre, une arche).