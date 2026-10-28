import assert from 'node:assert/strict';
import test from 'node:test';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';
import { aimPoint } from '../modules/tracks/precision.ts';
import { invalidateNativeDrawingGroundHit, nativeDrawingCoordinateAt, updateNativeDrawingGroundHit } from '../modules/map/native/drawingGroundHit.ts';

const camera = { center: [103, 31], zoom: 12, pitch: 55, bearing: 25 };
const start = { type: 'start', point: { x: 100, y: 200 }, coordinate: [103.001, 31.002], pointerCount: 1 };

test('drawing toCoordinate prefers the real native terrain intersection for the matching CSS point', () => {
  const hit = updateNativeDrawingGroundHit(null, start, true, camera);
  assert.deepEqual(nativeDrawingCoordinateAt(hit, { x: 100.5, y: 200 }, true, camera), [103.001, 31.002]);
  assert.equal(nativeDrawingCoordinateAt(hit, { x: 105, y: 200 }, true, camera), null);
  assert.equal(nativeDrawingCoordinateAt(hit, { x: 100, y: 200 }, false, camera), null);
});

test('stale, cancelled, multi-touch, and camera-changed drawing hits are discarded', () => {
  let hit = updateNativeDrawingGroundHit(null, start, true, camera);
  assert.ok(hit);
  assert.equal(updateNativeDrawingGroundHit(hit, { type: 'move', point: start.point, coordinate: start.coordinate, pointerCount: 2 }, true, camera), null);
  assert.equal(updateNativeDrawingGroundHit(hit, { type: 'cancel' }, true, camera), null);
  assert.equal(invalidateNativeDrawingGroundHit(hit, { ...camera, zoom: 13 }), null);
});

test('production point DrawingSession commits the real aim hit when DEM projection has no sample', () => {
  const finger = { x: 195, y: 584 };
  const aim = aimPoint(finger, 390, 800);
  const coordinate = [103.0018297, 31.002];
  const hit = updateNativeDrawingGroundHit(null, {
    type: 'start', point: finger, groundPoint: aim, coordinate, pointerCount: 1,
  }, true, camera);
  const session = new DrawingSession();
  const options = {
    mode: 'points', anchor: null, length: 120, width: 390, height: 800,
    candidates: [], snapping: false, roadSnapping: false, lastVertex: null,
    project: () => null,
    unproject: (point) => nativeDrawingCoordinateAt(hit, point, true, camera),
  };
  session.input({ type: 'start', point: finger }, options);
  const committed = session.input({ type: 'end', reason: 'release' }, options);
  assert.deepEqual(committed.vertex, coordinate);
});

test('aim ground point matches production 44px offset after DPR conversion and viewport edge clamping', () => {
  const width = 390, height = 800;
  for (const scale of [1, 2, 3]) {
    for (const finger of [{ x: 195, y: 584 }, { x: 2, y: 4 }, { x: 388, y: 798 }]) {
      const physical = { x: finger.x * scale, y: finger.y * scale };
      const cssFinger = { x: physical.x / scale, y: physical.y / scale };
      const hostAimCss = {
        x: Math.max(8, Math.min(width - 8, cssFinger.x)),
        y: Math.max(8, Math.min(height - 8, cssFinger.y - 44)),
      };
      assert.deepEqual(hostAimCss, aimPoint(finger, width, height));
    }
  }
});

test('aim hit persists through end, clears on cancel or camera change, and never substitutes for a freehand tip', () => {
  const finger = { x: 200, y: 220 };
  const aim = aimPoint(finger, 390, 800);
  let hit = updateNativeDrawingGroundHit(null, {
    type: 'start', point: finger, groundPoint: aim, coordinate: [103.01, 31.01], pointerCount: 1,
  }, true, camera);
  const ended = updateNativeDrawingGroundHit(hit, { type: 'end', pointerCount: 1 }, true, camera);
  assert.equal(ended, hit);
  assert.deepEqual(nativeDrawingCoordinateAt(ended, aim, true, camera), [103.01, 31.01]);
  assert.equal(updateNativeDrawingGroundHit(hit, { type: 'cancel' }, true, camera), null);
  assert.equal(invalidateNativeDrawingGroundHit(hit, { ...camera, bearing: 26 }), null);

  hit = updateNativeDrawingGroundHit(null, {
    type: 'start', point: finger, groundPoint: aim, coordinate: [103.01, 31.01], pointerCount: 1,
  }, true, camera);
  const session = new DrawingSession();
  let nativeUnprojectQueries = 0;
  const options = {
    mode: 'freehand', anchor: [103, 31], length: 100, width: 390, height: 800,
    candidates: [], snapping: false, roadSnapping: false, lastVertex: null,
    project: () => ({ x: 200, y: 200 }),
    unproject: (point) => {
      nativeUnprojectQueries++;
      return nativeDrawingCoordinateAt(hit, point, true, camera);
    },
  };
  session.input({ type: 'start', point: { x: 200, y: 300 } }, options);
  const moved = session.input({ type: 'move', point: { x: 400, y: 300 } }, options);
  assert.match(moved.hint, /地面边界/);
  assert.notEqual(nativeUnprojectQueries, 0);
  assert.equal(nativeDrawingCoordinateAt(hit, { x: 300, y: 250 }, true, camera), null);
  assert.equal(session.input({ type: 'end', reason: 'release' }, options).stroke, undefined);
});
