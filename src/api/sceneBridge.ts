/**
 * Ce que la scène 3D expose à l'API `window.villagecraft` : enregistré par
 * des composants du Canvas (VoxelScene, VillageMeshes) tant qu'ils sont montés.
 */

export type Vec3 = [number, number, number];

export interface CameraView {
  position: Vec3;
  /** Point visé (centre de rotation de la caméra). */
  target: Vec3;
}

interface SceneBridge {
  getCamera: (() => CameraView) | null;
  setCamera: ((view: Partial<CameraView>) => void) | null;
  /** Une construction du village est en cours (ou demandée) dans le worker. */
  isBuilding: () => boolean;
  /** Horodatage (s, `performance.now()`) de la dernière apparition de bloc : son animation dure POP_DURATION. */
  latestSpawn: () => number;
}

export const sceneBridge: SceneBridge = {
  getCamera: null,
  setCamera: null,
  isBuilding: () => false,
  latestSpawn: () => 0,
};
