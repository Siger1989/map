import test from 'node:test';
import assert from 'node:assert/strict';
import { planImportedRouteDownload } from '../modules/outdoor/importedRouteDownload.ts';
import { downloadTiles } from '../modules/outdoor/downloadPlan.ts';

test('offline route planning generates OVMAP y! URLs from raw XYZ rows exactly once', () => {
  const area = { kind: 'route', segments: [[[104, 30], [104.01, 30.01]]], bufferKm: 4 };
  const source = {
    id: 'fixture-jilin',
    name: 'Synthetic reverse-row raster',
    kind: 'online',
    format: 'OVMAP',
    attribution: 'synthetic test fixture',
    minzoom: 4,
    maxzoom: 4,
    tileSize: 256,
    scheme: 'xyz',
    tiles: ['https://tiles.example.invalid/{$z}/{$x}/{$y!}.png?token=fake-token'],
    ovmap: { layers: [{
      tiles: ['https://tiles.example.invalid/{$z}/{$x}/{$y!}.png?token=fake-token'],
      tileSize: 256,
      minzoom: 4,
      maxzoom: 4,
    }] },
  };
  const outputTiles = downloadTiles(area, 4, 250_000, false, 4);
  const expected = new Set(outputTiles.map(({ z, x, y }) =>
    `https://tiles.example.invalid/${z}/${x}/${2 ** z - 1 - y}.png?token=fake-token`));

  const plan = planImportedRouteDownload(area, source, 4);

  assert.ok(plan.urls.length > 0);
  assert.deepEqual(new Set(plan.urls), expected);
  assert.equal(plan.urls.length, expected.size, 'unique request accounting remains unchanged');
});
