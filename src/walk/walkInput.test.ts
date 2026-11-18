import { describe, expect, it } from 'vitest';
import { inputFromKeys } from './walkInput';

describe('inputFromKeys', () => {
  it('reads physical keys: WASD on QWERTY is ZQSD on AZERTY', () => {
    expect(inputFromKeys(new Set(['KeyW', 'KeyD']), 1)).toEqual({
      forward: 1,
      strafe: 1,
      yaw: 1,
      run: false,
      jump: false,
    });
    expect(inputFromKeys(new Set(['KeyS', 'KeyA', 'ShiftLeft', 'Space']), 0)).toMatchObject({
      forward: -1,
      strafe: -1,
      run: true,
      jump: true,
    });
  });

  it('cancels opposite keys and accepts the arrows', () => {
    expect(inputFromKeys(new Set(['KeyW', 'ArrowDown']), 0).forward).toBe(0);
    expect(inputFromKeys(new Set(['ArrowLeft']), 0).strafe).toBe(-1);
  });
});
