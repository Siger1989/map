import test from 'node:test';
import assert from 'node:assert/strict';
import { mapResizeScheduler } from '../modules/map/mapResizeScheduler.ts';

test('resize bursts use the latest dimensions once per frame and ignore unchanged layout', () => {
  const frames = [];
  let runs = 0;
  const resize = mapResizeScheduler(
    () => runs++,
    callback => (frames.push(callback), frames.length),
    () => {},
  );

  resize.request(390, 844);
  resize.request(389, 844);
  resize.request(390, 844);
  assert.equal(runs, 0);
  frames.shift()(0);
  assert.equal(runs, 1);

  resize.request(390, 844);
  frames.shift()(16);
  assert.equal(runs, 1);

  resize.request(360, 780);
  frames.shift()(32);
  assert.equal(runs, 2);
});

test('cancel prevents a queued resize after teardown', () => {
  const frames = [];
  const cancelled = [];
  let runs = 0;
  const resize = mapResizeScheduler(
    () => runs++,
    callback => (frames.push(callback), 7),
    handle => cancelled.push(handle),
  );
  resize.request(390, 844);
  resize.cancel();
  assert.deepEqual(cancelled, [7]);
  assert.equal(runs, 0);
});
