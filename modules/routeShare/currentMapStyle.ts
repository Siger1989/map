import type { StyleSpecification } from 'maplibre-gl';

export type ShareMapStyle = { style: StyleSpecification; attribution: string };

/** Copy current basemap/thematic layers; route editing and location overlays are supplied separately. */
export function currentShareMapStyle(input: StyleSpecification): ShareMapStyle {
  const layers = input.layers.filter(layer => {
    if ((layer.type as string) === 'custom' || layer.layout?.visibility === 'none') return false;
    if (!('source' in layer)) return true;
    const source = input.sources[layer.source];
    return source && (['vector','raster','raster-dem','image'].includes(source.type) || source.type === 'geojson' && layer.source === 'temperature-grid');
  });
  const ids = new Set(layers.flatMap(layer => 'source' in layer ? [layer.source] : []));
  if (input.terrain) ids.add(input.terrain.source);
  const sources = Object.fromEntries(Object.entries(input.sources).filter(([id]) => ids.has(id)));
  const attribution = [...new Set(Object.values(sources).flatMap(source => 'attribution' in source && source.attribution
    ? [source.attribution.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&copy;/g, '©').trim()] : []))].join(' · ');
  return { style: structuredClone({ ...input, sources, layers }), attribution: attribution || '当前地图图源' };
}
