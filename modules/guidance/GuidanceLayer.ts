import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData.ts';
import type { Feature } from 'geojson';
import type { Coordinate, PlannedRoute } from '../navigation/types';
export type GuidanceOverlay = {
  coordinates: Coordinate[];
  segments?: PlannedRoute['segments'];
  target: Coordinate;
} | null;
/** A temporary road route back to the unchanged planned route. */
export class GuidanceLayer {
  private map: Map;
  constructor(map: Map) {
    this.map = map;
  }
  sync(overlay: GuidanceOverlay) {
    const m = this.map;
    if (!m.getSource('route-guidance'))
      m.addSource('route-guidance', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    if (!m.getLayer('guidance-path')) {
      m.addLayer({
        id: 'guidance-outline',
        type: 'line',
        source: 'route-guidance',
        filter: ['all', ['==', '$type', 'LineString'], ['!=', 'kind', 'access']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#30261d', 'line-width': 9 },
      });
      m.addLayer({
        id: 'guidance-path',
        type: 'line',
        source: 'route-guidance',
        filter: ['all', ['==', '$type', 'LineString'], ['!=', 'kind', 'access']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffb052', 'line-width': 5 },
      });
      m.addLayer({
        id: 'guidance-access', type: 'line', source: 'route-guidance', filter: ['==', 'kind', 'access'],
        paint: { 'line-color': '#ffcb65', 'line-width': 4, 'line-dasharray': [2, 2] },
      });
      m.addLayer({
        id: 'guidance-target',
        type: 'circle',
        source: 'route-guidance',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-color': '#ffb052',
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    const features: Feature[] = overlay
      ? [
          ...(overlay.segments ?? [{kind:'road',coordinates:overlay.coordinates}]).map(segment => ({
            type: 'Feature',
            properties: {kind:segment.kind},
            geometry: { type: 'LineString', coordinates: segment.coordinates },
          }) as Feature),
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: overlay.target },
          },
        ]
      : [];
    syncOverlayData(m, 'route-guidance', {
      type: 'FeatureCollection',
      features,
    });
  }
}
