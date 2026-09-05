import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { FeatureCollection, Feature } from 'geojson';
import type { RouteOverlay } from './types';

/** Draped GeoJSON route and endpoints, independent of roads/terrain providers. */
export class RouteLayer {
  constructor(private map: Map) {}
  sync(state: RouteOverlay) {
    const m = this.map;
    if (!m.getSource('planned-route'))
      m.addSource('planned-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        attribution:
          'Routes: <a href="https://valhalla.openstreetmap.de/" target="_blank">FOSSGIS / Valhalla</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      });
    if (!m.getLayer('route-outline')) {
      m.addLayer({
        id: 'route-outline',
        type: 'line',
        source: 'planned-route',
        filter: ['==', '$type', 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#102a38', 'line-width': 8 },
      });
      m.addLayer({
        id: 'route-path',
        type: 'line',
        source: 'planned-route',
        filter: ['==', '$type', 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#59dcff', 'line-width': 4 },
      });
      m.addLayer({
        id: 'route-points',
        type: 'circle',
        source: 'planned-route',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-color': [
            'match',
            ['get', 'slot'],
            'start',
            '#9de8c4',
            '#ffb78a',
          ],
          'circle-radius': 10,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#12313c',
        },
      });
      m.addLayer({
        id: 'route-point-labels',
        type: 'symbol',
        source: 'planned-route',
        filter: ['==', '$type', 'Point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#0c2530' },
      });
    }
    const features: Feature[] = [];
    if (state.route)
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: state.route.coordinates },
      });
    for (const slot of ['start', 'end'] as const)
      if (state[slot])
        features.push({
          type: 'Feature',
          properties: { slot, label: slot === 'start' ? '起' : '终' },
          geometry: { type: 'Point', coordinates: state[slot]!.coordinates },
        });
    (m.getSource('planned-route') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    } as FeatureCollection);
    for (const id of [
      'route-outline',
      'route-path',
      'route-points',
      'route-point-labels',
    ])
      m.moveLayer(id);
  }
}
