import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData';
import type { FeatureCollection } from 'geojson';
import type { PositionFix } from './types';
import { positionArrowImage } from './positionArrow';
const POSITION_NEUTRAL = '#cbd2cf';
export class PositionLayer {
  constructor(private map: Map) {}
  sync(fix: PositionFix | null, heading: number | null = null) {
    const m = this.map;
    if (!m.getSource('current-position')) {
      m.addSource('current-position', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: 'position-accuracy',
        type: 'fill',
        source: 'current-position',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': POSITION_NEUTRAL, 'fill-opacity': 0.14 },
      });
      m.addLayer({
        id: 'position-dot',
        type: 'circle',
        source: 'current-position',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'heading']]],
        paint: {
          'circle-radius': 6,
          'circle-color': POSITION_NEUTRAL,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      if (!m.hasImage('position-heading-arrow')) m.addImage('position-heading-arrow', positionArrowImage(), { pixelRatio: 2 });
      if (!m.hasImage('position-ip-heading-arrow')) m.addImage('position-ip-heading-arrow', positionArrowImage(), { pixelRatio: 2 });
      m.addLayer({
        id: 'position-arrow', type: 'symbol', source: 'current-position',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'heading']],
        layout: {
          'icon-image': ['case', ['==', ['get', 'provider'], 'ip'], 'position-ip-heading-arrow', 'position-heading-arrow'], 'icon-size': 1.2,
          'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'viewport', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
      });
      m.addLayer({
        id: 'position-ip-label', type: 'symbol', source: 'current-position',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'provider'], 'ip']],
        layout: { 'text-field': 'IP估计', 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': POSITION_NEUTRAL, 'text-halo-color': '#18201f', 'text-halo-width': 1.5 },
      });
    }
    const data: FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (fix) {
      const [lng, lat] = fix.coordinates,
        radius = Math.min(50000, fix.accuracy),
        ring = Array.from({ length: 49 }, (_, i) => {
          const angle = (i / 48) * Math.PI * 2;
          return [
            lng +
              (Math.sin(angle) * radius) /
                (111320 * Math.cos((lat * Math.PI) / 180)),
            lat + (Math.cos(angle) * radius) / 111320,
          ];
        });
      ring[48] = ring[0];
      data.features.push(
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
        {
          type: 'Feature',
          properties: { ...(fix.provider === 'ip' ? { provider: 'ip' } : {}), ...(heading !== null && Number.isFinite(heading) ? { heading: ((heading % 360) + 360) % 360 } : {}) },
          geometry: { type: 'Point', coordinates: fix.coordinates },
        },
      );
    }
    syncOverlayData(m, 'current-position', data);
  }
}
