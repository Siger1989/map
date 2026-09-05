import type { Map, StyleSpecification } from 'maplibre-gl';
export const TERRAIN_URL =
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_CREDIT =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Terrain: Mapzen / USGS / SRTM</a>';
export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    terrain: { source: 'elevation', exaggeration: 1.3 },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      elevation: {
        type: 'raster-dem',
        tiles: [TERRAIN_URL],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: TERRAIN_CREDIT,
      },
      shading: {
        type: 'raster-dem',
        tiles: [TERRAIN_URL],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
      },
      relief: {
        type: 'raster',
        tiles: [
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
        ],
        tileSize: 256,
        maxzoom: 8,
        attribution:
          '<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA GIBS</a>',
      },
      detail: {
        type: 'raster',
        tiles: [
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution:
          '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) · CC BY-NC-SA 4.0</a>',
      },
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
    url: TERRAIN_URL,
    encoding: 'terrarium',
    maxzoom: 14,
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
