/**
 * Détail de surface procédural — bruit 3D évalué par fragment, en espace
 * monde, sans aucune texture ni UV (les géométries fusionnées n'en ont pas).
 *
 * Les couleurs du village sont plates par part : seules, elles donnent un
 * rendu "jouet". On module donc l'albédo (taches, patine, grain), la rugosité
 * et la normale (relief) avec un bruit continu d'un bloc à l'autre, et on
 * salit le pied des murs. Partagé par les matériaux du village
 * (growMaterial.ts) et par le terrain (Terrain.tsx).
 */

/** Bruit de valeur 3D + fbm 3 octaves (≈ 0 – 0.875, moyenne ≈ 0.44). */
export const NOISE_GLSL = `
  float vcHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vcNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(vcHash(i), vcHash(i + vec3(1, 0, 0)), f.x),
          mix(vcHash(i + vec3(0, 1, 0)), vcHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(vcHash(i + vec3(0, 0, 1)), vcHash(i + vec3(1, 0, 1)), f.x),
          mix(vcHash(i + vec3(0, 1, 1)), vcHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float vcFbm(vec3 p) {
    float amplitude = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 3; i++) {
      sum += amplitude * vcNoise(p);
      p = p * 2.03 + 7.1;
      amplitude *= 0.5;
    }
    return sum;
  }

  // Normale perturbée par une hauteur procédurale (gradient de surface de
  // Mikkelsen, dérivées écran) : \`height\` en unités monde.
  vec3 vcBumpNormal(vec3 surfacePos, vec3 surfaceNormal, float height) {
    vec3 sigmaX = dFdx(surfacePos);
    vec3 sigmaY = dFdy(surfacePos);
    vec3 r1 = cross(sigmaY, surfaceNormal);
    vec3 r2 = cross(surfaceNormal, sigmaX);
    float det = dot(sigmaX, r1);
    vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(abs(det) * surfaceNormal - gradient);
  }
`;

/** Varying : position monde du fragment (les meshes fusionnés n'ont pas de transform). */
export const DETAIL_VERTEX_DECLARATIONS = `
  varying vec3 vDetailPos;
`;

export const DETAIL_VERTEX_APPLY = `
  vDetailPos = transformed;
`;

export const DETAIL_FRAGMENT_DECLARATIONS = `
  varying vec3 vDetailPos;
  float vcDetailBlotch;
  float vcDetailGrain;
  float vcDetailTile;
  ${NOISE_GLSL}
`;

/**
 * Albédo du village, après `color_fragment`. `vInteriorMode` (growMaterial) :
 * l'aménagement des pièces (mode 2) n'est pas sali comme un pied de mur.
 */
export const DETAIL_ALBEDO_APPLY = `
  {
    // Le grain fin scintille de loin (fréquence > pixel) : il s'efface avec la distance.
    float detailNear = 1.0 - smoothstep(5.0, 16.0, length(vViewPosition));
    vcDetailBlotch = vcFbm(vDetailPos * 2.3);
    vcDetailGrain = vcNoise(vDetailPos * 41.0) * detailNear;
    float detailStain = vcNoise(vDetailPos * 0.55 + 3.7);

    float detailTone = 1.0
      + (vcDetailBlotch - 0.44) * 0.36
      + (vcDetailGrain - 0.5 * detailNear) * 0.10
      + (detailStain - 0.5) * 0.16;
    diffuseColor.rgb *= detailTone;
    // Dérive de teinte à grande échelle : zones un peu plus chaudes ou plus froides.
    diffuseColor.rgb *= mix(vec3(1.035, 1.0, 0.955), vec3(0.965, 1.0, 1.04), detailStain);

    // Couverture : toute face en pente hors des pièces est un pan de toit
    // (tuiles) ou une flèche (ardoises). Rangs horizontaux à hauteur
    // constante, en quinconce le long de la pente — continus d'une cellule à
    // l'autre puisque tout est en coordonnées monde.
    vcDetailTile = 0.0;
    vec3 detailNormal = normalize(vInteriorNormal);
    float detailSlope = smoothstep(0.22, 0.36, detailNormal.y) * (1.0 - smoothstep(0.93, 0.97, detailNormal.y));
    if (detailSlope > 0.0 && vInteriorMode < 0.5) {
      float tileFade = detailSlope * (1.0 - smoothstep(9.0, 30.0, length(vViewPosition)));
      vec3 tileAlong = normalize(cross(vec3(0.0, 1.0, 0.0), detailNormal));
      float tileCourse = vDetailPos.y * 12.0;
      float tileRow = floor(tileCourse);
      float tileV = fract(tileCourse); // 0 = bas du rang (pureau), 1 = sous le rang du dessus
      float tileU = dot(vDetailPos, tileAlong) * 8.0 + mod(tileRow, 2.0) * 0.5;
      float tileSeed = vcHash(vec3(floor(tileU), tileRow, 3.0));
      float tileJoint = smoothstep(0.0, 0.1, fract(tileU)) * smoothstep(1.0, 0.9, fract(tileU));
      // Ombre portée par le rang du dessus, joints, et teinte propre à chaque tuile.
      float tileShade = mix(0.66, 1.0, smoothstep(0.62, 0.95, 1.0 - tileV * 0.45) * (0.35 + 0.65 * tileJoint))
        * (0.8 + 0.4 * tileSeed);
      tileShade *= mix(0.74, 1.0, smoothstep(0.0, 0.3, 1.0 - tileV));
      diffuseColor.rgb *= mix(1.0, tileShade, tileFade);
      // Chaque tuile se relève vers son bord bas, par-dessus la suivante.
      vcDetailTile = (1.0 - tileV) * (0.6 + 0.4 * tileSeed) * tileJoint * 0.035 * tileFade;
    }

    if (vInteriorMode < 1.5) {
      // Pied des murs : éclaboussures et humidité, à bord irrégulier, verdies par endroits.
      float detailGround = 1.0 - smoothstep(0.0, 0.45, vDetailPos.y + (vcDetailBlotch - 0.44) * 0.4);
      diffuseColor.rgb *= 1.0 - 0.24 * detailGround;
      float detailMoss = detailGround * smoothstep(0.5, 0.8, detailStain);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.96, 0.66), detailMoss * 0.6);
    }
  }
`;

/** Rugosité, après `roughnessmap_fragment` : les taches sombres sont aussi plus lisses. */
export const DETAIL_ROUGHNESS_APPLY = `
  roughnessFactor = clamp(roughnessFactor + (vcDetailBlotch - 0.44) * 0.3, 0.04, 1.0);
`;

/** Relief, après `normal_fragment_maps` : bosses larges + grain fin. */
export const DETAIL_NORMAL_APPLY = `
  normal = vcBumpNormal(-vViewPosition, normal, vcDetailBlotch * 0.022 + vcDetailGrain * 0.0035 + vcDetailTile);
`;

/** Morceaux GLSL d'un matériau standard hors village (terrain, arbres), voir `injectWorldDetail`. */
export interface WorldDetail {
  /** Après `color_fragment` : module `diffuseColor` ; peut écrire `vcDetailHeight` (relief, unités monde). */
  albedo: string;
  /** Uniforms supplémentaires (déclarés par `declarations`). */
  uniforms?: Record<string, { value: unknown }>;
  declarations?: string;
}

interface InjectableShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * Branche le bruit monde sur un MeshStandardMaterial ordinaire (à appeler
 * depuis `onBeforeCompile`) : `vDetailPos` = position monde du fragment,
 * instancing compris, puis `detail.albedo`, et un relief si
 * `vcDetailHeight` a été écrit.
 */
export function injectWorldDetail(shader: InjectableShader, detail: WorldDetail): void {
  Object.assign(shader.uniforms, detail.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `${DETAIL_VERTEX_DECLARATIONS}\n#include <common>`)
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 detailWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          detailWorld = instanceMatrix * detailWorld;
        #endif
        vDetailPos = (modelMatrix * detailWorld).xyz;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `varying vec3 vDetailPos;
      float vcDetailHeight = 0.0;
      ${detail.declarations ?? ''}
      ${NOISE_GLSL}
      #include <common>`,
    )
    .replace('#include <color_fragment>', `#include <color_fragment>\n${detail.albedo}`)
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      normal = vcBumpNormal(-vViewPosition, normal, vcDetailHeight);`,
    );
}
