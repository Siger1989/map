import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const [{ contents }] = (await build({
  entryPoints: ['modules/mapSources/RasterCoverage.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})).outputFiles;
const { installRasterCoverage } = await import(`data:text/javascript;base64,${Buffer.from(contents).toString('base64')}`);

function tileId(z, x, y, canonicalZ = z) {
  const id = {
    key: `${z}/${x}/${y}`,
    overscaledZ: z,
    canonical: { z: canonicalZ },
    scaledTo(target) {
      const shift = z - target;
      return tileId(target, Math.floor(x / 2 ** shift), Math.floor(y / 2 ** shift), Math.min(target, canonicalZ));
    },
  };
  return id;
}

function makeManager({ type = 'raster', minzoom = 0 } = {}) {
  const tiles = new Map(), calls = [];
  const manager = {
    _source: { type, minzoom },
    _addTile(id) {
      calls.push({ kind: 'add', id });
      if (!tiles.has(id.key)) tiles.set(id.key, { data: false, hasData() { return this.data; } });
      return tiles.get(id.key);
    },
    getTile(id) { return tiles.get(id.key); },
    _updateRetainedTiles(ids, zoom) {
      calls.push({ kind: 'original', ids, zoom });
      return {};
    },
  };
  return { manager, tiles, calls };
}

function makeMap(managers, { pitch = 60, zoom = 8 } = {}) {
  return {
    style: { tileManagers: managers },
    getPitch: () => pitch,
    getZoom: () => zoom,
  };
}

test('requests missing parents before ideal tiles and retains them only while they lack data', () => {
  const { manager, tiles, calls } = makeManager();
  const map = makeMap({ imagery: manager });
  const coverage = installRasterCoverage(map, ['imagery']);
  const ideal = tileId(10, 512, 384);
  try {
    const retained = manager._updateRetainedTiles([ideal], 10);
    assert.deepEqual(calls.map(call => call.kind), ['add', 'original'], 'parent request precedes ideal scheduling');
    const parent = tileId(8, 128, 96);
    assert.equal(calls[0].id.key, parent.key);
    assert.equal(retained[parent.key]?.key, parent.key, 'empty parent remains retained under the loading ideal');

    tiles.get(parent.key).data = true;
    calls.length = 0;
    const covered = manager._updateRetainedTiles([ideal], 10);
    assert.equal(calls.filter(call => call.kind === 'add').length, 0, 'loaded ancestor avoids another fallback request');
    assert.ok(!(parent.key in covered), 'loaded parent need not be retained after its gap is covered');

    const loadedIdeal = manager._addTile(ideal);
    loadedIdeal.data = true;
    calls.length = 0;
    const detailed = manager._updateRetainedTiles([ideal], 10);
    assert.equal(calls.filter(call => call.kind === 'add').length, 0);
    assert.ok(!(parent.key in detailed), 'fine tile data releases the parent fallback');
  } finally {
    coverage.dispose();
  }
});

test('uses canonical zoom minus two, clamps to minzoom, and adds no more than eight unique parents', () => {
  const first = makeManager({ minzoom: 7 });
  const coverage = installRasterCoverage(makeMap({ imagery: first.manager }), ['imagery']);
  try {
    first.manager._updateRetainedTiles([tileId(12, 1280, 1024, 10)], 12);
    assert.equal(first.calls[0].id.overscaledZ, 8, 'target uses canonical z minus two');

    first.manager._source.minzoom = 9;
    first.calls.length = 0;
    first.manager._updateRetainedTiles([tileId(10, 512, 384, 10)], 10);
    assert.equal(first.calls[0].id.overscaledZ, 9, 'target zoom is clamped to source minzoom');
  } finally {
    coverage.dispose();
  }

  const capped = makeManager();
  const cappedCoverage = installRasterCoverage(makeMap({ imagery: capped.manager }), ['imagery']);
  try {
    const ideals = Array.from({ length: 12 }, (_, index) => tileId(10, index * 4, 0));
    capped.manager._updateRetainedTiles(ideals, 10);
    assert.equal(capped.calls.filter(call => call.kind === 'add').length, 8);
  } finally {
    cappedCoverage.dispose();
  }
});

test('does not intercept DEMs, shallow pitch, or high zoom', () => {
  for (const fixture of [
    { type: 'dem', pitch: 60, zoom: 8 },
    { type: 'raster', pitch: 44, zoom: 8 },
    { type: 'raster', pitch: 60, zoom: 12 },
  ]) {
    const { manager, calls } = makeManager({ type: fixture.type });
    const original = manager._updateRetainedTiles;
    const coverage = installRasterCoverage(makeMap({ imagery: manager }, fixture), ['imagery']);
    try {
      const result = manager._updateRetainedTiles([tileId(10, 512, 384)], 10);
      assert.equal(calls.filter(call => call.kind === 'add').length, 0);
      assert.equal(calls.filter(call => call.kind === 'original').length, 1);
      assert.ok(result);
    } finally {
      coverage.dispose();
      if (fixture.type !== 'raster') assert.equal(manager._updateRetainedTiles, original);
    }
  }
});

test('sync restores replaced or missing managers and can wrap a manager when it returns', () => {
  const oldManager = makeManager().manager;
  const replacement = makeManager().manager;
  const oldOriginal = oldManager._updateRetainedTiles;
  const replacementOriginal = replacement._updateRetainedTiles;
  const managers = { imagery: oldManager };
  const coverage = installRasterCoverage(makeMap(managers), ['imagery']);
  try {
    assert.notEqual(oldManager._updateRetainedTiles, oldOriginal);
    managers.imagery = replacement;
    coverage.sync(['imagery']);
    assert.equal(oldManager._updateRetainedTiles, oldOriginal);
    assert.notEqual(replacement._updateRetainedTiles, replacementOriginal);

    delete managers.imagery;
    coverage.sync(['imagery']);
    assert.equal(replacement._updateRetainedTiles, replacementOriginal, 'missing manager is restored');
    managers.imagery = replacement;
    coverage.sync(['imagery']);
    assert.notEqual(replacement._updateRetainedTiles, replacementOriginal, 'manager is wrapped again when restored');
  } finally {
    coverage.dispose();
  }
});

test('dispose does not overwrite a patch installed after raster coverage', () => {
  const { manager } = makeManager();
  const coverage = installRasterCoverage(makeMap({ imagery: manager }), ['imagery']);
  const laterPatch = () => ({ later: true });
  manager._updateRetainedTiles = laterPatch;
  coverage.dispose();
  assert.equal(manager._updateRetainedTiles, laterPatch);
});
