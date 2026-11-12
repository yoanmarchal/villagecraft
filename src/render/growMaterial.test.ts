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
    const interior = vertex.indexOf('vInteriorMode = mod(aCell.w, 4.0)');
    const project = vertex.indexOf('#include <project_vertex>');
    expect(grow).toBeGreaterThan(0);
    expect(interior).toBeGreaterThan(grow);
    expect(project).toBeGreaterThan(interior);
    expect(vertex.indexOf('attribute vec4 aCell')).toBeLessThan(grow);

    const fragment = shader.fragmentShader;
    expect(fragment).toContain('uniform vec3 uInteriorLight');
    expect(fragment.indexOf('uInteriorLight * interiorLight')).toBeGreaterThan(
      fragment.indexOf('#include <emissivemap_fragment>'),
    );
    expect(shader.uniforms.uInteriorLight).toBe(set.interiorLight);
  });

  it('adds the procedural surface detail only when asked, under its own program key', () => {
    const plain = createGrowMaterialSet({});
    const detailed = createGrowMaterialSet({}, { detail: true });
    expect(compile(plain.material, THREE.ShaderLib.standard).fragmentShader).not.toContain('vcFbm');

    const shader = compile(detailed.material, THREE.ShaderLib.standard);
    const fragment = shader.fragmentShader;
    // Albédo après la couleur de sommet, relief après la normale, le tout
    // déclaré avant `main` — et la position monde prise après l'animation.
    expect(fragment.indexOf('float vcFbm')).toBeLessThan(fragment.indexOf('void main()'));
    expect(fragment.indexOf('vcDetailBlotch = vcFbm')).toBeGreaterThan(fragment.indexOf('#include <color_fragment>'));
    expect(fragment.indexOf('normal = vcBumpNormal')).toBeGreaterThan(
      fragment.indexOf('#include <normal_fragment_maps>'),
    );
    expect(fragment.indexOf('normal = vcBumpNormal')).toBeLessThan(
      fragment.indexOf('#include <lights_physical_fragment>'),
    );
    expect(shader.vertexShader.indexOf('vDetailPos = transformed')).toBeGreaterThan(
      shader.vertexShader.indexOf('growFallHeight'),
    );

    // three met en cache les programmes par texte de onBeforeCompile : les deux variantes doivent différer.
    expect(detailed.material.customProgramCacheKey()).not.toBe(plain.material.customProgramCacheKey());
  });

  it('gives mortar backing its own program', () => {
    const detailed = createGrowMaterialSet({}, { detail: true });
    const masonry = createGrowMaterialSet({}, { detail: true, masonry: true });

    // Le bloc est compilé partout mais gardé par un define, posé sur la seule variante maçonnée.
    const fragment = compile(detailed.material, THREE.ShaderLib.standard).fragmentShader;
    expect(fragment).toContain('#ifdef VC_MASONRY');
    expect(detailed.material.defines ?? {}).not.toHaveProperty('VC_MASONRY');
    expect(masonry.material.defines).toHaveProperty('VC_MASONRY');
    expect(masonry.material.defines).toHaveProperty('VC_CAVITY_HALF_WIDTH');
    // Plus aucun motif de couverture dessiné : tuiles et ardoises sont de la géométrie.
    expect(fragment).not.toContain('VC_ROOFING');
    expect(masonry.material.customProgramCacheKey()).not.toBe(detailed.material.customProgramCacheKey());
  });

  it('only animates the depth material (no interior light in shadows)', () => {
    const set = createGrowMaterialSet({});
    const shader = compile(set.depthMaterial, THREE.ShaderLib.depth);

    expect(shader.vertexShader).toContain('growFallHeight');
    expect(shader.vertexShader).not.toContain('vInterior');
  });
});
