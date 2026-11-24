import { basemapConfiguration, tiandituTiles, TIANDITU_CREDIT } from '../cartography/basemaps';
import { SENTINEL_CREDIT, SENTINEL_MAXZOOM, SENTINEL_NAME, SENTINEL_TILES, usesSentinel, usesTianditu } from '../cartography/sentinel';
import { tiandituBase, TIANDITU_LAYERS } from '../cartography/tianditu';
import { comparisonChoices } from '../mapComparison/choices';
import type { LayerSettings } from '../map/types';
import { rasterDatumKey } from '../mapSources/coordinates';
import { defaultRasterDatum } from '../mapSources/sourceDatum';
import type { MapSource } from '../mapSources/types';

export interface JourneySourceChoice {
  id: string;
  name: string;
  group: '当前' | '内置' | '我的图源' | '公共库';
  /** Null means the current choice has no raster compatible with the 3D view. */
  source: MapSource | null;
}

function rasterForJourney(
  settings: LayerSettings,
  source: MapSource | null,
  config: ReturnType<typeof basemapConfiguration>,
): MapSource | null {
  const datum = settings.rasterDatums?.[rasterDatumKey(settings, source?.id)] ?? defaultRasterDatum(source);
  if (source) return source.kind === 'online' ? { ...source, datum } : null;
  if (usesTianditu(settings, config.domestic)) {
    const layer = tiandituBase(settings);
    return {
      id: `journey-tdt-${layer}`, name: `天地图${TIANDITU_LAYERS[layer].name}`,
      kind: 'online', format: 'WMTS', attribution: TIANDITU_CREDIT, datum,
      minzoom: 1, maxzoom: TIANDITU_LAYERS[layer].maxzoom, tileSize: 256, scheme: 'xyz',
      tiles: tiandituTiles(layer, config.token), bytes: 0,
    };
  }
  if (usesSentinel(settings)) {
    return {
      id: 'journey-sentinel', name: SENTINEL_NAME, kind: 'online', format: 'WMTS',
      attribution: SENTINEL_CREDIT, datum, minzoom: 0, maxzoom: SENTINEL_MAXZOOM,
      tileSize: 256, scheme: 'xyz', tiles: SENTINEL_TILES, bytes: 0,
    };
  }
  return null;
}

export function journeySourceChoices(settings: LayerSettings, source: MapSource | null, maps: MapSource[]): JourneySourceChoice[] {
  const config = basemapConfiguration();
  const current = rasterForJourney(settings, source, config);
  const name = source?.name ?? current?.name ?? '开源道路地形';
  const choices: JourneySourceChoice[] = [{ id: 'current', name, group: '当前', source: current }];
  const listed = new Set(current ? [current.id] : []);
  for (const choice of comparisonChoices(settings, source, name, maps, config.domestic)) {
    if (choice.id === 'current') continue;
    const raster = rasterForJourney(choice.settings, choice.source, config);
    if (!raster || listed.has(raster.id)) continue;
    listed.add(raster.id);
    choices.push({ id: choice.id, name: raster.name, group: choice.group, source: raster });
  }
  if (current) choices.push({ id: 'terrain-only', name: '仅地形', group: '内置', source: null });
  return choices;
}
