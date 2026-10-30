import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['modules/map/native/cameraPersistence.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { NativeCameraPersistence } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function clock() {
  let now = 0, nextId = 0;
  const jobs = new Map();
  return {
    timers: { set(callback, delay) { const id = ++nextId; jobs.set(id, { at: now + delay, callback }); return id; }, clear(id) { jobs.delete(id); } },
    advance(to) {
      while (true) {
        const next = [...jobs.entries()].filter(([, job]) => job.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; jobs.delete(next[0]); next[1].callback();
      }
      now = to;
    },
    get now() { return now; },
    get pending() { return jobs.size; },
  };
}

const camera = (longitude) => ({ center: [longitude, 31], zoom: 12, pitch: 55, bearing: 20 });

test('coalesces live camera updates and persists only the latest value after idle', () => {
  const time = clock(), saved = [];
  const persistence = new NativeCameraPersistence(() => true, value => saved.push({ at: time.now, value }), 160, 1000, time.timers);
  const first = camera(100), latest = camera(102);
  persistence.update(first); first.center[0] = -20;
  time.advance(100); persistence.update(latest);
  time.advance(259); assert.deepEqual(saved, []);
  time.advance(260);
  assert.deepEqual(saved, [{ at: 260, value: { ...latest, center: [102, 31] } }]);
  assert.equal(time.pending, 0);
});

test('gesture end schedules a final idle flush and the maximum delay bounds long gestures', () => {
  const time = clock(), saved = [];
  const persistence = new NativeCameraPersistence(() => true, value => saved.push({ at: time.now, value }), 160, 1000, time.timers);
  persistence.beginGesture();
  persistence.update(camera(101)); time.advance(500);
  persistence.update(camera(102)); time.advance(1000);
  assert.deepEqual(saved, [{ at: 1000, value: camera(102) }]);
  persistence.update(camera(103)); time.advance(1100);
  persistence.endGesture(); time.advance(1259); assert.equal(saved.length, 1);
  time.advance(1260); assert.deepEqual(saved.at(-1), { at: 1260, value: camera(103) });
});

test('a pending idle flush is suspended during a gesture and resumed on gesture end', () => {
  const time = clock(), saved = [];
  const persistence = new NativeCameraPersistence(() => true, value => saved.push(value), 160, 1000, time.timers);
  persistence.update(camera(101)); time.advance(100); persistence.beginGesture();
  time.advance(200); assert.deepEqual(saved, []);
  persistence.update(camera(102)); persistence.endGesture(); time.advance(360);
  assert.deepEqual(saved, [camera(102)]);
});

test('disabled persistence clears pending writes and does not write comparison maps', () => {
  const time = clock(), saved = [];
  let enabled = true;
  const persistence = new NativeCameraPersistence(() => enabled, value => saved.push(value), 160, 1000, time.timers);
  persistence.update(camera(101)); enabled = false; time.advance(1000);
  assert.deepEqual(saved, []);
  assert.equal(time.pending, 0);
  persistence.update(camera(102)); persistence.flush();
  assert.deepEqual(saved, []);
});

test('flush before owner teardown preserves the latest camera and cancels timers', () => {
  const time = clock(), saved = [];
  const persistence = new NativeCameraPersistence(() => true, value => saved.push(value), 160, 1000, time.timers);
  persistence.update(camera(104)); persistence.update(camera(105));
  persistence.flush();
  assert.deepEqual(saved, [camera(105)]);
  assert.equal(time.pending, 0);
  persistence.dispose();
  persistence.update(camera(106)); time.advance(2000);
  assert.deepEqual(saved, [camera(105)]);
});
