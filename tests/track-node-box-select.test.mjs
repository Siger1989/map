import assert from 'node:assert/strict';
import test from 'node:test';
import { nodesInBox, nodeAtBoxTap } from '../modules/tracks/trackNodeBoxSelection.ts';

test('box taps pick the nearest existing handle and ignore empty space or invalid projection', () => {
  const points=[[0,0],[10,10],[40,40]];
  const project=([x,y])=>({x,y});
  assert.deepEqual(nodeAtBoxTap(points,{x:12,y:11},project),[10,10]);
  assert.deepEqual(nodeAtBoxTap(points,{x:40,y:40},project),[40,40]);
  assert.equal(nodeAtBoxTap(points,{x:90,y:90},project),null);
  assert.equal(nodeAtBoxTap(points,{x:0,y:0},()=>null),null);
});

test('route node box includes all three visible handles touching the inclusive rectangle', () => {
  const points = [[0, 0], [10, 10], [22, 20], [24, 20], [40, 40]];
  const result = nodesInBox(points, { left: 0, right: 20, top: 0, bottom: 20 },
    ([x, y]) => ({ x, y }), 3);
  assert.deepEqual(result, [[0, 0], [10, 10], [22, 20]]);
});

test('route node box keeps exact edge hits inclusive and deduplicates repeated route coordinates', () => {
  const result = nodesInBox([[4, 6], [8, 10], [4, 6]],
    { left: 4, right: 8, top: 6, bottom: 10 }, ([x, y]) => ({ x, y }));
  assert.deepEqual(result, [[4, 6], [8, 10]]);
});
