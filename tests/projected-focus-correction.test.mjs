import test from 'node:test';
import assert from 'node:assert/strict';
import { installProjectedFocusCorrection, projectedFocusError } from '../modules/map/projectedFocusCorrection.ts';

function mapStub(start, options = {}) {
  const listeners = new Map();
  const frames = new Map();
  let nextFrame = 0;
  let moving = options.moving ?? false;
  const point = { ...start };
  const solves = [];
  const map = {
    project: () => ({ ...point }),
    isMoving: () => moving,
    getContainer: () => ({ clientWidth: 360, clientHeight: 780 }),
    queryTerrainElevation: coordinate => options.elevation ?? (coordinate[0] + coordinate[1]),
    on(type, listener) {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    off(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of [...(listeners.get(type) ?? [])]) listener(); },
    jumpTo({ center }) {
      solves.push({ center });
      point.x = center[0];
      point.y = center[1];
      map.emit('movestart');
      map.emit('moveend');
    },
    _camera: {
      getTransformForUpdate: () => ({
        clone: () => ({
          center: [0, 0],
          setLocationAtPoint(location, target, elevation) {
            solves.push({ location: [location.lng, location.lat], target: { x: target.x, y: target.y }, elevation });
            this.center = [target.x, target.y];
          },
        }),
      }),
    },
    frames: {
      request(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
      cancel(id) { frames.delete(id); },
      flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
      get size() { return frames.size; },
    },
    solves,
    point,
    set moving(value) { moving = value; },
  };
  return map;
}

test('terrain transform solver places the live projected point at the requested viewport offset', () => {
  const map = mapStub({ x: 75, y: 120 }, { elevation: 1842 });
  installProjectedFocusCorrection(map, [112, 37], [0, 30], map.frames, 4, 1, 0);
  for (let i = 0; i < 5 && map.frames.size; i++) map.frames.flush();
  map.emit('idle');
  map.frames.flush();
  assert.deepEqual(map.point, { x: 180, y: 420 });
  assert.deepEqual(map.solves[0], { location: [112, 37], target: { x: 180, y: 420 }, elevation: 1842 });
  assert.deepEqual(map.solves[1], { center: [180, 420] });
});

test('projected focus re-reads viewport offset after the favorites panel finishes moving', () => {
  const map = mapStub({ x: 180, y: 354 });
  map.moving = true;
  let offset = [0, -36];
  installProjectedFocusCorrection(map, [112, 37], () => offset, map.frames, 6, 1, 0);
  map.moving = false;
  map.emit('moveend');
  map.frames.flush();
  offset = [0, 175];
  map.emit('idle');
  map.frames.flush();
  map.frames.flush();
  map.emit('idle');
  map.frames.flush();
  assert.equal(map.point.y, 565, 'the final target uses the panel settled offset, not the offset sampled on click');
});

test('a new camera movement cancels pending projected corrections', () => {
  const map = mapStub({ x: 75, y: 120 }, { moving: true });
  installProjectedFocusCorrection(map, [112, 37], [0, 30], map.frames);
  map.emit('movestart');
  map.moving = false;
  map.emit('moveend');
  map.frames.flush();
  assert.equal(map.solves.length, 0);
  assert.equal(map.frames.size, 0);
});

test('projected target error rejects non-finite and already-converged positions', () => {
  assert.equal(projectedFocusError({ x: 10, y: 20 }, { x: 10.5, y: 20 }, 1), null);
  assert.equal(projectedFocusError({ x: Number.NaN, y: 20 }, { x: 10, y: 20 }), null);
  assert.deepEqual(projectedFocusError({ x: 40, y: 70 }, { x: 10, y: 20 }), { x: 30, y: 50 });
});
