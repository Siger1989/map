import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/projectedPathBounds.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { ProjectedPathBoundsIndex, isPathRelevant } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('path bounds are scanned once and reused across many offscreen markers', () => {
  let scans = 0;
  const path = new Proxy([[100, 100], [110, 120], [130, 105]], {
    get(target, property, receiver) {
      if (property === Symbol.iterator) scans++;
      return Reflect.get(target, property, receiver);
    },
  });
  const projected = [path];
  const index = new ProjectedPathBoundsIndex();
  const first = index.getPathBounds(projected, 0);
  assert.deepEqual(first, { left: 100, top: 100, right: 130, bottom: 120 });
  for (let i = 0; i < 100; i++) {
    const marker = { left: i * 10, top: 0, right: i * 10 + 5, bottom: 10 };
    assert.equal(isPathRelevant(marker, index.getPathBounds(projected, 0)), false);
  }
  assert.equal(scans, 1);
  assert.equal(index.getPathBounds(projected, 0), first, 'the same cached bounds object is returned');
});

test('inclusive overlap preserves paths that touch any marker edge', () => {
  const index = new ProjectedPathBoundsIndex();
  const projected = [[[0, 0], [10, 10]]];
  const bounds = index.getPathBounds(projected, 0);
  assert.equal(isPathRelevant({ left: 10, top: 2, right: 20, bottom: 8 }, bounds), true);
  assert.equal(isPathRelevant({ left: 2, top: 10, right: 8, bottom: 20 }, bounds), true);
  assert.equal(isPathRelevant({ left: 10.01, top: 0, right: 20, bottom: 10 }, bounds), false);
});

test('non-finite path coordinates produce unknown bounds and are kept for exact clipping', () => {
  const index = new ProjectedPathBoundsIndex();
  const projected = [[[0, 0], [Number.NaN, 3], [10, 10]]];
  const bounds = index.getPathBounds(projected, 0);
  assert.equal(bounds, null);
  assert.equal(isPathRelevant({ left: 500, top: 500, right: 510, bottom: 510 }, bounds), true);
  assert.equal(isPathRelevant({ left: Number.NaN, top: 0, right: 1, bottom: 1 },
    { left: 100, top: 100, right: 110, bottom: 110 }), true);
});

test('empty paths are safely conservative and invalid indices return no bounds', () => {
  const index = new ProjectedPathBoundsIndex();
  const projected = [[]];
  assert.equal(index.getPathBounds(projected, 0), null);
  assert.equal(isPathRelevant({ left: 0, top: 0, right: 1, bottom: 1 }, null), true);
  assert.equal(index.getPathBounds(projected, 5), null);
});
