/// <reference lib="webworker" />
/**
 * Web Worker de construction du village (voir villageBuild.ts) : reçoit la
 * grille, construit avec un `VillageChunkCache` gardé d'une demande à l'autre,
 * renvoie les chunks refusionnés en transférant leurs tableaux.
 */

import { VillageBuildHost, type WorkerRequest } from './villageBuild';

const host = new VillageBuildHost();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { response, transfer } = host.handle(event.data, true);
  scope.postMessage(response, transfer);
});
