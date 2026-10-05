import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForTrackRender } from '../modules/tracks/trackRenderHandoff.ts';
import { DRAFT_ID } from '../modules/tracks/editing.ts';

class FakeMap {
  listeners = new Map();
  source = {};
  loaded = true;

  on(type, listener) {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
    return this;
  }

  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  getSource(id) {
    return id === 'manual-tracks' ? this.source : undefined;
  }

  isSourceLoaded(id) {
    assert.equal(id, 'manual-tracks');
    return this.loaded;
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    host: {
      setTimeout(callback) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        callbacks.delete(id);
      },
    },
    fire() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
  };
}

function overlay(segments) {
  return { saved: [{ id: 'track-a', segments }], draft: [], visible: true, style: {}, nodes: [] };
}

test('ignores an old overlay and a worker update that is not yet loaded', () => {
  const map = new FakeMap();
  const timers = fakeTimers();
  const oldSegments = [[ [1, 2] ]];
  const committedSegments = [[ [3, 4] ]];
  let currentOverlay = overlay(oldSegments);
  const done = [];
  waitForTrackRender(map, () => currentOverlay, { trackId: 'track-a', segments: committedSegments }, (result) => done.push(result), { timers: timers.host });

  map.emit('render');
  assert.deepEqual(done, []);
  currentOverlay = overlay(committedSegments);
  map.loaded = false;
  map.emit('render');
  assert.deepEqual(done, []);
  assert.equal(map.count('render'), 1);

  map.loaded = true;
  map.emit('render');
  assert.deepEqual(done, ['rendered']);
  assert.equal(map.count('render'), 0);
  assert.equal(map.count('movestart'), 0);
  assert.equal(map.count('remove'), 0);
  assert.equal(timers.callbacks.size, 0);
});

test('does not finish when the manual-tracks source is absent', () => {
  const map = new FakeMap();
  const timers = fakeTimers();
  const segments = [[ [1, 2] ]];
  let currentOverlay = overlay(segments);
  const done = [];
  waitForTrackRender(map, () => currentOverlay, { trackId: 'track-a', segments }, (result) => done.push(result), { timers: timers.host });
  map.source = undefined;
  map.emit('render');
  assert.deepEqual(done, []);
  assert.equal(map.count('render'), 1);
  map.source = {};
  map.emit('render');
  assert.deepEqual(done, ['rendered']);
});

test('handles a draft receipt by segment reference', () => {
  const map = new FakeMap();
  const timers = fakeTimers();
  const draft = [[ [5, 6] ]];
  const currentOverlay = { saved: [], draft, visible: true, style: {}, nodes: [] };
  const done = [];
  waitForTrackRender(map, () => currentOverlay, { trackId: DRAFT_ID, segments: draft }, (result) => done.push(result), { timers: timers.host });
  map.emit('render');
  assert.deepEqual(done, ['rendered']);
});

test('cancels on camera movement and map removal and clears listeners', () => {
  for (const event of ['movestart', 'resize', 'remove']) {
    const map = new FakeMap();
    const timers = fakeTimers();
    const segments = [[ [1, 2] ]];
    const done = [];
    waitForTrackRender(map, () => overlay(segments), { trackId: 'track-a', segments }, (result) => done.push(result), { timers: timers.host });
    map.emit(event);
    assert.deepEqual(done, ['cancelled']);
    assert.equal(map.count('render'), 0);
    assert.equal(map.count('movestart'), 0);
    assert.equal(map.count('resize'), 0);
    assert.equal(map.count('remove'), 0);
    assert.equal(timers.callbacks.size, 0);
  }
});

test('dispose detaches without notifying; timeout notifies once and detaches', () => {
  const map = new FakeMap();
  const timers = fakeTimers();
  const segments = [[ [1, 2] ]];
  const done = [];
  const dispose = waitForTrackRender(map, () => overlay([[ [9, 9] ]]), { trackId: 'track-a', segments }, (result) => done.push(result), { timers: timers.host });
  dispose();
  assert.deepEqual(done, []);
  assert.equal(map.count('render'), 0);

  waitForTrackRender(map, () => overlay([[ [8, 8] ]]), { trackId: 'track-a', segments }, (result) => done.push(result), { timers: timers.host });
  timers.fire();
  assert.deepEqual(done, ['timeout']);
  assert.equal(map.count('render'), 0);
  assert.equal(map.count('movestart'), 0);
  assert.equal(map.count('remove'), 0);
});
