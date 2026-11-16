import { describe, expect, it } from 'vitest';
import {
  insideIntervals,
  offsetPolygon,
  outsideSpans,
  outsideSpansOfBeam,
  pointInPolygon,
  polygonInside,
  polygonsOverlap,
  rect,
  signedArea,
  type Polygon,
} from './polygon';

/** L de trémie : bras le long de x = 1 et de z = 1. */
const L: Polygon = [
  [0.5, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0.5],
  [0.5, 0.5],
];

describe('polygon', () => {
  it('measures the signed area and tells inside from outside, concave shapes included', () => {
    expect(signedArea(rect(0, 0, 2, 1))).toBeCloseTo(2);
    expect(Math.abs(signedArea(L))).toBeCloseTo(0.75);
    expect(pointInPolygon([0.75, 0.25], L)).toBe(true);
    expect(pointInPolygon([0.25, 0.75], L)).toBe(true);
    expect(pointInPolygon([0.25, 0.25], L)).toBe(false); // le creux du L
  });

  it('detects overlaps: crossing edges, containment, but not mere neighbours', () => {
    expect(polygonsOverlap(rect(0, 0, 1, 1), rect(0.5, 0.5, 2, 2))).toBe(true);
    expect(polygonsOverlap(rect(0, 0, 3, 3), rect(1, 1, 2, 2))).toBe(true);
    expect(polygonsOverlap(rect(0, 0, 1, 1), rect(0, 0, 1, 1))).toBe(true);
    expect(polygonsOverlap(rect(0.1, 0.1, 0.4, 0.4), L)).toBe(false);
    expect(polygonsOverlap(rect(2, 2, 3, 3), rect(0, 0, 1, 1))).toBe(false);
  });

  it('checks that a polygon lies within another', () => {
    expect(polygonInside(rect(0.6, 0.1, 0.9, 0.9), L)).toBe(true);
    // Sommets tous dans le L, mais le bord traverse son creux.
    expect(
      polygonInside(
        [
          [0.7, 0.1],
          [0.1, 0.7],
          [0.7, 0.7],
        ],
        L,
      ),
    ).toBe(false);
  });

  it('cuts segments and beams around holes', () => {
    expect(insideIntervals([-1, 0.25], [2, 0.25], L)).toEqual([[0.5, 2 / 3]]);
    // Une solive qui traverse le bras du L : deux tronçons hors trémie.
    const spans = outsideSpans([-1, 0.75], [2, 0.75], [L]);
    expect(spans.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    // Une poutre de 0,2 de large dont l'axe longe le bord du creux (z = 0,45) mord sur le L.
    const beam = outsideSpansOfBeam([-1, 0.45], [2, 0.45], 0.1, [L]);
    expect(beam.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('offsets polygons outwards, concave corners included', () => {
    const grown = offsetPolygon(rect(0, 0, 1, 1), 0.1);
    expect(grown.map(([x, z]) => [+x.toFixed(6), +z.toFixed(6)])).toEqual([
      [-0.1, -0.1],
      [1.1, -0.1],
      [1.1, 1.1],
      [-0.1, 1.1],
    ]);
    const shrunk = offsetPolygon(L, -0.05);
    expect(pointInPolygon([0.52, 0.52], shrunk)).toBe(false);
    expect(pointInPolygon([0.57, 0.57], shrunk)).toBe(true);
    expect(Math.abs(signedArea(shrunk))).toBeLessThan(0.75);
  });
});
