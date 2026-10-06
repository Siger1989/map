import type { Coordinates, ImageSource, Map } from 'maplibre-gl';
import type { LayerSettings } from '../map/types';
import { buildRainRaster, type RainRaster } from './rain.ts';
import type { WeatherData } from './data.ts';

const RAIN_ORDER_ANCHORS = new Set([
  'rivers', 'road-outline', 'main-roads', 'local-roads', 'railways',
  'route-outline', 'route-path', 'route-access', 'route-points',
  'route-point-labels', 'area-fill', 'area-border', 'position-accuracy',
  'position-dot', 'position-arrow', 'position-ip-label',
]);
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';
const PLACEHOLDER_COORDINATES: Coordinates = [[0, 1], [1, 1], [1, 0], [0, 0]];

type RainImage = { url: string; coordinates: Coordinates };

function imageCoordinates([west, south, east, north]: RainRaster['bounds']): Coordinates {
  return [[west, north], [east, north], [east, south], [west, south]];
}

function encodeRainRaster(raster: RainRaster): RainImage | null {
  try {
    if (typeof document === 'undefined') throw new Error('document is unavailable');
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context is unavailable');
    const image = context.createImageData(raster.width, raster.height);
    image.data.set(raster.pixels);
    context.putImageData(image, 0, 0);
    return { url: canvas.toDataURL('image/png'), coordinates: imageCoordinates(raster.bounds) };
  } catch (error) {
    console.error('Rain raster image could not be encoded:', error);
    return null;
  }
}

/** Model forecast image overlay; it is static and does not simulate rain drops. */
export class WeatherLayer {
  private readonly map: Map;
  private cachedData: WeatherData | null = null;
  private cachedIndex = -1;
  private cachedImage: RainImage | null = null;
  private hasCache = false;

  constructor(map: Map) {
    this.map = map;
    map.addSource('rain-grid', {
      type: 'image',
      url: TRANSPARENT_PIXEL,
      coordinates: PLACEHOLDER_COORDINATES,
    });
    const before = map.getStyle().layers.find((layer) =>
      RAIN_ORDER_ANCHORS.has(layer.id) ||
      layer.id.startsWith('domestic-labels-') ||
      layer.type === 'symbol',
    )?.id;
    map.addLayer(
      {
        id: 'rain-grid',
        type: 'raster',
        source: 'rain-grid',
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 0.6,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
      before,
    );
  }

  update(data: WeatherData | null, index: number, settings: LayerSettings) {
    this.map.setPaintProperty('rain-grid', 'raster-opacity', settings.opacity);
    const source = this.map.getSource('rain-grid') as ImageSource | undefined;
    const visible = settings.rain && data !== null;
    if (!visible || !source || typeof source.updateImage !== 'function') {
      this.map.setLayoutProperty('rain-grid', 'visibility', 'none');
      if (visible && !source)
        console.error('Rain raster image source is unavailable.');
      return;
    }

    if (this.hasCache && this.cachedData === data && this.cachedIndex === index) {
      this.map.setLayoutProperty('rain-grid', 'visibility', this.cachedImage ? 'visible' : 'none');
      return;
    }

    const raster = buildRainRaster(data, index);
    if (!raster) {
      this.cachedData = data;
      this.cachedIndex = index;
      this.cachedImage = null;
      this.hasCache = true;
      this.map.setLayoutProperty('rain-grid', 'visibility', 'none');
      return;
    }
    const image = encodeRainRaster(raster);
    if (!image) {
      this.map.setLayoutProperty('rain-grid', 'visibility', 'none');
      return;
    }
    try {
      source.updateImage(image);
    } catch (error) {
      console.error('Rain raster image could not be updated:', error);
      this.map.setLayoutProperty('rain-grid', 'visibility', 'none');
      return;
    }
    this.cachedData = data;
    this.cachedIndex = index;
    this.cachedImage = image;
    this.hasCache = true;
    this.map.setLayoutProperty('rain-grid', 'visibility', 'visible');
  }
}
