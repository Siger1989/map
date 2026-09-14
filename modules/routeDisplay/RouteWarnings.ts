import type { Map } from 'maplibre-gl';
import type { Coordinate } from '../navigation/types';
import { syncOverlayData } from '../map/overlayData';
export type RouteWarning = { coordinate: Coordinate; label: string };
export function syncRouteWarnings(map: Map, warnings: RouteWarning[]) {
  if (!map.getSource('route-grade-warnings'))
    map.addSource('route-grade-warnings', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  if (!map.getLayer('route-grade-warning-dot')) {
    map.addLayer({
      id: 'route-grade-warning-dot',
      type: 'circle',
      source: 'route-grade-warnings',
      paint: {
        'circle-radius': 5,
        'circle-color': '#d84240',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1,
      },
    });
    map.addLayer({
      id: 'route-grade-warning-label',
      type: 'symbol',
      source: 'route-grade-warnings',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-anchor': 'left',
        'text-offset': [0.9, -1.2],
      },
      paint: {
        'text-color': '#912922',
        'text-halo-color': '#fff',
        'text-halo-width': 2,
      },
    });
  }
  syncOverlayData(map, 'route-grade-warnings', {
    type: 'FeatureCollection',
    features: warnings.map((w) => ({
      type: 'Feature',
      properties: { label: w.label },
      geometry: { type: 'Point', coordinates: w.coordinate },
    })),
  });
}
