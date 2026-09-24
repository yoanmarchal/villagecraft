/**
 * Dossier Tweakpane lié à des clés du `controlStore`, décrit de façon
 * déclarative (liste ordonnée de champs + options de binding).
 *
 * Remplace le schéma recopié dans chaque module (miroir local, drapeau
 * "changement venu du panneau", souscription, refresh) et ne rafraîchit le
 * dossier que quand l'une de SES clés change — plus à chaque modification
 * de n'importe quel réglage.
 */

import type { BindingParams, Pane } from 'tweakpane';
import { useControlStore, type ControlState } from '../store/controlStore';
import type { Disposer } from './types';

type Vec3 = [number, number, number];

/** Clés du store éditables dans le panneau : scalaires, ou vecteurs 3D (affichés en point 3D). */
export type StoreFieldKey = {
  [K in keyof ControlState]: ControlState[K] extends number | string | boolean | Vec3 ? K : never;
}[keyof ControlState];

export type StoreField = readonly [key: StoreFieldKey, params?: BindingParams];

export interface StoreFolderSpec {
  title: string;
  expanded?: boolean;
  fields: readonly StoreField[];
}

const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3;

// Tweakpane édite les vecteurs sous forme {x, y, z} ; le store les garde en tuples.
const toPane = (value: unknown) => (isVec3(value) ? { x: value[0], y: value[1], z: value[2] } : value);
const fromPane = (value: unknown, previous: unknown) => {
  if (!isVec3(previous)) return value;
  const { x, y, z } = value as { x: number; y: number; z: number };
  return [x, y, z];
};

export function registerStoreFolder(pane: Pane, { title, expanded = false, fields }: StoreFolderSpec): Disposer {
  const folder = pane.addFolder({ title, expanded });
  const keys = fields.map(([key]) => key);

  const readModel = (state: ControlState) => Object.fromEntries(keys.map((key) => [key, toPane(state[key])]));
  const model: Record<string, unknown> = readModel(useControlStore.getState());

  let applyingFromPane = false;

  for (const [key, params] of fields) {
    folder.addBinding(model, key, params).on('change', () => {
      applyingFromPane = true;
      const previous = useControlStore.getState()[key];
      useControlStore.setState({ [key]: fromPane(model[key], previous) } as Partial<ControlState>);
      applyingFromPane = false;
    });
  }

  const unsubscribe = useControlStore.subscribe((state, previous) => {
    if (applyingFromPane || keys.every((key) => state[key] === previous[key])) return;
    Object.assign(model, readModel(state));
    folder.refresh();
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
