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

import { RELIEF_GLSL } from './relief';

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
    // Pente bornée : une hauteur discontinue (bord de tuile) donne sinon, sur
    // le pixel qui chevauche la marche, une normale quasi couchée — autant de
    // reflets blancs qui scintillent, surtout sur l'ardoise sombre.
    float slopeX = clamp(dFdx(height), -0.9 * length(sigmaX), 0.9 * length(sigmaX));
    float slopeY = clamp(dFdy(height), -0.9 * length(sigmaY), 0.9 * length(sigmaY));
    vec3 gradient = sign(det) * (slopeX * r1 + slopeY * r2);
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
  float vcDetailRoof;

  ${NOISE_GLSL}
  ${RELIEF_GLSL}

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

    // Relief et matité propres à une couverture : aucun (tuiles et ardoises
    // sont de la vraie géométrie, roofCellParts.ts).
    vcDetailTile = 0.0;
    vcDetailRoof = 0.0;
    vec3 detailNormal = normalize(vInteriorNormal);

    #ifdef VC_MASONRY
    {
      // ── Fond de mur ────────────────────────────────────────────────────
      // Faces verticales extérieures d'un corps de mur : mortier de chaux et
      // de sable. Il ne se voit qu'au creux des joints, entre les pierres —
      // de vrais blocs posés devant lui (masonryParts.ts). Les faces de la
      // cavité d'une coque creuse (pièces, tableaux) restent enduites.
      float masonryWall = 1.0 - smoothstep(0.25, 0.45, abs(detailNormal.y));
      vec3 masonryAxis = abs(detailNormal);
      vec3 masonryLocal = abs(vInteriorLocal);
      float masonryDepth = masonryAxis.x > masonryAxis.z ? masonryLocal.x : masonryLocal.z;
      masonryWall *= mix(1.0, step(VC_CAVITY_HALF_WIDTH, masonryDepth), step(0.5, vInteriorMode));
      // Plus sombre qu'une pierre claire, plus clair qu'une pierre foncée.
      float masonryLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 masonryMortar = mix(vec3(0.74, 0.7, 0.61), diffuseColor.rgb * 0.58, smoothstep(0.2, 0.5, masonryLuminance));
      diffuseColor.rgb = mix(diffuseColor.rgb, masonryMortar, masonryWall);
    }
    #endif

    if (vInteriorMode < 1.5) {
      // Pied des murs : éclaboussures et humidité, à bord irrégulier, verdies par endroits.
      // Hauteur au-dessus du terrain (en pente, voir relief.ts), pas une cote fixe.
      float detailHeight = vDetailPos.y - vcGroundHeight(vDetailPos.xz);
      float detailGround = 1.0 - smoothstep(0.0, 0.45, detailHeight + (vcDetailBlotch - 0.44) * 0.4);
      diffuseColor.rgb *= 1.0 - 0.24 * detailGround;
      float detailMoss = detailGround * smoothstep(0.5, 0.8, detailStain);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.96, 0.66), detailMoss * 0.6);
    }
  }
`;

/** Rugosité, après `roughnessmap_fragment` : les taches sombres sont aussi plus lisses. */
export const DETAIL_ROUGHNESS_APPLY = `
  roughnessFactor = clamp(roughnessFactor + (vcDetailBlotch - 0.44) * 0.3, 0.04, 1.0);
  // Couverture mate : tuile et ardoise ne renvoient pas d'éclats de soleil.
  roughnessFactor = max(roughnessFactor, 0.82 * vcDetailRoof);
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
