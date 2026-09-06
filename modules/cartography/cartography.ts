import type {
  Map,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { LayerSettings } from '../map/types';
const chineseName: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:zh'],
  ['get', 'name:nonlatin'],
  ['get', 'name'],
  ['get', 'name:latin'],
];
const ROAD_IDS = [
  'rivers',
  'road-outline',
  'main-roads',
  'local-roads',
  'railways',
  'road-names',
  'road-numbers',
];
const LABEL_IDS = [
  'city-names',
  'town-names',
  'village-names',
  'neighborhood-names',
  'peak-names',
  'water-names',
];

/** Geographic context is independent of terrain, satellite imagery and weather. */
export function addCartography(map: Map) {
  if (map.getSource('openmaptiles')) return;
  map.addSource('openmaptiles', {
    type: 'vector',
    url: 'https://tiles.openfreemap.org/planet',
  });
  for (const [id, sourceLayer, color] of [
    ['open-landcover', 'landcover', '#36524b'],
    ['open-water', 'water', '#285368'],
    ['open-buildings', 'building', '#72857c'],
  ])
    map.addLayer(
      {
        id,
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': sourceLayer,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': color,
          'fill-opacity': id === 'open-landcover' ? 0.45 : 0.85,
        },
      },
      'hillshade',
    );
  map.addLayer({
    id: 'rivers',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'waterway',
    paint: {
      'line-color': '#77c6dc',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        0.5,
        13,
        1.5,
        16,
        3,
      ],
      'line-opacity': 0.75,
    },
  });
  const major: ExpressionSpecification = [
    'match',
    ['get', 'class'],
    ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
    true,
    false,
  ];
  map.addLayer({
    id: 'road-outline',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter: major,
    minzoom: 6,
    paint: {
      'line-color': '#1b3034',
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.8, 12, 3, 16, 7],
      'line-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'main-roads',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter: major,
    minzoom: 6,
    paint: {
      'line-color': [
        'match',
        ['get', 'class'],
        ['motorway', 'trunk'],
        '#efc176',
        '#e3ded1',
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        0.7,
        12,
        1.8,
        16,
        5,
      ],
      'line-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'local-roads',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: 12,
    filter: [
      'match',
      ['get', 'class'],
      ['minor', 'service', 'track', 'path'],
      true,
      false,
    ],
    paint: {
      'line-color': '#bbc8bd',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 2.1],
      'line-opacity': 0.65,
    },
  });
  map.addLayer({
    id: 'railways',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: 9,
    filter: ['==', ['get', 'class'], 'rail'],
    paint: {
      'line-color': '#b7a5c9',
      'line-width': 1.1,
      'line-dasharray': [3, 3],
    },
  });
  const addLabel = (
    id: string,
    sourceLayer: string,
    minzoom: number,
    filter?: ExpressionSpecification,
    size = 13,
    line = false,
    field = chineseName,
  ) => {
    const layer: SymbolLayerSpecification = {
      id,
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': sourceLayer,
      minzoom,
      ...(filter ? { filter } : {}),
      layout: {
        'text-field': field,
        'text-font': ['Noto Sans Regular'],
        'text-size': size,
        'text-max-width': 9,
        'text-padding': 10,
        'text-allow-overlap': false,
        'symbol-placement': line ? 'line' : 'point',
        'symbol-spacing': 360,
      },
      paint: {
        'text-color': '#f4f4e9',
        'text-halo-color': '#172c36',
        'text-halo-width': 1.8,
      },
    };
    map.addLayer(layer);
  };
  addLabel('road-numbers', 'transportation_name', 8, ['has', 'ref'], 11, true, [
    'get',
    'ref',
  ]);
  addLabel('road-names', 'transportation_name', 12, undefined, 12, true);
  addLabel('water-names', 'water_name', 9, undefined, 12);
  addLabel(
    'neighborhood-names',
    'place',
    12,
    [
      'match',
      ['get', 'class'],
      ['suburb', 'neighbourhood', 'quarter', 'hamlet'],
      true,
      false,
    ],
    12,
  );
  addLabel(
    'village-names',
    'place',
    11,
    ['==', ['get', 'class'], 'village'],
    12,
  );
  addLabel('town-names', 'place', 8, ['==', ['get', 'class'], 'town'], 14);
  addLabel(
    'city-names',
    'place',
    3,
    ['match', ['get', 'class'], ['city', 'state'], true, false],
    17,
  );
  addLabel('peak-names', 'mountain_peak', 10, undefined, 12, false, [
    'concat',
    '▲ ',
    chineseName,
    [
      'case',
      ['has', 'ele'],
      ['concat', ' ', ['to-string', ['get', 'ele']], ' m'],
      '',
    ],
  ]);
}
export function syncCartography(map: Map, settings: LayerSettings) {
  for (const [ids, visible] of [
    [
      ['open-landcover', 'open-water', 'open-buildings'],
      !settings.satellite && !settings.geology && !settings.elevationColors,
    ],
    [ROAD_IDS, settings.roads],
    [LABEL_IDS, settings.labels],
  ] as const) {
    for (const id of ids)
      if (map.getLayer(id))
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}
