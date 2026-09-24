/**
 * Réglages de style dont dépend la géométrie du village. Passés explicitement
 * à `buildVillage` (et aux builders via `CellContext.settings`) : les builders
 * restent des fonctions pures, et le memo de `VillageMeshes` se reconstruit
 * dès que l'un d'eux change — sans liste de sélecteurs à tenir à jour à part.
 */

import type {
  CellDecorationsState,
  CellMaterialsState,
  CellRoofState,
  CellShapeState,
} from '../store/controlStore';

export type RenderSettings = CellMaterialsState & CellDecorationsState & CellRoofState & CellShapeState;

/**
 * Extrait les `RenderSettings` d'un état plus large (typiquement le store).
 * Le type de retour fait échouer la compilation si une clé est oubliée ici.
 */
export function pickRenderSettings(state: RenderSettings): RenderSettings {
  return {
    wallRoughness: state.wallRoughness,
    wallBaseColor: state.wallBaseColor,
    roofBaseColor: state.roofBaseColor,
    spireColor: state.spireColor,

    windowStonesPerFace: state.windowStonesPerFace,
    windowStoneRoughness: state.windowStoneRoughness,
    quoinMargin: state.quoinMargin,
    quoinRoughness: state.quoinRoughness,

    ridgeY: state.ridgeY,
    towerR: state.towerR,
    merlonCount: state.merlonCount,
    merlonR: state.merlonR,
    merlonH: state.merlonH,
    spireH: state.spireH,

    isolatedWallRadius: state.isolatedWallRadius,
    connectedWallExposedRadius: state.connectedWallExposedRadius,
    connectedWallInteriorRadius: state.connectedWallInteriorRadius,
  };
}
