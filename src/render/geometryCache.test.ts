import { describe, expect, it } from 'vitest';
import { boxGeo, geometryCacheSize } from './geometryCache';

describe('geometryCache', () => {
  it('partage la même géométrie pour les mêmes paramètres', () => {
    expect(boxGeo(1, 2, 3)).toBe(boxGeo(1, 2, 3));
  });

  it('reste borné et garde les géométries récemment utilisées', () => {
    const hot = boxGeo(0.123, 0.456, 0.789);
    for (let i = 0; i < 5000; i += 1) {
      boxGeo(1 + i / 10000, 1, 1);
      if (i % 100 === 0) boxGeo(0.123, 0.456, 0.789); // toujours "chaude"
    }

    expect(geometryCacheSize()).toBeLessThanOrEqual(1500);
    expect(boxGeo(0.123, 0.456, 0.789)).toBe(hot);
  });
});
