import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGrowMaterialSet } from './growMaterial';

/** Applique `onBeforeCompile` aux vrais sources de three, comme le ferait le renderer. */
function compile(material: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) {
  const shader = {
    uniforms: {},
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('growMaterial shader injection', () => {
  it('injects grow + interior light into the standard material, in order', () => {
    const set = createGrowMaterialSet({});
    const shader = compile(set.material, THREE.ShaderLib.standard);

    const vertex = shader.vertexShader;
    const grow = vertex.indexOf('growFallHeight');
    const interior = vertex.indexOf('vInterior = 0.0');
    const project = vertex.indexOf('#include <project_vertex>');
    expect(grow).toBeGreaterThan(0);
    expect(interior).toBeGreaterThan(grow);
    expect(project).toBeGreaterThan(interior);
    expect(vertex.indexOf('attribute vec4 aCell')).toBeLessThan(grow);

    const fragment = shader.fragmentShader;
    expect(fragment).toContain('uniform vec3 uInteriorLight');
    expect(fragment.indexOf('uInteriorLight * vInterior')).toBeGreaterThan(fragment.indexOf('#include <emissivemap_fragment>'));
    expect(shader.uniforms.uInteriorLight).toBe(set.interiorLight);
  });

  it('only animates the depth material (no interior light in shadows)', () => {
    const set = createGrowMaterialSet({});
    const shader = compile(set.depthMaterial, THREE.ShaderLib.depth);

    expect(shader.vertexShader).toContain('growFallHeight');
    expect(shader.vertexShader).not.toContain('vInterior');
  });
});
