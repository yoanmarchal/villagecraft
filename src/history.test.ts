import { describe, expect, it } from 'vitest';
import { History } from './history';

const make = (limit?: number) => new History<number>(0, (a, b) => a === b, limit);

describe('History', () => {
  it('annule puis rétablit dans l’ordre', () => {
    const history = make();
    history.record(1);
    history.record(2);

    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(1);
    expect(history.redo()).toBe(2);
    expect(history.redo()).toBeNull();
  });

  it('ignore un état identique au courant', () => {
    const history = make();
    expect(history.record(0)).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it('un nouvel état après une annulation efface la branche "rétablir"', () => {
    const history = make();
    history.record(1);
    history.record(2);
    history.undo();
    history.record(3);

    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe(1);
  });

  it('borne le nombre d’états conservés', () => {
    const history = make(3);
    for (let i = 1; i <= 10; i += 1) history.record(i);

    expect(history.undo()).toBe(9);
    expect(history.undo()).toBe(8);
    expect(history.canUndo).toBe(false);
  });
});
