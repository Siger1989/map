import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { rasterOverviewSource } from '../modules/mapSources/rasterOverview.ts';

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const longitude = (tx) => tx / n * 360 - 180;
  const latitude = (ty) => Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI;
  return [longitude(x), latitude(y + 1), longitude(x + 1), latitude(y)];
}

test('overview keeps source footprint and metadata while selecting two lower detail levels', () => {
  for (const tileSize of [256, 512]) {
    const original = {
      type: 'raster',
      tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
      tileSize,
      minzoom: 3,
      maxzoom: 19,
      scheme: 'tms',
      bounds: [-123, 32, -116, 39],
      attribution: 'Example provider',
    };
    const overview = rasterOverviewSource(original, 'online');
    assert.equal(overview.tileSize, tileSize * 4);
    assert.deepEqual(overview.tiles, original.tiles);
    assert.equal(overview.scheme, original.scheme);
    assert.deepEqual(overview.bounds, original.bounds);
    assert.equal(overview.minzoom, original.minzoom);
    assert.equal(overview.maxzoom, original.maxzoom);
    assert.equal(overview.attribution, original.attribution);
    assert.notEqual(overview.tiles, original.tiles);
    assert.equal(original.tileSize, tileSize);
  }
});

test('a level z-2 overview tile covers exactly its 4 by 4 detail children', () => {
  const z = 12;
  const x = 2317;
  const y = 1463;
  const overview = tileBounds(z - 2, Math.floor(x / 4), Math.floor(y / 4));
  const children = Array.from({ length: 16 }, (_, i) =>
    tileBounds(z, Math.floor(x / 4) * 4 + i % 4, Math.floor(y / 4) * 4 + Math.floor(i / 4)),
  );
  assert.equal(Math.min(...children.map((b) => b[0])), overview[0]);
  assert.equal(Math.max(...children.map((b) => b[2])), overview[2]);
  assert.equal(Math.min(...children.map((b) => b[1])), overview[1]);
  assert.equal(Math.max(...children.map((b) => b[3])), overview[3]);
});

test('OVMAP base definitions are accepted while unrelated source kinds cannot be passed', () => {
  const source = {
    type: 'raster',
    tiles: ['shantu-map://selected-base/{z}/{x}/{y}'],
    tileSize: 256,
    minzoom: 2,
    maxzoom: 18,
  };
  assert.equal(rasterOverviewSource(source, 'ovmap-base').tileSize, 1024);
  assert.throws(() => rasterOverviewSource(source, 'ovmap-overlay'), /limited to online and OVMAP base/);
  assert.throws(() => rasterOverviewSource({ ...source, tileSize: 1024 }, 'online'), /effective 256px or 512px/);
  assert.throws(() => rasterOverviewSource({ ...source, type: 'raster-dem' }, 'online'), /raster tile source/);
  assert.throws(() => rasterOverviewSource({ type: 'raster', url: 'https://tiles.example/tilejson' }, 'online'), /explicit tile template/);
});

test('MapLibre style validation accepts 1024px and 2048px raster source tile sizes', () => {
  for (const tileSize of [1024, 2048]) {
    const errors = validateStyleMin({
      version: 8,
      sources: {
        overview: {
          type: 'raster',
          tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
          tileSize,
          minzoom: 3,
          maxzoom: 19,
          bounds: [-123, 32, -116, 39],
        },
      },
      layers: [{ id: 'overview', type: 'raster', source: 'overview' }],
    });
    assert.deepEqual(errors, [], `${tileSize}px should satisfy the installed MapLibre style spec`);
  }
});
