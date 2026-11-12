/**
 * Écran de chargement (#app-loader, en ligne dans index.html) : visible dès
 * le premier octet de HTML, il couvre le téléchargement du JavaScript puis
 * la première construction du village et la compilation des shaders.
 */

/** Durée du fondu de sortie (index.html), plus une marge. */
const FADE_MS = 600;

/**
 * Retire l'écran de chargement en fondu. Idempotent : appelé une fois la
 * première image du village dessinée (VillageMeshes), ou sur une erreur —
 * il ne doit jamais masquer indéfiniment une page plantée.
 */
export function hideAppLoader(): void {
  const loader = document.getElementById('app-loader');
  if (!loader || loader.dataset.state === 'done') return;
  loader.dataset.state = 'done';
  loader.setAttribute('aria-busy', 'false');
  // transitionend ne vient pas si les transitions sont coupées (mouvement réduit) : délai de repli.
  const remove = () => loader.remove();
  loader.addEventListener('transitionend', remove, { once: true });
  window.setTimeout(remove, FADE_MS);
}
