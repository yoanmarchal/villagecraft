import type { Pane } from 'tweakpane';
import { useControlStore, type CellMaterialsState } from '../store/controlStore';
import { useGridControllerStore } from '../store/gridControllerStore';
import type { Disposer } from './types';

function toModel(state: CellMaterialsState) {
  return {
    wallRoughness: state.wallRoughness,
    colorJitterIntensity: state.colorJitterIntensity,
  };
}

export function registerMaterialsControls(pane: Pane): Disposer {
  const folder = pane.addFolder({ title: 'Materials', expanded: false });
  const model = toModel(useControlStore.getState());

  let applyingFromPane = false;

  const applyPatch = () => {
    applyingFromPane = true;
    useControlStore.getState().setCellMaterials({ ...model });
    applyingFromPane = false;
  };

  const bindings = [
    folder.addBinding(model, 'wallRoughness', { min: 0, max: 1, step: 0.01 }),
    folder.addBinding(model, 'colorJitterIntensity', { min: 0, max: 0.3, step: 0.005 }),
  ];

  bindings.forEach((binding) => binding.on('change', applyPatch));

  const unsubscribe = useControlStore.subscribe((state, prevState) => {
    // Le jitter de couleur est appliqué à la mutation de la grille, pas au rendu :
    // il faut re-teindre explicitement les cellules déjà posées.
    if (state.colorJitterIntensity !== prevState.colorJitterIntensity) {
      const { grid, onMutate } = useGridControllerStore.getState();
      grid?.recolor();
      onMutate?.();
    }

    if (applyingFromPane) return;
    Object.assign(model, toModel(state));
    folder.refresh();
  });

  return () => {
    unsubscribe();
    folder.dispose();
  };
}
