import test from 'node:test';
import assert from 'node:assert/strict';
import { photoLayout } from '../modules/routeShare/photoLayout.ts';
test('mixed photo rows retain aspect allocation, hero occupies full width and rows do not overlap', () => {
  const result = photoLayout([0.6, 1.8, 1.3, 0.8], 2);
  assert.equal(result.tiles[0].index, 2);
  assert.equal(result.tiles[0].width, 1110);
  assert.equal(result.tiles.length, 4);
  assert.equal(new Set(result.tiles.map((t) => t.index)).size, 4);
  for (const t of result.tiles) {
    assert.ok(t.x >= 45 && t.x + t.width <= 1155.01);
    assert.ok(t.y + t.height < result.height);
  }
  assert.equal(result.tiles[1].y, result.tiles[2].y);
  assert.ok(result.tiles[2].x > result.tiles[1].x + result.tiles[1].width);
});
