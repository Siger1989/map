import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Map as LibreMap } from 'maplibre-gl';
import type { CatalogEntry } from './catalog';

/** Display-only geometry; preserve disconnected segments instead of joining them. */
export function collectionHighlightData(entry: CatalogEntry): FeatureCollection {
  let geometry: Geometry;
  if (entry.kind === 'track') geometry = { type: 'MultiLineString', coordinates: entry.track.segments };
  else if (entry.kind === 'route') geometry = { type: 'MultiLineString', coordinates: entry.route.route.segments?.map(s => s.coordinates) ?? [entry.route.route.coordinates] };
  else if (entry.kind === 'measurement') geometry = { type: 'LineString', coordinates: entry.measurement.points.map(p => p.coordinates) };
  else if (entry.kind === 'area') geometry = { type: 'LineString', coordinates: [...entry.area.boundary, entry.area.boundary[0]] };
  else geometry = { type: 'Point', coordinates: entry.coordinates };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry,
    properties: { role: 'collectionHighlight', color: '#20b978', width: 12, opacity: 0.32, pointSize: 34 } }] };
}

export function flashCollectionSelection(map: LibreMap, data: FeatureCollection): () => void {
  const id = 'shantu-collection-highlight';
  const cleanup = () => { clearTimeout(timer); for (const layer of [id+'-line', id+'-point']) if (map.getLayer(layer)) map.removeLayer(layer); if (map.getSource(id)) map.removeSource(id); };
  map.addSource(id, { type:'geojson', data });
  map.addLayer({ id:id+'-line', source:id, type:'line', filter:['!=',['geometry-type'],'Point'],
    layout:{'line-cap':'round','line-join':'round'}, paint:{'line-color':'#20b978','line-width':12,'line-opacity':0.32,'line-blur':4} });
  map.addLayer({ id:id+'-point', source:id, type:'circle', filter:['==',['geometry-type'],'Point'],
    paint:{'circle-radius':16,'circle-color':'#20b978','circle-opacity':0,'circle-stroke-color':'#20b978','circle-stroke-width':5,'circle-stroke-opacity':0.65} });
  const timer = setTimeout(cleanup, 760);
  return cleanup;
}
