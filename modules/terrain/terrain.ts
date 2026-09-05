import type { Map, StyleSpecification } from 'maplibre-gl';
import { elevationExpression } from './elevationColors';
import {
  basemapConfiguration,
  tiandituTiles,
  TIANDITU_CREDIT,
} from '../cartography/basemaps';
export const TERRAIN_URL = '/api/terrain/{z}/{x}/{y}.png';
export const TERRAIN_MAXZOOM = 12;
export const TERRAIN_CREDIT =
  '<a href="https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn" target="_blank">成都区域 FABDEM V1-2 · Hawker / Neal · CC BY-NC-SA 4.0</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">其他区域 Mapzen / SRTM</a>';
export function baseStyle(): StyleSpecification {
  const tiles = [window.location.origin + TERRAIN_URL];
  const { domestic, token } = basemapConfiguration();
  return {
    version: 8,
    terrain: { source: 'elevation', exaggeration: 1 },
    glyphs: domestic
      ? window.location.origin + '/fonts/{fontstack}/{range}.pbf'
      : 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      elevation: {
        type: 'raster-dem',
        tiles,
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: TERRAIN_MAXZOOM,
        attribution: TERRAIN_CREDIT,
      },
      shading: {
        type: 'raster-dem',
        tiles,
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: TERRAIN_MAXZOOM,
      },
      relief: {
        type: 'raster',
        tiles: domestic
          ? tiandituTiles('vec', token)
          : [
              'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
            ],
        tileSize: 256,
        maxzoom: domestic ? 18 : 8,
        attribution: domestic
          ? TIANDITU_CREDIT
          : '<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA GIBS</a>',
      },
      detail: {
        type: 'raster',
        tiles: domestic
          ? tiandituTiles('img', token)
          : [
              'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
            ],
        tileSize: 256,
        maxzoom: domestic ? 18 : 14,
        attribution: domestic
          ? TIANDITU_CREDIT
          : '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) · CC BY-NC-SA 4.0</a>',
      },
      ...(domestic
        ? {
            'domestic-labels-image': {
              type: 'raster' as const,
              tiles: tiandituTiles('cia', token),
              tileSize: 256,
              maxzoom: 18,
              attribution: TIANDITU_CREDIT,
            },
            'domestic-labels-map': {
              type: 'raster' as const,
              tiles: tiandituTiles('cva', token),
              tileSize: 256,
              maxzoom: 18,
              attribution: TIANDITU_CREDIT,
            },
          }
        : {}),
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#203b3f' },
      },
      {
        id: 'relief',
        type: 'raster',
        source: 'relief',
        paint: { 'raster-saturation': -0.15, 'raster-brightness-max': 0.8 },
      },
      {
        id: 'detail',
        type: 'raster',
        source: 'detail',
        paint: { 'raster-saturation': -0.1, 'raster-brightness-max': 0.93 },
      },
      {
        id: 'elevation-colors',
        type: 'color-relief',
        source: 'shading',
        layout: { visibility: 'none' },
        paint: {
          'color-relief-color': elevationExpression,
          'color-relief-opacity': 1,
        },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'shading',
        paint: {
          'hillshade-exaggeration': 0.25,
          'hillshade-shadow-color': '#091e2c',
          'hillshade-highlight-color': '#c9d7c5',
          'hillshade-illumination-direction': 315,
        },
      },
      ...(domestic
        ? [
            {
              id: 'domestic-labels-image',
              type: 'raster' as const,
              source: 'domestic-labels-image',
            },
            {
              id: 'domestic-labels-map',
              type: 'raster' as const,
              source: 'domestic-labels-map',
              layout: { visibility: 'none' as const },
            },
          ]
        : []),
    ],
  };
}
export async function addContours(map: Map) {
  const [{ default: contour }, maplibre] = await Promise.all([
    import('maplibre-contour'),
    import('maplibre-gl'),
  ]);
  if (map.getSource('contour-lines')) return;
  const dem = new contour.DemSource({
    url: window.location.origin + TERRAIN_URL,
    encoding: 'terrarium',
    maxzoom: TERRAIN_MAXZOOM,
    worker: true,
    cacheSize: 60,
    timeoutMs: 15000,
  });
  dem.setupMaplibre(maplibre);
  map.addSource('contour-lines', {
    type: 'vector',
    tiles: [
      dem.contourProtocolUrl({
        thresholds: {
          7: [500, 1000],
          10: [200, 1000],
          12: [100, 500],
          14: [50, 200],
        },
        elevationKey: 'ele',
        levelKey: 'level',
        contourLayer: 'contours',
      }),
    ],
    maxzoom: 15,
  });
  map.addLayer({
    id: 'contours',
    type: 'line',
    source: 'contour-lines',
    'source-layer': 'contours',
    minzoom: 7,
    paint: {
      'line-color': '#ebd59d',
      'line-opacity': 0.4,
      'line-width': ['case', ['>', ['get', 'level'], 0], 1.05, 0.45],
    },
  });
  map.addLayer({
    id: 'contour-labels',
    type: 'symbol',
    source: 'contour-lines',
    'source-layer': 'contours',
    minzoom: 7,
    filter: ['>', ['get', 'level'], 0],
    layout: {
      'symbol-placement': 'line',
      'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'symbol-spacing': 280,
    },
    paint: {
      'text-color': '#fff1c9',
      'text-halo-color': '#1a3034',
      'text-halo-width': 1.4,
    },
  });
}
