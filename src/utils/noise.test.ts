import { describe, expect, it } from 'vitest';
import { createValueNoise, seededRandom } from './noise';

describe('seededRandom', () => {
  it('est déterministe et dans [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('createValueNoise', () => {
  const noise = createValueNoise(7);

  it('est déterministe et dans [0, 1]', () => {
    const again = createValueNoise(7);
    for (let x = -5; x < 5; x += 0.37) {
      for (let z = -5; z < 5; z += 0.41) {
        const value = noise(x, z);
        expect(value).toBe(again(x, z));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('est continu : deux points proches ont des valeurs proches', () => {
    for (let x = 0; x < 10; x += 0.5) {
      expect(Math.abs(noise(x, 3) - noise(x + 0.01, 3))).toBeLessThan(0.05);
    }
  });

  it('varie selon la graine', () => {
    const other = createValueNoise(8);
    const differs = Array.from({ length: 20 }, (_, i) => noise(i * 0.7, 1.3) !== other(i * 0.7, 1.3));
    expect(differs.some(Boolean)).toBe(true);
  });
});
