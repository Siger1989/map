import { freeMap } from './presets.ts';
import type { MapSource } from './types.ts';
import { applyLayerPatch, type LayerSettings } from '../map/types.ts';

/** Restore a selected built-in or local map only while its definition still exists. */
export function resolveAvailableMapSelection(id: string | null, maps: MapSource[]): string {
  return id && (freeMap(id) || maps.some((map) => map.id === id)) ? id : '';
}

type BasemapOverlays = Pick<LayerSettings,
  | 'terrain'
  | 'contours'
  | 'contourInterval'
  | 'elevationColors'
  | 'elevationColorsOpacity'
  | 'geology'
  | 'geologySource'
  | 'geologyOpacity'
  | 'roads'
  | 'roadsOpacity'
  | 'labels'
  | 'tiandituLabels'
  | 'tiandituBoundaries'
  | 'exaggeration'
>;

/** Switch source-owned basemap settings while retaining this map's independent layers. */
export function settingsForBasemapSource(
  target: LayerSettings,
  current: LayerSettings,
): LayerSettings {
  const overlays: BasemapOverlays = {
    terrain: current.terrain,
    contours: current.contours,
    contourInterval: current.contourInterval,
    elevationColors: current.elevationColors,
    elevationColorsOpacity: current.elevationColorsOpacity,
    geology: current.geology,
    geologySource: current.geologySource,
    geologyOpacity: current.geologyOpacity,
    roads: current.roads,
    roadsOpacity: current.roadsOpacity,
    labels: current.labels,
    tiandituLabels: current.tiandituLabels,
    tiandituBoundaries: current.tiandituBoundaries,
    exaggeration: current.exaggeration,
  };
  return { ...target, ...overlays };
}

/** Apply source-panel changes without treating its layer controls as a basemap switch. */
export function sourcePanelSettings(
  patch: Partial<LayerSettings>,
  current: LayerSettings,
): { settings: LayerSettings; sourceChanged: boolean } {
  const target = applyLayerPatch(current, patch);
  const sourceChanged = (
    patch.satellite !== undefined ||
    patch.satelliteProvider !== undefined ||
    patch.imageryMode !== undefined ||
    patch.tiandituBase !== undefined ||
    patch.offlineBasemap !== undefined
  );
  return {
    settings: sourceChanged ? settingsForBasemapSource(target, current) : target,
    sourceChanged,
  };
}
