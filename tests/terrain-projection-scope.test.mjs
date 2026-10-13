import test from 'node:test';
import assert from 'node:assert/strict';
import { MercatorCoordinate } from 'maplibre-gl';
import { withTerrainProjectionScope } from '../modules/map/terrainProjectionScope.ts';

const extent = 8192;
function coverageKey(lngLat, zoom) {
  const mercator = MercatorCoordinate.fromLngLat(lngLat);
  const wrap = Math.floor(mercator.x);
  const scale = 1 << zoom;
  return `${wrap}/${zoom}/${Math.floor((mercator.x - wrap) * scale)}/${Math.floor(mercator.y * scale)}`;
}

function makeIndex(entries = new Map(), zooms = [2, 1]) {
  return { zooms, samplerPerTile: entries, minElevation: 0, maxElevation: 100 };
}

function makeTerrain(index, maxzoom = 14) {
  const stats = { coverageReads: 0, coveringCalls: 0, zoomCalls: [], samplerCalls: 0, elevationCalls: 0 };
  const terrain = {
    exaggeration: 2,
    tileManager: { maxzoom, minzoom: 0 },
    index,
    getCoverageIndex() { stats.coverageReads++; return this.index; },
    getElevationForLngLat(lngLat, transform) {
      stats.elevationCalls++;
      const coverage = this.getCoverageIndex();
      if (coverage) {
        const mercator = MercatorCoordinate.fromLngLat(lngLat);
        if (!(mercator.y < 0 || mercator.y >= 1)) {
          const wrap = Math.floor(mercator.x);
          const wrappedX = mercator.x - wrap;
          for (const zoom of coverage.zooms) {
            const scale = 1 << zoom;
            const tileX = Math.floor(wrappedX * scale);
            const tileY = Math.floor(mercator.y * scale);
            const key = `${wrap}/${zoom}/${tileX}/${tileY}`;
            if (!coverage.samplerPerTile.has(key)) continue;
            const sampler = coverage.samplerPerTile.get(key);
            if (sampler) {
              stats.samplerCalls++;
              return sampler((wrappedX * scale - tileX) * extent,
                (mercator.y * scale - tileY) * extent, extent) * this.exaggeration;
            }
            break;
          }
        }
      }
      stats.coveringCalls++;
      let zoom = 0;
      for (const tile of transform.coveringTiles()) {
        if (tile.canonical.z > zoom) zoom = Math.min(tile.canonical.z, this.tileManager.maxzoom);
      }
      return this.getElevationForLngLatZoom(lngLat, zoom);
    },
    getElevationForLngLatZoom(lngLat, zoom) {
      stats.zoomCalls.push([lngLat, zoom]);
      return zoom + (Number(lngLat[0]) || 0) / 1000;
    },
  };
  return { terrain, stats };
}

test('100 uncovered projections reuse exact fallback zoom and preserve native output', () => {
  const lngLat = [31, 42];
  const makeTransform = () => ({ coveringTiles: () => [{ canonical: { z: 7 } }, { canonical: { z: 9 } }] });
  const baseline = makeTerrain(makeIndex());
  const expected = Array.from({ length: 100 }, () => baseline.terrain.getElevationForLngLat(lngLat, makeTransform()));
  const scoped = makeTerrain(makeIndex());
  const transform = makeTransform();
  const actual = withTerrainProjectionScope({ terrain: scoped.terrain }, () =>
    Array.from({ length: 100 }, () => scoped.terrain.getElevationForLngLat(lngLat, transform)));

  assert.deepEqual(actual, expected);
  assert.equal(baseline.stats.coveringCalls, 100);
  assert.equal(scoped.stats.coveringCalls, 1);
  assert.equal(scoped.stats.zoomCalls.length, 100, 'all elevation samples still use the original zoom sampler');
});

test('loaded tile points use the original loaded sample path without covering-tile fallback', () => {
  const lngLat = [0, 0];
  const key = coverageKey(lngLat, 2);
  const entries = new Map([[key, () => 17]]);
  const { terrain, stats } = makeTerrain(makeIndex(entries));
  const actual = withTerrainProjectionScope({ terrain }, () => terrain.getElevationForLngLat(lngLat, {}));

  assert.equal(actual, 34);
  assert.equal(stats.coveringCalls, 0);
  assert.equal(stats.samplerCalls, 1);
  assert.equal(stats.zoomCalls.length, 0);
});

test('a null first matching sampler is unloaded and does not fall through to a loaded parent', () => {
  const lngLat = [0, 0];
  const parentKey = coverageKey(lngLat, 1);
  const entries = new Map([[coverageKey(lngLat, 2), null], [parentKey, () => 88]]);
  const { terrain, stats } = makeTerrain(makeIndex(entries));
  const transform = { coveringTiles: () => [{ canonical: { z: 6 } }] };
  const values = withTerrainProjectionScope({ terrain }, () => [
    terrain.getElevationForLngLat(lngLat, transform),
    terrain.getElevationForLngLat(lngLat, transform),
  ]);

  assert.deepEqual(values, [6, 6]);
  assert.equal(stats.coveringCalls, 1);
  assert.equal(stats.samplerCalls, 0);
});

test('fallback zoom cache is keyed by transform identity and reset for the next callback', () => {
  const lngLat = [20, 35];
  const { terrain, stats } = makeTerrain(null);
  const transformA = { coveringTiles: () => [{ canonical: { z: 5 } }] };
  const transformB = { coveringTiles: () => [{ canonical: { z: 8 } }] };
  const first = withTerrainProjectionScope({ terrain }, () => [
    terrain.getElevationForLngLat(lngLat, transformA),
    terrain.getElevationForLngLat(lngLat, transformA),
    terrain.getElevationForLngLat(lngLat, transformB),
  ]);
  transformA.coveringTiles = () => [{ canonical: { z: 11 } }];
  terrain.index = makeIndex(new Map([[coverageKey(lngLat, 2), () => 23]]));
  const next = withTerrainProjectionScope({ terrain }, () => terrain.getElevationForLngLat(lngLat, transformA));

  assert.deepEqual(first, [5.02, 5.02, 8.02]);
  assert.equal(next, 46, 'the next callback sees newly loaded DEM data');
  assert.equal(stats.coveringCalls, 2);
  assert.equal(stats.samplerCalls, 1);
});

test('unknown coverage-index shapes use native fallback without caching zoom', () => {
  const { terrain, stats } = makeTerrain({ zooms: [2], samplerPerTile: {} });
  let nativeCalls = 0;
  terrain.getElevationForLngLat = () => { nativeCalls++; return 17; };
  const transform = { coveringTiles: () => [{ canonical: { z: 4 } }] };
  withTerrainProjectionScope({ terrain }, () => {
    assert.equal(terrain.getElevationForLngLat([0, 0], transform), 17);
    assert.equal(terrain.getElevationForLngLat([0, 0], transform), 17);
  });
  assert.equal(nativeCalls, 2, 'unknown shapes bypass the scope wrapper and use the original method');
  assert.equal(stats.coveringCalls, 0);
});

test('throws restore own descriptors; inherited methods are deleted after the scope', () => {
  const { terrain } = makeTerrain(null);
  const originalElevationDescriptor = Object.getOwnPropertyDescriptor(terrain, 'getElevationForLngLat');
  const originalZoomDescriptor = Object.getOwnPropertyDescriptor(terrain, 'getElevationForLngLatZoom');
  const error = new Error('callback failed');
  assert.throws(() => withTerrainProjectionScope({ terrain }, () => {
    terrain.getElevationForLngLat([1, 2], { coveringTiles: () => [{ canonical: { z: 4 } }] });
    throw error;
  }), error);
  assert.deepEqual(Object.getOwnPropertyDescriptor(terrain, 'getElevationForLngLat'), originalElevationDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(terrain, 'getElevationForLngLatZoom'), originalZoomDescriptor);

  let calls = 0;
  const prototype = {
    exaggeration: 1,
    getCoverageIndex() { return null; },
    getElevationForLngLat() { calls++; return 1; },
    getElevationForLngLatZoom() { return 1; },
  };
  const inheritedTerrain = Object.create(prototype);
  withTerrainProjectionScope({ terrain: inheritedTerrain }, () => {
    assert.equal(Object.hasOwn(inheritedTerrain, 'getElevationForLngLat'), true);
    inheritedTerrain.getElevationForLngLat([], {});
  });
  assert.equal(Object.hasOwn(inheritedTerrain, 'getElevationForLngLat'), false);
  assert.equal(Object.hasOwn(inheritedTerrain, 'getElevationForLngLatZoom'), false);
  assert.equal(calls, 1);
});

test('unmodifiable methods and missing terrain run the callback without wrappers', () => {
  const { terrain } = makeTerrain(null);
  Object.defineProperty(terrain, 'getElevationForLngLat', {
    configurable: false, enumerable: true, writable: false, value: terrain.getElevationForLngLat,
  });
  let callbacks = 0;
  const callback = () => ++callbacks;
  assert.equal(withTerrainProjectionScope({ terrain }, callback), 1);
  assert.equal(withTerrainProjectionScope({}, callback), 2);
  assert.equal(callbacks, 2);
});
