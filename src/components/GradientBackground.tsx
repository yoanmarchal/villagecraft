/**
 * Fond de scène en dégradé vertical (haut → horizon), en espace écran.
 *
 * Remplace le ciel physique de drei (Preetham) : vue de dessus, la caméra ne
 * montre que la partie sous l'horizon de ce ciel, qui rend en gris uniforme
 * quelle que soit l'ambiance. Un dégradé simple, piloté par l'ambiance, donne
 * l'effet "diorama" voulu pour un coût nul.
 */

import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

interface GradientBackgroundProps {
  top: string;
  horizon: string;
}

/** Position (0 = haut, 1 = bas de l'écran) où le dégradé atteint la couleur d'horizon. */
const HORIZON_STOP = 0.7;

export function GradientBackground({ top, horizon }: GradientBackgroundProps) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(HORIZON_STOP, horizon);
    gradient.addColorStop(1, horizon);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, [top, horizon]);

  useEffect(() => () => texture.dispose(), [texture]);

  return <primitive attach="background" object={texture} />;
}
