import type { LayerSettings } from '../map/types';
import type { MapSource } from '../mapSources/types';
import { FREE_MAPS } from '../mapSources/presets';
import { basemapConfiguration } from '../cartography/basemaps';

export type ComparisonChoice = {
  id: string;
  name: string;
  group: '当前' | '内置' | '我的图源' | '公共库';
  source: MapSource | null;
  settings: LayerSettings;
};

/** Keep comparison choices transient. Only the explicit Use action saves a source. */
export function comparisonChoices(
  settings: LayerSettings,
  source: MapSource | null,
  name: string,
  maps: MapSource[],
  domestic = basemapConfiguration().domestic,
): ComparisonChoice[] {
  const clean = { ...settings, rasterLevel: null, offlineMaxZoom: null, offlineBasemap: false };
  const builtin = (id: string, label: string, patch: Partial<LayerSettings>): ComparisonChoice => ({
    id, name: label, group: '内置', source: null, settings: { ...clean, ...patch },
  });
  return [
    { id: 'current', name, group: '当前', source, settings },
    builtin('terrain', '开源道路地形', { satellite: false, satelliteProvider: 'sentinel', tiandituBase: 'vec', offlineBasemap: true }),
    builtin('sentinel', 'Sentinel-2 2025', { satellite: true, satelliteProvider: 'sentinel', imageryMode: 'detail' }),
    ...(domestic ? (['vec', 'img', 'ter'] as const).map(id => builtin(`tdt-${id}`, `天地图${id === 'vec' ? '矢量' : id === 'img' ? '影像' : '地形'}`, {
      satelliteProvider: 'tianditu', tiandituBase: id, satellite: id === 'img',
    })) : []),
    ...maps.map(item => ({ id: `saved:${item.id}`, name: item.name, group: '我的图源' as const, source: item, settings: clean })),
    ...FREE_MAPS.map(item => ({ id: `public:${item.id}`, name: item.name, group: '公共库' as const, source: item, settings: clean })),
  ];
}
