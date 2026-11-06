import type { LayerSettings } from '../types.ts';

/** Preserve display preferences in native render-state JSON with a stable false default. */
export function serializeNativeLayerSettings(settings: LayerSettings): LayerSettings {
  return { ...settings, outdoorContours: settings.outdoorContours === true };
}
