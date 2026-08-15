import { useEffect, useRef } from 'react';
import { Pane } from 'tweakpane';
import { useControlStore } from '../store/controlStore';
import { registerGridControls } from '../controls/gridControls';
import { registerLightingControls } from '../controls/lightingControls';
import { registerSkyFogControls } from '../controls/skyFogControls';
import { registerCameraControls } from '../controls/cameraControls';
import { registerPostFxControls } from '../controls/postFxControls';
import { registerMaterialsControls } from '../controls/materialsControls';
import { registerDecorationsControls } from '../controls/decorationsControls';
import { registerRoofShapeControls } from '../controls/roofShapeControls';
import { registerDebugControls } from '../controls/debugControls';
import { registerActionsControls } from '../controls/actionsControls';
import type { Disposer } from '../controls/types';

export function TweakpanePanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelVisible = useControlStore((state) => state.panelVisible);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pane = new Pane({ container, title: 'Voxel Controls' });

    const disposers: Disposer[] = [
      registerGridControls(pane),
      registerLightingControls(pane),
      registerSkyFogControls(pane),
      registerCameraControls(pane),
      registerPostFxControls(pane),
      registerMaterialsControls(pane),
      registerDecorationsControls(pane),
      registerRoofShapeControls(pane),
      registerDebugControls(pane),
      registerActionsControls(pane),
    ];

    return () => {
      disposers.forEach((dispose) => dispose());
      pane.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="tweakpane-root"
      style={{ display: panelVisible ? undefined : 'none' }}
    />
  );
}
