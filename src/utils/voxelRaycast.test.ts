import { describe, expect, it } from 'vitest';
import { raycastVoxels, targetColumn, type Vec3 } from './voxelRaycast';

const SIZE: Vec3 = [5, 10, 5];
const solidSet = (...cells: Vec3[]) => {
  const keys = new Set(cells.map((c) => c.join(',')));
  return (x: number, y: number, z: number) => keys.has(`${x},${y},${z}`);
};

describe('raycastVoxels', () => {
  it('hits the top face of a block from above', () => {
    const hit = raycastVoxels([2.5, 20, 2.5], [0, -1, 0], SIZE, solidSet([2, 0, 2], [2, 1, 2]));
    expect(hit).toEqual({ x: 2, y: 1, z: 2, normal: [0, 1, 0] });
  });

  it('stops at the first block in front, not at the ground behind it', () => {
    // Tour de 3 étages en x = 1 ; le rayon descend en biais vers x = 4.
    const isSolid = solidSet([1, 0, 2], [1, 1, 2], [1, 2, 2], [4, 0, 2]);
    const hit = raycastVoxels([-3, 2.5, 2.5], [1, -0.1, 0], SIZE, isSolid);
    expect(hit).toEqual({ x: 1, y: 2, z: 2, normal: [-1, 0, 0] });
  });

  it('enters the grid from outside on the right face', () => {
    const hit = raycastVoxels([10, 0.5, 3.5], [-1, 0, 0], SIZE, solidSet([4, 0, 3]));
    expect(hit).toEqual({ x: 4, y: 0, z: 3, normal: [1, 0, 0] });
  });

  it('returns null when the ray misses every block or the grid', () => {
    expect(raycastVoxels([2.5, 20, 2.5], [0, -1, 0], SIZE, solidSet([0, 0, 0]))).toBeNull();
    expect(raycastVoxels([-5, 5, -5], [-1, 0, 0], SIZE, () => true)).toBeNull();
  });

  it('handles diagonal rays through cell edges', () => {
    const hit = raycastVoxels([0.5, 9.5, 0.5], [1, -1, 1], SIZE, solidSet([3, 6, 3]));
    expect(hit?.x).toBe(3);
    expect(hit?.y).toBe(6);
    expect(hit?.z).toBe(3);
  });
});

describe('targetColumn', () => {
  const hit = { x: 2, y: 3, z: 2, normal: [1, 0, 0] as Vec3 };

  it('builds next to a wall that was clicked on its side', () => {
    expect(targetColumn(hit, true, 5, 5)).toEqual({ x: 3, z: 2 });
  });

  it('demolishes the clicked column itself', () => {
    expect(targetColumn(hit, false, 5, 5)).toEqual({ x: 2, z: 2 });
  });

  it('builds on top when the top face is clicked, or when the side neighbour is off the grid', () => {
    expect(targetColumn({ ...hit, normal: [0, 1, 0] }, true, 5, 5)).toEqual({ x: 2, z: 2 });
    expect(targetColumn({ ...hit, x: 4 }, true, 5, 5)).toEqual({ x: 4, z: 2 });
  });
});
