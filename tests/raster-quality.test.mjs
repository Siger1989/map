import test from 'node:test';
import assert from 'node:assert/strict';
import { RasterQuality } from '../modules/cartography/RasterQuality.ts';

function fixture(initialSources) {
  const sources = new Map(Object.entries(initialSources));
  const refreshes = [];
  const map = {
    getSource: (id) => sources.get(id),
    refreshTiles: (id) => refreshes.push(id),
  };
  return { map, sources, refreshes };
}

function raster(id, tileSize = 256, loaded = true) {
  return { id, type: 'raster', tileSize, loaded: () => loaded };
}

test('selected raster switches one detail level and repeated sync does not refresh again', () => {
  const base = raster('base', 256);
  const { map, refreshes } = fixture({ base });
  const quality = new RasterQuality(map);

  quality.sync(['base'], true);
  quality.sync(['base'], true);

  assert.equal(base.tileSize, 128);
  assert.deepEqual(refreshes, ['base']);
});

test('disabling or deselecting restores each source original tile size', () => {
  const first = raster('first', 256);
  const second = raster('second', 512);
  const { map, refreshes } = fixture({ first, second });
  const quality = new RasterQuality(map);

  quality.sync(['first', 'second'], true);
  quality.sync(['second'], true);
  assert.equal(first.tileSize, 256);
  assert.equal(second.tileSize, 256);
  quality.sync(['second'], false);

  assert.equal(second.tileSize, 512);
  assert.deepEqual(refreshes, ['first', 'second', 'first', 'second']);
});

test('source replacement restores the old object and captures the replacement size', () => {
  const oldSource = raster('base', 256);
  const { map, sources, refreshes } = fixture({ base: oldSource });
  const quality = new RasterQuality(map);

  quality.sync(['base'], true);
  const replacement = raster('base', 512);
  sources.set('base', replacement);
  quality.sync(['base'], true);

  assert.equal(oldSource.tileSize, 256);
  assert.equal(replacement.tileSize, 256);
  assert.deepEqual(refreshes, ['base', 'base']);
});

test('ignores DEM sources and waits for raster metadata before capturing tile size', () => {
  const dem = { ...raster('elevation', 256), type: 'raster-dem' };
  const pending = raster('pending', 512, false);
  const { map, refreshes } = fixture({ elevation: dem, pending });
  const quality = new RasterQuality(map);

  quality.sync(['elevation', 'pending'], true);
  assert.equal(dem.tileSize, 256);
  assert.equal(pending.tileSize, 512);
  assert.deepEqual(refreshes, []);

  pending.loaded = () => true;
  quality.sync(['pending'], true);
  assert.equal(pending.tileSize, 256);
  assert.deepEqual(refreshes, ['pending']);
});
