/**
 * Ajoute une variation de luminosité à une couleur
 * @param color Couleur hex (#RRGGBB)
 * @param variation Pourcentage de variation (-0.1 à 0.1 recommandé)
 */
export function varyColorBrightness(color: string, variation: number): string {
  // Convertir hex en RGB
  const hex = color.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Appliquer la variation
  r = Math.max(0, Math.min(255, Math.round(r * (1 + variation))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + variation))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + variation))));

  // Reconvertir en hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Génère un jeu de teintes dérivées d'une couleur de base en une seule fois.
 * Remplace les appels répétés `varyColorBrightness(base, x)` par un seul
 * objet nommé, ex: `const { dark, light } = shades(baseColor, { dark: -0.15, light: 0.07 });`
 */
export function shades<T extends Record<string, number>>(
  base: string,
  deltas: T
): Record<keyof T, string> {
  const result = {} as Record<keyof T, string>;
  for (const key in deltas) {
    result[key] = varyColorBrightness(base, deltas[key]);
  }
  return result;
}
