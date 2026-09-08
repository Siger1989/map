import type { Map, ExpressionSpecification } from 'maplibre-gl';
import type { WeatherData } from './data';
import { temperatureFeatures, TEMPERATURE_COLORS } from './temperature';
import { syncOverlayData } from '../map/overlayData';

/** Forecast grid only. Missing cells stay transparent; roads and labels remain above it. */
export class TemperatureLayer {
  constructor(private map: Map) {
    map.addSource('temperature-grid', {
      type: 'geojson',
      data: temperatureFeatures(null, 0),
    });
    const before = map
      .getStyle()
      .layers.find((l) =>
        [
          'rivers',
          'domestic-labels-image',
          'domestic-labels-map',
          'route-outline',
        ].includes(l.id),
      )?.id;
    map.addLayer(
      {
        id: 'temperature-grid',
        type: 'fill',
        source: 'temperature-grid',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'temperature'],
            ...TEMPERATURE_COLORS.flat(),
          ] as ExpressionSpecification,
          'fill-opacity': 0.9,
          'fill-opacity-transition': { duration: 0 },
        },
      },
      before,
    );
  }
  update(data: WeatherData | null, index: number, visible: boolean) {
    syncOverlayData(
      this.map,
      'temperature-grid',
      temperatureFeatures(visible ? data : null, index),
    );
    this.map.setLayoutProperty(
      'temperature-grid',
      'visibility',
      visible ? 'visible' : 'none',
    );
  }
}
