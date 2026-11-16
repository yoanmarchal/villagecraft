/**
 * Uniforms du relief (`RELIEF_GLSL`, relief.ts), partagés par tous les
 * matériaux du village et réglés en place quand le terrain change.
 */

import * as THREE from 'three';
import { WAVE_COUNT, type Relief } from './relief';

export interface ReliefUniforms {
  /** (amplitude, rayon intérieur, rayon extérieur). */
  uRelief: { value: THREE.Vector3 };
  /** Par ondulation : (kx, kz, phase, amplitude). */
  uReliefWaves: { value: THREE.Vector4[] };
  /** Modelage cuit (canal rouge, demi-flottant) ; un texel nul sans modelage. */
  uSculpt: { value: THREE.DataTexture };
  /** (demi-côté du treillis, nœuds par côté). */
  uSculptMap: { value: THREE.Vector2 };
}

/**
 * Texture du modelage : demi-flottants (filtrage linéaire garanti en WebGL 2,
 * contrairement aux flottants 32 bits), un texel par nœud du treillis.
 */
function sculptTexture(heights: Float32Array | null, n: number): THREE.DataTexture {
  const data = new Uint16Array(n * n);
  if (heights) for (let i = 0; i < data.length; i += 1) data[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const texture = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createReliefUniforms(): ReliefUniforms {
  return {
    uRelief: { value: new THREE.Vector3(0, 1, 2) },
    uReliefWaves: { value: Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4()) },
    uSculpt: { value: sculptTexture(null, 1) },
    uSculptMap: { value: new THREE.Vector2(0, 1) },
  };
}

export function updateReliefUniforms(uniforms: ReliefUniforms, relief: Relief): void {
  uniforms.uRelief.value.set(relief.amplitude, relief.inner, relief.outer);
  relief.waves.forEach(({ a, kx, kz, phase }, i) => uniforms.uReliefWaves.value[i].set(kx, kz, phase, a));
  uniforms.uSculpt.value.dispose();
  uniforms.uSculpt.value = sculptTexture(relief.sculpt?.heights ?? null, relief.sculpt?.n ?? 1);
  uniforms.uSculptMap.value.set(relief.sculpt?.half ?? 0, relief.sculpt?.n ?? 1);
}

export function disposeReliefUniforms(uniforms: ReliefUniforms): void {
  uniforms.uSculpt.value.dispose();
}
