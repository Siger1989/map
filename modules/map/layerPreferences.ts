import { DEFAULT_LAYERS, type LayerSettings } from './types.ts';

export const LAYER_PREFERENCES_KEY = 'shantu.map.layer-preferences.v1';
const CURRENT_VERSION = 1;
type PersistedLayers = Omit<LayerSettings, 'rasterDatums'>;

function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Parse user-selected map display settings; unknown and malformed fields use defaults. */
export function parseLayerPreferences(raw: string | null, fallback: LayerSettings = DEFAULT_LAYERS): LayerSettings | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const envelope = parsed as { version?: unknown; layers?: unknown };
    if (envelope.version !== 1 || !envelope.layers || typeof envelope.layers !== 'object' || Array.isArray(envelope.layers)) return null;
    const value = envelope.layers as Record<string, unknown>;
    const result: LayerSettings = { ...fallback };
    const booleans = ['terrain', 'satellite', 'offlineBasemap', 'tiandituBoundaries', 'contours', 'elevationColors', 'geology', 'clouds', 'rain', 'temperature', 'roads', 'labels'] as const;
    for (const key of booleans) if (typeof value[key] === 'boolean') Object.assign(result, { [key]: value[key] });
    if (value.satelliteProvider === 'sentinel' || value.satelliteProvider === 'tianditu') result.satelliteProvider = value.satelliteProvider;
    if (value.tiandituBase === 'vec' || value.tiandituBase === 'img' || value.tiandituBase === 'ter') result.tiandituBase = value.tiandituBase;
    if (['auto', 'cva', 'cia', 'cta', 'none'].includes(String(value.tiandituLabels))) result.tiandituLabels = value.tiandituLabels as LayerSettings['tiandituLabels'];
    if (value.geologySource === 'world' || value.geologySource === 'geocloud20w') result.geologySource = value.geologySource;
    if (value.imageryMode === 'detail' || value.imageryMode === 'latest') result.imageryMode = value.imageryMode;
    if (value.contourInterval === 30 || value.contourInterval === 50 || value.contourInterval === 100 || value.contourInterval === 200) result.contourInterval = value.contourInterval;
    if (bounded(value.elevationColorsOpacity, 0, 1)) result.elevationColorsOpacity = value.elevationColorsOpacity;
    if (bounded(value.geologyOpacity, 0, 1)) result.geologyOpacity = value.geologyOpacity;
    if (bounded(value.roadsOpacity, 0, 1)) result.roadsOpacity = value.roadsOpacity;
    if (bounded(value.opacity, 0, 1)) result.opacity = value.opacity;
    if (bounded(value.exaggeration, 0.1, 5)) result.exaggeration = value.exaggeration;
    if (value.rasterLevel === null || bounded(value.rasterLevel, 0, 24)) result.rasterLevel = value.rasterLevel;
    if (value.offlineMaxZoom === null || bounded(value.offlineMaxZoom, 0, 24)) result.offlineMaxZoom = value.offlineMaxZoom;
    return result;
  } catch { return null; }
}

export function readLayerPreferences(fallback: LayerSettings = DEFAULT_LAYERS): LayerSettings {
  try { return parseLayerPreferences(localStorage.getItem(LAYER_PREFERENCES_KEY), fallback) ?? fallback; }
  catch { return fallback; }
}

export function saveLayerPreferences(settings: LayerSettings): void {
  const { rasterDatums: _rasterDatums, ...layers } = settings;
  try {
    const current = localStorage.getItem(LAYER_PREFERENCES_KEY);
    if (current) {
      try {
        const stored: unknown = JSON.parse(current);
        const version = stored && typeof stored === 'object' && !Array.isArray(stored)
          ? (stored as { version?: unknown }).version
          : undefined;
        if (typeof version === 'number' && Number.isFinite(version) && version > CURRENT_VERSION) return;
      } catch { /* Corrupt current data is safe to replace with a valid snapshot. */ }
    }
    localStorage.setItem(LAYER_PREFERENCES_KEY, JSON.stringify({ version: CURRENT_VERSION, layers: layers satisfies PersistedLayers }));
  }
  catch { /* A full or disabled store must not interrupt map controls. */ }
}
