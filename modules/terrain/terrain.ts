import type { Map, StyleSpecification, VectorTileSource } from 'maplibre-gl';
import { contourInterval, contourTileOptions } from './contourInterval';
import { elevationExpression, contourColorExpression } from './elevationColors';
import {
  basemapConfiguration,
  tiandituTiles,
  TIANDITU_CREDIT,
} from '../cartography/basemaps';
import { TERRAIN_URL } from './tiles';
import { SENTINEL_TILES, SENTINEL_MAXZOOM, SENTINEL_CREDIT } from '../cartography/sentinel';
import { TIANDITU_LAYERS, TDT_SOURCE_IDS } from '../cartography/tianditu';
export { TERRAIN_URL } from './tiles';
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
      sentinel: { type: 'raster', tiles: SENTINEL_TILES, tileSize: 256, maxzoom: SENTINEL_MAXZOOM, attribution: SENTINEL_CREDIT },
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
        minzoom: domestic ? 1 : 0,
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
        minzoom: domestic ? 1 : 0,
        tiles: domestic
          ? tiandituTiles('img', token)
          : SENTINEL_TILES,
        tileSize: 256,
        maxzoom: domestic ? 18 : SENTINEL_MAXZOOM,
        attribution: domestic
          ? TIANDITU_CREDIT
          : SENTINEL_CREDIT,
      },
      ...(domestic
        ? {
            ...Object.fromEntries((['ter', 'cta', 'ibo'] as const).map(layer => [TDT_SOURCE_IDS[layer], {
              type: 'raster' as const, tiles: tiandituTiles(layer, token), tileSize: 256,
              minzoom: 1, maxzoom: TIANDITU_LAYERS[layer].maxzoom, attribution: TIANDITU_CREDIT,
            }])),
            'domestic-labels-image': {
              type: 'raster' as const,
              minzoom: 1,
              tiles: tiandituTiles('cia', token),
              tileSize: 256,
              maxzoom: 18,
              attribution: TIANDITU_CREDIT,
            },
            'domestic-labels-map': {
              type: 'raster' as const,
              minzoom: 1,
              tiles: tiandituTiles('cva', token),
              tileSize: 256,
              maxzoom: 19,
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
        layout: { visibility: 'none' },
        paint: { 'raster-saturation': -0.15, 'raster-brightness-max': 0.8 },
      },
      {
        id: 'detail',
        type: 'raster',
        source: 'detail',
        layout: { visibility: 'none' },
        paint: { 'raster-saturation': -0.1, 'raster-brightness-max': 0.93 },
      },
      { id: 'sentinel', type: 'raster', source: 'sentinel', paint: { 'raster-fade-duration': 0 } },
      ...(domestic ? [{ id: 'domestic-terrain', type: 'raster' as const, source: 'domestic-terrain', layout: { visibility: 'none' as const } }] : []),
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
            ...(['cta', 'ibo'] as const).map(layer => ({ id: TDT_SOURCE_IDS[layer], type: 'raster' as const, source: TDT_SOURCE_IDS[layer], layout: { visibility: 'none' as const } })),
            {
              id: 'domestic-labels-image',
              type: 'raster' as const,
              source: 'domestic-labels-image',
              layout: { visibility: 'none' as const },
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
const contourStates = new WeakMap<Map, { interval: number; url: (value: number) => string }>();
let contourProtocolSequence = 0;
// One bounded DEM/contour cache and shared worker across quality changes and map remounts.
let sharedContourDem: InstanceType<(typeof import('maplibre-contour'))['default']['DemSource']> | undefined;
export function syncContourInterval(map: Map, value: unknown) {
  const state = contourStates.get(map), interval = contourInterval(value);
  if (!state || state.interval === interval) return;
  const source = map.getSource('contour-lines') as VectorTileSource | undefined;
  if (!source) return;
  source.setTiles([state.url(interval)]);
  state.interval = interval;
}
export async function addContours(map: Map, interval: unknown = 30, alive = () => true) {
  const [{ default: contour }, maplibre] = await Promise.all([
    import('maplibre-contour'),
    import('maplibre-gl'),
  ]);
  if (!alive() || map.getSource('contour-lines')) return;
  const dem = sharedContourDem ??= new contour.DemSource({
    url: window.location.origin + TERRAIN_URL,
    encoding: 'terrarium',
    maxzoom: TERRAIN_MAXZOOM,
    worker: true,
    cacheSize: 40,
    timeoutMs: 15000,
  });
  const protocol = `shantu-contours-${++contourProtocolSequence}`;
  const url = (value: number) => `${protocol}://{z}/{x}/{y}?interval=${value}`;
  maplibre.addProtocol(protocol, async (request, abort) => {
    const match = /:\/\/(\d+)\/(\d+)\/(\d+)\?interval=(30|50|100|200)$/.exec(request.url);
    if (!match) throw new Error('Invalid contour tile');
    const [, zs, xs, ys, quality] = match;
    const z = Number(zs), x = Number(xs), y = Number(ys);
    if (z > 15 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid contour coordinates');
    const result = await dem.manager.fetchContourTile(z, x, y, contourTileOptions(Number(quality), z), abort);
    return { data: result.arrayBuffer };
  });
  const state = { interval: contourInterval(interval), url };
  contourStates.set(map, state);
  map.once('remove', () => { contourStates.delete(map); maplibre.removeProtocol(protocol); });
  map.addSource('contour-lines', {
    type: 'vector',
    tiles: [url(state.interval)],
    minzoom: 7,
    maxzoom: 15,
  });
  map.addLayer({
    id: 'contours',
    type: 'line',
    source: 'contour-lines',
    'source-layer': 'contours',
    minzoom: 7,
    layout: { visibility: 'none' },
    paint: {
      'line-color': contourColorExpression,
      'line-opacity': 0.8,
      'line-width': ['case', ['>', ['get', 'level'], 0], 1.05, 0.45],
    },
  });
  map.addLayer({
    id: 'contour-labels',
    type: 'symbol',
    source: 'contour-lines',
    'source-layer': 'contours',
    minzoom: 7,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'symbol-spacing': 210,
      'text-padding': 5,
      'text-keep-upright': true,
    },
    paint: {
      'text-color': '#fff1c9',
      'text-halo-color': '#1a3034',
      'text-halo-width': 1.4,
    },
  });
}
