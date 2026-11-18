import { describe, expect, it } from 'vitest';
import { scatterTrees, TREE_TRUNKS } from '../render/landscape';
import { treeTrunkBoxes } from './treeColliders';
import { createBoxWorld } from './walkWorld';
import { isFree } from './walker';

describe('treeTrunkBoxes', () => {
  it('stands a box on every trunk, narrower than its foot, and the walker cannot stand in it', () => {
    const trees = scatterTrees(8, 40, 60);
    const boxes = treeTrunkBoxes(trees);
    expect(boxes).toHaveLength(trees.length * 6);
    const world = createBoxWorld(boxes, () => 0, 100);
    trees.slice(0, 50).forEach((tree, i) => {
      const [x0, y0, z0, x1, y1, z1] = boxes.slice(i * 6, i * 6 + 6);
      expect(x0 < tree.x && tree.x < x1 && z0 < tree.z && tree.z < z1).toBe(true);
      expect(y0).toBeLessThan(tree.y);
      expect(y1).toBeGreaterThan(tree.y + 0.7);
      expect(x1 - x0).toBeLessThan(2 * TREE_TRUNKS[tree.kind].radius * 1.5);
      expect(isFree(world, tree.x, tree.y, tree.z)).toBe(false);
    });
  });
});
