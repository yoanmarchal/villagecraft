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

  // Appareil de pierre (VC_MASONRY) : cote du lit de pose n° k, décalé au
  // hasard autour d'une trame régulière — des assises de hauteurs inégales,
  // mais fonction de la seule hauteur monde : elles se suivent d'une cellule,
  // d'une face et d'un bâtiment à l'autre.
  float vcCourseBed(float k) {
    return (k + (vcHash(vec3(k, 1.0, 9.0)) - 0.5) * 0.56) / 12.0;
  }

  // Abscisse du joint montant n° c de l'assise row, même principe.
  float vcStoneHead(float c, float row, float salt, float width) {
    return (c + (vcHash(vec3(c, row, salt + 3.0)) - 0.5) * 0.62) * width;
  }
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
    vcDetailRoof = 0.0;
    vec3 detailNormal = normalize(vInteriorNormal);
    // Normale de la facette, par dérivées écran — calculée hors de tout
    // branchement (les dérivées y sont indéfinies) et jamais nulle : un seul
    // pixel NaN, étalé par le bloom, noircit l'image entière.
    vec3 detailFaceRaw = cross(dFdx(vDetailPos), dFdy(vDetailPos));
    vec3 detailFace = detailFaceRaw / max(length(detailFaceRaw), 1e-12);
    float detailSlope = smoothstep(0.22, 0.36, detailNormal.y) * (1.0 - smoothstep(0.93, 0.97, detailNormal.y))
      * (1.0 - step(0.5, vInteriorMode));
    // Sans branchement : fwidth() doit rester défini partout.
    {
      // Sens des rangs : pris sur la normale de la facette (dérivées écran),
      // constante sur tout un pan. La normale interpolée, elle, tourne d'un
      // bord à l'autre des pans lissés d'une flèche : projetée dessus, la
      // position donnait des tuiles larges d'un côté et en lamelles de l'autre.
      vec3 tileAlong = normalize(cross(vec3(0.0, 1.0, 0.0), detailFace) + vec3(1e-5, 0.0, 0.0));
      float tileCourse = vDetailPos.y * 12.0;
      float tileColumn = dot(vDetailPos, tileAlong) * 8.0;
      // Le motif s'efface dès qu'une tuile approche la taille d'un pixel
      // (flèches raides vues de loin) : en deçà, il ne fait que du moiré.
      float tileFootprint = max(fwidth(tileCourse), fwidth(tileColumn));
      float tileFade = detailSlope
        * (1.0 - smoothstep(9.0, 30.0, length(vViewPosition)))
        * (1.0 - smoothstep(0.12, 0.4, tileFootprint));
      float tileRow = floor(tileCourse);
      float tileV = fract(tileCourse); // 0 = bas du rang (pureau), 1 = sous le rang du dessus
      float tileU = tileColumn + mod(tileRow, 2.0) * 0.5;
      float tileSeed = vcHash(vec3(floor(tileU), tileRow, 3.0));
      float tileJoint = smoothstep(0.0, 0.1, fract(tileU)) * smoothstep(1.0, 0.9, fract(tileU));
      // Ombre portée par le rang du dessus, joints, et teinte propre à chaque tuile.
      float tileShade = mix(0.66, 1.0, smoothstep(0.62, 0.95, 1.0 - tileV * 0.45) * (0.35 + 0.65 * tileJoint))
        * (0.8 + 0.4 * tileSeed);
      tileShade *= mix(0.74, 1.0, smoothstep(0.0, 0.3, 1.0 - tileV));
      diffuseColor.rgb *= mix(1.0, tileShade, tileFade);
      // Chaque tuile se relève vers son bord bas, par-dessus la suivante.
      vcDetailTile = (1.0 - tileV) * (0.6 + 0.4 * tileSeed) * tileJoint * 0.035 * tileFade;
      vcDetailRoof = detailSlope;
    }

    #ifdef VC_MASONRY
    {
      // ── Appareil de pierre ─────────────────────────────────────────────
      // Maçonnerie de château fort : moellons équarris posés en assises de
      // hauteurs inégales (17 à 30 cm), pierres de longueurs variables,
      // joints épais et sinueux, angles usés, parement bombé. Rien de
      // répétitif : une brique moulée, régulière, se lit comme du XIXe siècle.
      // Tout est en coordonnées monde : les assises (hauteur) et les joints
      // montants (abscisse le long du mur) filent d'une cellule à l'autre.
      float masonryWall = 1.0 - smoothstep(0.25, 0.45, abs(detailNormal.y));
      // Coque creuse : les faces de la cavité (pièces, tableaux) restent enduites.
      vec3 masonryAxis = abs(detailNormal);
      vec3 masonryLocal = abs(vInteriorLocal);
      float masonryDepth = masonryAxis.x > masonryAxis.z ? masonryLocal.x : masonryLocal.z;
      masonryWall *= mix(1.0, step(VC_CAVITY_HALF_WIDTH, masonryDepth), step(0.5, vInteriorMode));

      // Abscisse le long du mur : x ou z selon l'orientation de la face. Sur
      // un coin arrondi (normale lissée qui tourne), on la prolonge en
      // longueur d'arc — projetées à plat, les pierres s'étiraient de 40 %
      // à l'approche de la diagonale. Rayon : celui des tours.
      bool masonryAlongZ = masonryAxis.x > masonryAxis.z;
      float masonryRun = masonryAlongZ ? vDetailPos.z : vDetailPos.x;
      float masonryTurn = masonryAlongZ ? detailNormal.z : detailNormal.x;
      float masonryTheta = atan(abs(masonryTurn), max(masonryAlongZ ? masonryAxis.x : masonryAxis.z, 1e-4));
      masonryRun += sign(masonryTurn) * 0.22 * (masonryTheta - sin(masonryTheta));

      // Taille d'un pixel sur le mur : sert à lisser les joints, et à fondre
      // l'appareil dans sa teinte moyenne quand une assise passe sous ~3 pixels.
      float masonryPixel = length(fwidth(vDetailPos));
      float masonryFade = 1.0 - smoothstep(0.14, 0.42, masonryPixel * 12.0);
      // Le relief s'efface bien plus tôt : ses dérivées écran ne voient plus
      // les joints de loin et dessinaient un moiré en diagonale.
      float masonryReliefFade = 1.0 - smoothstep(0.05, 0.16, masonryPixel * 12.0);

      // Joints sinueux : les pierres sont taillées à la main, pas tirées au cordeau.
      vec2 masonryPoint = vec2(masonryRun, vDetailPos.y);
      masonryPoint += (vec2(
        vcNoise(vec3(masonryPoint * 6.0, 3.1)),
        vcNoise(vec3(masonryPoint * 6.0, 8.7))) - 0.5) * 0.02;

      // Assise : lits de pose décalés au hasard autour d'une trame de 10 cm… × 2,8.
      float masonryK = floor(masonryPoint.y * 12.0);
      float masonryBed = vcCourseBed(masonryK);
      float masonryBelow = step(masonryPoint.y, masonryBed);
      float masonryRow = masonryK - masonryBelow;
      float masonryBottom = mix(masonryBed, vcCourseBed(masonryRow), masonryBelow);
      float masonryTop = mix(vcCourseBed(masonryK + 1.0), masonryBed, masonryBelow);

      // Pierre dans l'assise : module et décalage propres à chaque assise,
      // joints montants décalés au hasard — jamais deux assises identiques.
      float masonrySalt = masonryAlongZ ? 7.0 : 13.0;
      float masonryModule = 0.12 + 0.1 * vcHash(vec3(masonryRow, 2.0, masonrySalt));
      float masonryShift = vcHash(vec3(masonryRow, 5.0, masonrySalt)) * masonryModule;
      float masonryC = floor((masonryPoint.x + masonryShift) / masonryModule);
      float masonryHead = vcStoneHead(masonryC, masonryRow, masonrySalt, masonryModule) - masonryShift;
      float masonryLeftOf = step(masonryPoint.x, masonryHead);
      float masonryColumn = masonryC - masonryLeftOf;
      float masonryLeft = mix(
        masonryHead,
        vcStoneHead(masonryColumn, masonryRow, masonrySalt, masonryModule) - masonryShift,
        masonryLeftOf);
      float masonryRight = mix(
        vcStoneHead(masonryC + 1.0, masonryRow, masonrySalt, masonryModule) - masonryShift,
        masonryHead,
        masonryLeftOf);

      // Distance au bord de la pierre, angles arrondis (arêtes usées, épaufrées).
      vec2 masonryInset = min(
        masonryPoint - vec2(masonryLeft, masonryBottom),
        vec2(masonryRight, masonryTop) - masonryPoint);
      float masonrySeed = vcHash(vec3(masonryColumn, masonryRow, masonrySalt));
      float masonrySeed2 = vcHash(vec3(masonryRow, masonryColumn, masonrySalt + 5.0));
      float masonryRound = 0.008 + 0.012 * masonrySeed2;
      vec2 masonryCorner = max(masonryRound - masonryInset, 0.0);
      float masonryEdge = min(min(masonryInset.x, masonryInset.y), masonryRound - length(masonryCorner));
      // Joint de mortier large (≈ 2 cm de chaque côté), antialiasé.
      float masonryJoint = 0.0055;
      float masonryStone = smoothstep(masonryJoint - masonryPixel * 0.5, masonryJoint + masonryPixel, masonryEdge);

      vec3 masonryBase = diffuseColor.rgb;
      // Chaque pierre vient d'un banc différent : plus ou moins claire, tirant
      // sur l'ocre, le gris ou le rosé ; quelques-unes nettement plus sombres.
      vec3 masonryColor = masonryBase * (0.8 + 0.3 * masonrySeed)
        * mix(vec3(1.07, 0.99, 0.88), vec3(0.94, 0.99, 1.06), masonrySeed2);
      masonryColor *= 1.0 - 0.2 * step(0.9, fract(masonrySeed * 7.3));
      // Parement piqué à l'outil : mouchetures propres à chaque pierre.
      float masonryPitting = vcNoise(vec3(masonryPoint * 55.0, masonrySeed * 40.0));
      masonryColor *= 0.94 + 0.12 * masonryPitting * masonryFade;
      // Mortier de chaux et de sable : plus sombre qu'une pierre claire, plus clair qu'une pierre foncée.
      float masonryLuminance = dot(masonryBase, vec3(0.2126, 0.7152, 0.0722));
      vec3 masonryMortar = mix(vec3(0.74, 0.7, 0.61), masonryBase * 0.58, smoothstep(0.2, 0.5, masonryLuminance));
      vec3 masonryNear = mix(masonryMortar, masonryColor, masonryStone);
      // De loin : la moyenne pierre + joints, pour que le mur ne change pas de valeur en dézoomant.
      vec3 masonryFar = masonryBase * 0.87;
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(masonryFar, masonryNear, masonryFade), masonryWall);
      // Parement bombé (bossage rustique) au-dessus de joints creux, piqueté.
      // Pas de relief sur la diagonale d'un coin arrondi, où l'abscisse change
      // d'axe : la marche de hauteur y traçait un pointillé vertical.
      float masonrySeam = smoothstep(0.0, 0.1, abs(masonryAxis.x - masonryAxis.z));
      vcDetailTile += smoothstep(0.0, 0.028, masonryEdge - masonryJoint)
        * (0.007 + 0.004 * masonrySeed + 0.002 * masonryPitting)
        * masonryReliefFade * masonryWall * masonrySeam;
    }
    #endif

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
