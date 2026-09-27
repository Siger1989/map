import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraViewPublisher } from '../modules/map/cameraUpdates.ts';

test('panning with unchanged angles and zoom does not rerender controls', () => {
  const updates = [];
  let time = 0;
  const publish = cameraViewPublisher(v => updates.push(v), () => time);
  const view = { bearing: 0, pitch: 62, zoom: 12 };
  publish(view, true);
  for (let i = 0; i < 120; i++) { time += 16; publish({ ...view }); }
  publish({ ...view }, true);
  assert.equal(updates.length, 1);
});

test('rotation controls publish at 10 Hz and flush the final camera exactly', () => {
  const updates = [];
  let time = 0;
  const publish = cameraViewPublisher(v => updates.push(v), () => time);
  for (let i = 0; i < 60; i++) {
    time = i * 1000 / 60;
    publish({ bearing: i, pitch: 62, zoom: 12 });
  }
  assert.ok(updates.length <= 10);
  const final = { bearing: 59.5, pitch: 61, zoom: 12.5 };
  publish(final, true);
  assert.deepEqual(updates.at(-1), final);
  const count = updates.length;
  publish({ ...final }, true);
  assert.equal(updates.length, count);
});
