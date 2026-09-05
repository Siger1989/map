import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { PositionFix } from './types';
export class PositionLayer {
  constructor(private map: Map) {}
  sync(fix: PositionFix | null) {
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
        paint: { 'fill-color': '#58c7ff', 'fill-opacity': 0.14 },
      });
      m.addLayer({
        id: 'position-dot',
        type: 'circle',
        source: 'current-position',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#38b9ff',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
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
          properties: {},
          geometry: { type: 'Point', coordinates: fix.coordinates },
        },
      );
    }
    (m.getSource('current-position') as GeoJSONSource).setData(data);
    m.moveLayer('position-accuracy');
    m.moveLayer('position-dot');
  }
}
