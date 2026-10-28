import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationCameraOptions } from '../modules/guidance/forwardCamera.ts';
import { twoFingerGestureDelta } from '../modules/collections/boxSelection.ts';
import {
  nativeAnchoredGesture,
  nativeFocusCamera,
  nativeFocusPositionCamera,
  nativeNavigationCamera,
  nativePreviewNavigationCamera,
  nativeRouteGapCamera,
  nativeRouteIssueCamera,
} from '../modules/map/native/camera.ts';

const current = { center: [104, 30], zoom: 12.5, pitch: 32, bearing: 27 };

test('native focus preserves zoom and view pose unless the caller requests changes', () => {
  const focused = nativeFocusCamera(current, [105, 31]);
  assert.deepEqual(focused, { center: [105, 31], zoom: 12.5, pitch: 32, bearing: 27, duration: 700 });
  assert.deepEqual(nativeFocusCamera(current, [105, 31], 22), { center: [105, 31], zoom: 20, pitch: 32, bearing: 27, duration: 700 });
  assert.deepEqual(nativeFocusPositionCamera(current, [105, 31], 17, 48), { center: [105, 31], zoom: 16, pitch: 48, bearing: 0, duration: 700 });
});

test('native navigation forwards the original pose, heading, route, progress, close zoom, and offset calculation', () => {
  const request = {
    forward: true,
    heading: 82,
    path: [[104, 30], [104.1, 30.1]],
    progress: 350,
    animate: true,
    close: true,
    travelMode: 'pedestrian',
    pose: { pitch: 41, bearing: 91 },
  };
  const expected = navigationCameraOptions({ ...request, center: [104.01, 30.01], bearing: current.bearing, height: 857 });
  const actual = nativeNavigationCamera(current, request, [104.01, 30.01], 857);
  assert.deepEqual(actual, {
    center: expected.center,
    zoom: expected.zoom ?? current.zoom,
    pitch: expected.pitch,
    bearing: expected.bearing ?? current.bearing,
    offset: expected.offset,
    duration: expected.duration,
  });
  assert.equal(actual.zoom, 18.2);
  assert.deepEqual(actual.offset, expected.offset);
  assert.equal(actual.bearing, 91);
  assert.equal(actual.pitch, 41);
});

test('native navigation preview uses the route path and retains current zoom when none is requested', () => {
  const path = [[104, 30], [104.2, 30.1]];
  const expected = navigationCameraOptions({ center: [104.01, 30.01], path, progress: 0, height: 700, forward: true, animate: true, bearing: current.bearing });
  const actual = nativePreviewNavigationCamera(current, [104.01, 30.01], path, true, 700);
  assert.deepEqual(actual, {
    center: expected.center,
    zoom: current.zoom,
    pitch: expected.pitch,
    bearing: expected.bearing ?? current.bearing,
    offset: expected.offset,
    duration: expected.duration,
  });
  assert.equal(actual.duration, 650);
});

test('native two-finger camera uses original gesture deltas and carries the geographic anchor', () => {
  const previous = [{ x: 120, y: 200 }, { x: 220, y: 200 }];
  const next = [{ x: 105, y: 190 }, { x: 255, y: 210 }];
  const delta = twoFingerGestureDelta(previous, next);
  const anchorCoordinate = [104.02, 30.03];
  const result = nativeAnchoredGesture(current, previous, next, anchorCoordinate);
  assert.deepEqual(result.camera, {
    center: current.center,
    zoom: current.zoom + delta.zoom,
    pitch: current.pitch,
    bearing: ((current.bearing + delta.rotation) % 360 + 360) % 360,
  });
  assert.deepEqual(result.anchor, {
    coordinate: anchorCoordinate,
    from: { x: delta.around.x - delta.pan.x, y: delta.around.y - delta.pan.y },
    to: delta.around,
  });
});

test('native route gap and issue focus retain original framing rules', () => {
  const gap = { from: [179, 10], to: [-179, 12], distance: 1000 };
  const pixels = Math.max(80, Math.min(390 * 0.5, 857 * 0.35));
  const expectedZoom = Math.max(4, Math.min(18, Math.log2(78271.5 * Math.cos(11 * Math.PI / 180) * pixels / 1000)));
  assert.deepEqual(nativeRouteGapCamera(current, gap, 390, 857), {
    center: [180, 11], zoom: expectedZoom, pitch: 0, bearing: 0, duration: 0,
  });
  assert.deepEqual(nativeRouteIssueCamera([105, 31]), { center: [105, 31], zoom: 17, pitch: 0, bearing: 0, duration: 0 });
});
