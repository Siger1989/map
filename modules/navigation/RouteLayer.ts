import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData.ts';
import { metresBetween, type Coordinate, type RouteOverlay } from './types.ts';
import { createRouteFeatures } from './routeFeatures.ts';
import type { ScreenPoint } from '../tracks/drawing';

/** Draped GeoJSON route and endpoints, independent of roads/terrain providers. */
export class RouteLayer {
  private map: Map;
  private hasRoute = false;
  private state: RouteOverlay | null = null;
  private navigationPosition: Coordinate | null = null;
  private startHidden = false;
  constructor(map: Map) { this.map = map; }
  /** Omit the redundant start badge only while it overlaps the navigator. */
  setNavigationPosition(position: Coordinate | null) {
    this.navigationPosition = position;
    if (this.state && this.shouldHideStart(this.state) !== this.startHidden) this.sync(this.state);
  }
  private shouldHideStart(state: RouteOverlay) {
    return !!state.start && !!this.navigationPosition && metresBetween(state.start.coordinates, this.navigationPosition) < 40;
  }
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
    this.state = state;
    this.startHidden = this.shouldHideStart(state);
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
        paint: {
          'line-color': ['case', ['==', ['get', 'navigationState'], 'traveled'], '#384244', '#102a38'],
          'line-width': ['case', ['all', ['==', ['get', 'navigationState'], 'traveled'], ['==', ['get', 'navigationClose'], true]], 18, ['+', ['coalesce', ['get', 'routeWidth'], 4], 4]],
          'line-opacity': ['coalesce', ['get', 'opacity'], 1],
        },
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
          'line-color': ['case',
            ['==', ['get', 'navigationState'], 'future'], '#39c878',
            ['==', ['get', 'navigationState'], 'traveled'], '#8e999b',
            ['coalesce', ['get', 'color'], ['get', 'routeColor'], '#59dcff'],
          ],
          'line-width': ['case', ['all', ['==', ['get', 'navigationState'], 'traveled'], ['==', ['get', 'navigationClose'], true]], 14, ['coalesce', ['get', 'routeWidth'], 4]],
          'line-opacity': ['coalesce', ['get', 'opacity'], 1],
        },
      });
      m.addLayer({
        id: 'route-access',
        type: 'line',
        source: 'planned-route',
        filter: ['==', 'kind', 'access'],
        paint: {
          'line-color': ['case', ['==', ['get', 'navigationState'], 'traveled'], '#8e999b', '#ffcb65'],
          'line-width': ['case', ['all', ['==', ['get', 'navigationState'], 'traveled'], ['==', ['get', 'navigationClose'], true]], 14, 4],
          'line-dasharray': [2, 2],
          'line-opacity': ['coalesce', ['get', 'opacity'], 1],
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
            '#22a46b',
            'via',
            '#cae3ff',
            '#e34f4f',
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
          'text-field': ['concat', ['get', 'label'], ' · ', ['get', 'name']],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
          'text-anchor': 'top',
          'text-offset': [0, 1.7],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': ['match', ['get', 'slot'], 'start', '#126a45', 'end', '#9d2727', '#14392e'],
          'text-halo-width': 2,
        },
      });
    }
    const data = createRouteFeatures(state, this.navigationPosition);
    syncOverlayData(m, 'planned-route', data);
  }
}
