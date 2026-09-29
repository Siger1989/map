import test from 'node:test';
import assert from 'node:assert/strict';
import { browseTileCoordinate, registerBrowseTileSource } from '../modules/outdoor/browseTileSources.ts';

test('matches standard XYZ path coordinates and exact query tokens independent of query order', () => {
  const owner = {};
  const release = registerBrowseTileSource(owner, ['https://tiles.example.test/{z}/{x}/{y}.png?token=abc&layer=base']);
  assert.deepEqual(browseTileCoordinate('https://tiles.example.test/8/14/92.png?layer=base&token=abc'), { z: 8, x: 14, y: 92 });
  assert.equal(browseTileCoordinate('https://tiles.example.test/8/14/92.png?layer=base&token=wrong'), undefined);
  release();
  assert.equal(browseTileCoordinate('https://tiles.example.test/8/14/92.png?layer=base&token=abc'), undefined);
});

test('maps ArcGIS coordinate ordering and query-only coordinate placeholders', () => {
  const owner = {};
  const release = registerBrowseTileSource(owner, [
    'https://services.example.test/MapServer/tile/{z}/{y}/{x}?token=abc',
    'https://query.example.test/arcgis?token=abc&level={z}&row={y}&column={x}',
  ]);
  assert.deepEqual(browseTileCoordinate('https://services.example.test/MapServer/tile/9/44/22?token=abc'), { z: 9, x: 22, y: 44 });
  assert.deepEqual(browseTileCoordinate('https://query.example.test/arcgis?column=22&row=44&token=abc&level=9'), { z: 9, x: 22, y: 44 });
  release();
});

test('converts TMS rows to XYZ and rejects invalid matrix coordinates', () => {
  const owner = {};
  const release = registerBrowseTileSource(owner, ['https://tms.example.test/{z}/{x}/{y}'], 'tms');
  assert.deepEqual(browseTileCoordinate('https://tms.example.test/3/2/2'), { z: 3, x: 2, y: 5 });
  assert.equal(browseTileCoordinate('https://tms.example.test/3/8/2'), undefined);
  release();
});

test('registrations from multiple map instances coexist and cleanup is owner-scoped', () => {
  const mapA = {};
  const mapB = {};
  const releaseA = registerBrowseTileSource(mapA, ['https://a.example.test/{z}/{x}/{y}.png']);
  registerBrowseTileSource(mapB, ['https://b.example.test/{z}/{x}/{y}.png']);
  assert.deepEqual(browseTileCoordinate('https://a.example.test/4/2/3.png'), { z: 4, x: 2, y: 3 });
  assert.deepEqual(browseTileCoordinate('https://b.example.test/4/2/3.png'), { z: 4, x: 2, y: 3 });
  releaseA();
  assert.equal(browseTileCoordinate('https://a.example.test/4/2/3.png'), undefined);
  assert.deepEqual(browseTileCoordinate('https://b.example.test/4/2/3.png'), { z: 4, x: 2, y: 3 });
});

test('a stale cleanup cannot remove a newer registration for the same owner', () => {
  const owner = {};
  const releaseOld = registerBrowseTileSource(owner, ['https://old.example.test/{z}/{x}/{y}']);
  registerBrowseTileSource(owner, ['https://new.example.test/{z}/{x}/{y}']);
  releaseOld();
  assert.equal(browseTileCoordinate('https://old.example.test/3/1/1'), undefined);
  assert.deepEqual(browseTileCoordinate('https://new.example.test/3/1/1'), { z: 3, x: 1, y: 1 });
});

test('recognizes both standard and high-DPR raster template variants', () => {
  const release = registerBrowseTileSource({}, ['https://hi.example.test/{z}/{x}/{y}{ratio}.png'], 'tms');
  assert.deepEqual(browseTileCoordinate('https://hi.example.test/3/2/2.png'), { z: 3, x: 2, y: 5 });
  assert.deepEqual(browseTileCoordinate('https://hi.example.test/3/2/2@2x.png'), { z: 3, x: 2, y: 5 });
  release();
});
