import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('map container resize refreshes layout without refitting the active collection', async () => {
  const source = await readFile(new URL('../modules/map/TerrainMap.tsx', import.meta.url), 'utf8');
  const observer = source.match(/const observer = new ResizeObserver\(\(\) => \{([\s\S]*?)\}\);/);

  assert.ok(observer, 'TerrainMap should observe its container size');
  assert.match(observer[1], /mapRef\.current\?\.resize\(\)/);
  assert.doesNotMatch(observer[1], /fitCollection|fitBounds|flyTo|easeTo|jumpTo|setZoom/);
  assert.doesNotMatch(source, /collectionTarget/);
});
