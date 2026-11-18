/**
 * Troncs d'arbres du paysage, obstacles du promeneur : une boîte par tronc,
 * un peu plus étroite que son pied (le tronc s'affine en montant), du sol à
 * la tête du tronc. Les houppiers, au-dessus de la tête, ne gênent pas.
 */

import { TREE_TRUNKS, treeScale, type TreeInstance } from '../render/landscape';

/** Part du rayon au pied gardée pour la boîte (entre pied et tête du tronc, à hauteur d'homme). */
const TRUNK_FIT = 0.8;

/** Boîtes des troncs, 6 nombres chacune (min puis max), au format de `createBoxWorld`. */
export function treeTrunkBoxes(trees: readonly TreeInstance[]): number[] {
  const boxes: number[] = [];
  for (const tree of trees) {
    const { radius, height } = TREE_TRUNKS[tree.kind];
    const scale = treeScale(tree);
    const half = radius * scale.girth * TRUNK_FIT;
    boxes.push(tree.x - half, tree.y - 1, tree.z - half, tree.x + half, tree.y + height * scale.height, tree.z + half);
  }
  return boxes;
}
