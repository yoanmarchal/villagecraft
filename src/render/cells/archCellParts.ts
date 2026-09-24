/**
 * Arche — ex-ArchCell, porté en builder de parts.
 * Conçue localement le long de l'axe X (ouverture face à Z) ; rotation 90°
 * si l'environnement impose l'axe Z.
 */

import { getArchAxis } from '../../utils/cellUtils';
import { shades } from '../../colorPalettes';
import { roundedBoxGeo, torusArcGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import type { CellContext } from './context';

export function archCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, settings } = ctx;
  const archAxis = getArchAxis(lookup, cell);

  const baseColor = settings.wallBaseColor;
  const mainColor = baseColor;
  const { darkStoneColor, accentStoneColor, lintelColor } = shades(baseColor, {
    darkStoneColor: -0.12,
    accentStoneColor: -0.18,
    lintelColor: -0.06,
  });

  const G = xform([0, 0, 0], archAxis === 'z' ? [0, Math.PI / 2, 0] : [0, 0, 0]);

  const pillarGeo = roundedBoxGeo(0.26, 0.86, 0.8, 0.03, 4);
  const baseGeo = roundedBoxGeo(0.32, 0.12, 0.86, 0.02, 4);
  const capitalGeo = roundedBoxGeo(0.32, 0.08, 0.86, 0.02, 4);

  const parts: Part[] = [];

  // Piliers gauche/droit + bases + chapiteaux
  for (const side of [-1, 1] as const) {
    parts.push(
      part(pillarGeo, mainColor, { roughness: 0.88 }, mul(G, xform([side * 0.35, -0.07, 0]))),
      part(baseGeo, darkStoneColor, { roughness: 0.9 }, mul(G, xform([side * 0.35, -0.44, 0]))),
      part(capitalGeo, darkStoneColor, { roughness: 0.9 }, mul(G, xform([side * 0.35, 0.11, 0]))),
    );
  }

  parts.push(
    // Voûte (demi-tore aplati en Z)
    part(torusArcGeo(0.29, 0.07, 12, 32, Math.PI), mainColor, { roughness: 0.82 },
      mul(G, xform([0, 0.15, 0], [0, 0, 0], [1, 1, 5.7]))),
    // Clé de voûte
    part(roundedBoxGeo(0.15, 0.18, 0.86, 0.02, 4), accentStoneColor, { roughness: 0.85 },
      mul(G, xform([0, 0.38, 0]))),
    // Linteau supérieur
    part(roundedBoxGeo(1.02, 0.14, 0.84, 0.02, 4), lintelColor, { roughness: 0.88 },
      mul(G, xform([0, 0.43, 0]))),
  );

  return parts;
}
