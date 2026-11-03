import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraViewPublisher, createCameraSummaryPublisher } from '../modules/map/cameraUpdates.ts';
import { focusPointCamera } from '../modules/map/cameraSync.ts';

function fakeTimers() {
  let time = 0;
  let nextId = 1;
  const tasks = new Map();
  const cleared = new Map();
  return {
    now: () => time,
    advance(ms) {
      time += ms;
      for (const [id, task] of [...tasks]) {
        if (task.due > time) continue;
        tasks.delete(id);
        task.callback();
      }
    },
    set(callback, delay) {
      const id = nextId++;
      const task = { callback, due: time + delay };
      tasks.set(id, task);
      cleared.set(id, task);
      return id;
    },
    clear(id) { tasks.delete(id); },
    fireEvenIfCleared(id) { cleared.get(id)?.callback(); },
    get size() { return tasks.size; },
  };
}

const summary = (n) => ({ view: { bearing: n, pitch: 60 + n, zoom: 10 + n }, center: [n, n + 1] });

function publisherFor(updates, timers, publish = value => updates.push(value)) {
  return createCameraSummaryPublisher(publish, 100, timers.now, { set: timers.set, clear: timers.clear });
}

test('focusing a point preserves the current zoom unless a zoom is explicitly requested', () => {
  const calls = [];
  let camera = { center: [0, 0], zoom: 9.25 };
  const map = {
    flyTo(options) {
      calls.push(options);
      camera = { ...camera, ...options };
    },
  };

  focusPointCamera(map, [12, 34]);
  assert.equal(camera.zoom, 9.25);
  assert.deepEqual(calls.at(-1), { center: [12, 34], duration: 700 });

  focusPointCamera(map, [56, 78], 14);
  assert.equal(camera.zoom, 14);
  assert.deepEqual(calls.at(-1), { center: [56, 78], zoom: 14, duration: 700 });
});

test('explicit point zoom is constrained to the map camera range', () => {
  const calls = [];
  focusPointCamera({ flyTo: (options) => calls.push(options) }, [0, 0], 25);
  assert.equal(calls[0].zoom, 20);
});

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

test('camera summary publishes leading then coalesces continuous movement into latest trailing values', () => {
  const timers = fakeTimers(), updates = [];
  const publish = publisherFor(updates, timers);
  publish.push(summary(0));
  assert.deepEqual(updates, [summary(0)], 'first frame is immediate');

  for (let n = 1; n <= 6; n++) {
    timers.advance(16);
    publish.push(summary(n));
  }
  assert.equal(updates.length, 1, 'intermediate frames stay queued during the 100ms window');
  timers.advance(4);
  assert.deepEqual(updates.at(-1), summary(6), 'trailing callback publishes the newest frame');

  for (let n = 7; n <= 12; n++) {
    timers.advance(16);
    publish.push(summary(n));
  }
  timers.advance(4);
  assert.deepEqual(updates.at(-1), summary(12), 'long gestures publish again at each 100ms boundary');
  publish.push(summary(13));
  assert.deepEqual(updates.at(-1), summary(12), 'a frame at the trailing boundary begins the next window');
  timers.advance(100);
  assert.deepEqual(updates.at(-1), summary(13), 'the final frame of the next window is delivered');
  assert.equal(updates.length, 4);
});

test('camera summary flush delivers the final value and cancels its trailing timer', () => {
  const timers = fakeTimers(), updates = [];
  const publish = publisherFor(updates, timers);
  publish.push(summary(0));
  timers.advance(30);
  publish.push(summary(1));
  const final = summary(2);
  assert.equal(publish.flush(final), true);
  assert.deepEqual(updates.at(-1), final);
  assert.equal(timers.size, 0);
  timers.advance(200);
  assert.equal(updates.length, 2, 'cancelled timer cannot emit a duplicate later');
});

test('camera summary cancellation rejects a raced timer callback and allows reuse', () => {
  const timers = fakeTimers(), updates = [];
  const publish = publisherFor(updates, timers);
  publish.push(summary(0));
  timers.advance(20);
  publish.push(summary(1));
  const staleTimerId = 1;
  publish.cancel();
  timers.fireEvenIfCleared(staleTimerId);
  assert.deepEqual(updates, [summary(0)], 'even a callback already taken by the timer queue is invalidated');
  assert.equal(publish.queued, false);
  timers.advance(100);
  publish.push(summary(2));
  assert.deepEqual(updates.at(-1), summary(2), 'publisher can serve a later map generation');
});

test('camera summary compares all camera values and invokes the current callback', () => {
  const timers = fakeTimers(), first = [], second = [];
  let current = value => first.push(value);
  const publish = publisherFor([], timers, value => current(value));
  publish.push(summary(0));
  publish.push(summary(0));
  assert.equal(first.length, 1, 'identical center, bearing, pitch and zoom do not repeat');

  timers.advance(20);
  current = value => second.push(value);
  publish.push({ ...summary(0), center: [0, 2] });
  timers.advance(80);
  assert.deepEqual(second, [{ ...summary(0), center: [0, 2] }], 'center latitude participates in equality and latest callback is used');

  timers.advance(20);
  publish.push({ ...summary(0), view: { bearing: 0, pitch: 60, zoom: 10.1 } });
  timers.advance(80);
  assert.equal(second.length, 2, 'zoom change participates in equality');
});
