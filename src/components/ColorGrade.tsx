/**
 * Étalonnage final, après le tone mapping : AgX rend une image volontairement
 * "à plat" (hautes lumières préservées, couleurs désaturées), pensée pour
 * être étalonnée ensuite. On lui redonne du contraste — courbe en puissance
 * pivotée sur le gris moyen, donc sans décaler l'exposition — et de la
 * saturation.
 *
 * Effet maison plutôt que `BrightnessContrast` + `HueSaturation` : enchaînés
 * derrière AgX, ils sortaient de [0, 1] et brûlaient en blanc pur les zones
 * éclairées (toits au soleil, arbres au couchant). Ici l'entrée et la sortie
 * sont bornées.
 */

import { useEffect, useMemo } from 'react';
import { Uniform } from 'three';
import { Effect } from 'postprocessing';

const FRAGMENT_SHADER = `
  uniform float uContrast;
  uniform float uSaturation;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = clamp(inputColor.rgb, 0.0, 1.0);
    color = 0.18 * pow(color / 0.18, vec3(uContrast));
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, uSaturation);
    outputColor = vec4(clamp(color, 0.0, 1.0), inputColor.a);
  }
`;

class ColorGradeEffect extends Effect {
  constructor() {
    super('ColorGradeEffect', FRAGMENT_SHADER, {
      uniforms: new Map([
        ['uContrast', new Uniform(1)],
        ['uSaturation', new Uniform(1)],
      ]),
    });
  }
}

interface ColorGradeProps {
  /** Exposant de la courbe de contraste (1 = neutre). */
  contrast: number;
  /** 1 = neutre, 0 = noir et blanc. */
  saturation: number;
}

export function ColorGrade({ contrast, saturation }: ColorGradeProps) {
  const effect = useMemo(() => new ColorGradeEffect(), []);
  useEffect(() => () => effect.dispose(), [effect]);
  useEffect(() => {
    effect.uniforms.get('uContrast')!.value = contrast;
    effect.uniforms.get('uSaturation')!.value = saturation;
  }, [effect, contrast, saturation]);
  return <primitive object={effect} dispose={null} />;
}
