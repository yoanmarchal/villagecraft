/**
 * CellContext — tout ce qu'un builder de cellule a besoin de savoir sur ses
 * voisins, calculé UNE seule fois par cellule dans buildVillage.ts.
 * (Avant : chaque cell component recalculait getExposedFaces/getCornerRadii,
 * parfois plusieurs fois.)
 */

import type { GridCell } from '../../types';
import type { CellFace, CellLookup, CornerRadii } from '../../utils/cellUtils';
import type { RenderSettings } from '../renderSettings';

export interface CellContext {
  cell: GridCell;
  lookup: CellLookup;
  /** Réglages de style (couleurs, rugosités, formes) — ne jamais lire le store dans un builder. */
  settings: RenderSettings;
  exposedFaces: CellFace[];
  radii: CornerRadii;
  /**
   * Murs/fondations : `isTowerColumn` (propagation vers le bas, intentionnelle).
   * Toits : `isIsolatedBlock` (non propagé). Cette asymétrie est délibérée —
   * voir AGENTS.md.
   */
  isIsolated: boolean;
  /**
   * La colonne est une courtine (mur d'une case tendu entre deux structures
   * plus hautes, voir `isRampart`) : son sommet reçoit un parapet crénelé,
   * ses murs des meurtrières au lieu de fenêtres.
   */
  isRampart: boolean;
}
