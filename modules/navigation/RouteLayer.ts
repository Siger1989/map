import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData';
import type { FeatureCollection, Feature } from 'geojson';
import type { RouteOverlay } from './types';
import type { ScreenPoint } from '../tracks/drawing';

/** Draped GeoJSON route and endpoints, independent of roads/terrain providers. */
export class RouteLayer {
  private hasRoute = false;
  constructor(private map: Map) {}
  pick(point: ScreenPoint): boolean {
    if (!this.hasRoute) return false;
    const layers = ['route-path', 'route-access', 'route-points'].filter((id) => this.map.getLayer(id));
    if (!layers.length) return false;
    return this.map.queryRenderedFeatures(
      [[point.x - 12, point.y - 12], [point.x + 12, point.y + 12]],
      { layers },
    ).length > 0;
  }
  sync(state: RouteOverlay) {
    const m = this.map;
    this.hasRoute = Boolean(state.route);
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
        filter: [
          'all',
          ['==', '$type', 'LineString'],
          ['!=', 'kind', 'access'],
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#102a38', 'line-width': 8 },
      });
      m.addLayer({
        id: 'route-path',
        type: 'line',
        source: 'planned-route',
        filter: [
          'all',
          ['==', '$type', 'LineString'],
          ['!=', 'kind', 'access'],
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#59dcff'],
          'line-width': 4,
        },
      });
      m.addLayer({
        id: 'route-access',
        type: 'line',
        source: 'planned-route',
        filter: ['==', 'kind', 'access'],
        paint: {
          'line-color': '#ffcb65',
          'line-width': 4,
          'line-dasharray': [2, 2],
        },
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
            'via',
            '#cae3ff',
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
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
          'text-anchor': 'top',
          'text-offset': [0, 1.7],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#14392e', 'text-halo-width': 2 },
      });
    }
    const features: Feature[] = [];
    if (state.route && state.displayParts)
      for (const part of state.displayParts)
        features.push({
          type: 'Feature',
          properties: { kind: 'road', color: part.color },
          geometry: { type: 'LineString', coordinates: part.coordinates },
        });
    if (state.route)
      for (const segment of state.route.segments ?? [
        { kind: 'road', coordinates: state.route.coordinates },
      ]) {
        if (state.displayParts && segment.kind !== 'access') continue;
        features.push({
          type: 'Feature',
          properties: { kind: segment.kind },
          geometry: { type: 'LineString', coordinates: segment.coordinates },
        });
      }
    for (const slot of ['start', 'end'] as const)
      if (state[slot])
        features.push({
          type: 'Feature',
          properties: { slot, label: slot === 'start' ? '起点' : '终点' },
          geometry: { type: 'Point', coordinates: state[slot]!.coordinates },
        });
    for (const [index, place] of (state.via ?? []).entries())
      if (place)
        features.push({
          type: 'Feature',
          properties: { slot: 'via', label: String(index + 1) },
          geometry: { type: 'Point', coordinates: place.coordinates },
        });
    syncOverlayData(m, 'planned-route', {
      type: 'FeatureCollection',
      features,
    } as FeatureCollection);
  }
}
