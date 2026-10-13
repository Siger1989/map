import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationCameraOptions } from '../modules/guidance/forwardCamera.ts';

const closeAngle = (a, b, tolerance = 2) => {
  const delta = ((a - b + 540) % 360) - 180;
  assert.ok(Math.abs(delta) <= tolerance, `expected ${a}° near ${b}°`);
};

test('forward camera uses the real center, reliable heading, safe positive offset, and no implicit zoom or padding', () => {
  const center = [104.1, 30.6];
  const options = navigationCameraOptions({ center, heading: 82, bearing: 80, height: 857, forward: true, animate: true });
  assert.deepEqual(options.center, center);
  assert.equal(options.pitch, 55);
  assert.equal(options.bearing, 82);
  assert.ok(options.offset[1] > 0);
  assert.equal(options.offset[0], 0);
  assert.equal(options.duration, 650);
  assert.equal('zoom' in options, false);
  assert.equal('padding' in options, false);
  assert.equal('gps' in options, false);
});

test('a reliable heading does not inspect or rebuild the route path', () => {
  let reads = 0;
  const points = new Proxy([[104.1, 30.6], [104.2, 30.6]], {
    get(target, property, receiver) {
      reads++;
      return Reflect.get(target, property, receiver);
    },
  });

  const options = navigationCameraOptions({
    center: [104.1, 30.6],
    heading: 82,
    path: points,
    progress: 100,
    height: 857,
    forward: true,
  });

  assert.equal(options.bearing, 82);
  assert.equal(reads, 0, 'a finite heading must bypass route-path traversal');
});

test('route tangent samples ahead of progress, including curved geometry and antimeridian paths', () => {
  const corner = navigationCameraOptions({
    center: [10, 0],
    path: [[10, 0], [10.0001, 0], [10.0001, 0.001]],
    progress: 0,
    height: 700,
    forward: true,
  });
  closeAngle(corner.bearing, 18, 3);

  const dateline = navigationCameraOptions({
    center: [179.999, 0],
    path: [[179.999, 0], [-179.999, 0]],
    progress: 0,
    height: 700,
    forward: true,
  });
  closeAngle(dateline.bearing, 90, 2);
});

test('bearing changes unwrap across 180 degrees by the shortest turn', () => {
  const eastward = navigationCameraOptions({ center: [0, 0], heading: 181, bearing: 179, height: 600, forward: true });
  assert.equal(eastward.bearing, 181);
  const westward = navigationCameraOptions({ center: [0, 0], heading: 179, bearing: 181, height: 600, forward: true });
  assert.equal(westward.bearing, 179);
});

test('offset stays inside the usable viewport on short screens and yields to bottom overlays', () => {
  const short = navigationCameraOptions({
    center: [0, 0], heading: 0, height: 300, forward: true,
    usableRect: { top: 32, bottom: 172 },
  });
  assert.ok(short.offset[1] < 0, 'a bottom overlay can move the camera point above screen center');
  assert.ok(32 + 8 <= 300 / 2 + short.offset[1]);
  assert.ok(300 / 2 + short.offset[1] <= 172 - 8);

  const bottomCard = navigationCameraOptions({
    center: [0, 0], heading: 0, height: 480, forward: true,
    usableRect: { top: 0, bottom: 200 },
  });
  assert.ok(bottomCard.offset[1] < 0);
  assert.ok(480 / 2 + bottomCard.offset[1] <= 200 - 8, 'center moves above the route card');

  const topBar = navigationCameraOptions({
    center: [0, 0], heading: 0, height: 480, forward: true,
    usableRect: { top: 240, bottom: 480 },
  });
  assert.ok(topBar.offset[1] > 0, 'a top overlay moves the camera point below it');
  assert.ok(480 / 2 + topBar.offset[1] >= 240 + 8);

  const noUsableSpace = navigationCameraOptions({
    center: [0, 0], heading: 0, height: 300, forward: true,
    usableRect: { top: 170, bottom: 180 },
  });
  assert.deepEqual(noUsableSpace.offset, [0, 0]);
});

test('invalid paths, zero-length paths, route end, and missing direction remain safe', () => {
  const noDirection = navigationCameraOptions({ center: [0, 0], height: 500, forward: true });
  assert.equal('bearing' in noDirection, false, 'does not invent north or a GPS heading');

  const fallback = navigationCameraOptions({ center: [0, 0], bearing: 270, height: 500, forward: true, path: [[0, 0], [0, 0]] });
  assert.equal(fallback.bearing, 270);

  const invalid = navigationCameraOptions({ center: [0, 0], bearing: 123, height: 500, forward: true, path: [[0, 0], [NaN, 2]] });
  assert.equal(invalid.bearing, 123);

  const atEnd = navigationCameraOptions({
    center: [0.001, 0],
    path: [[0, 0], [0.001, 0]],
    progress: 99999,
    height: 500,
    forward: true,
  });
  closeAngle(atEnd.bearing, 90, 2);
});

test('non-forward mode returns a level camera with no offset and preserves current bearing', () => {
  const options = navigationCameraOptions({ center: [12, 34], bearing: 271, heading: 20, height: 200, forward: false, animate: false });
  assert.equal(options.pitch, 0);
  assert.equal(options.bearing, 271);
  assert.deepEqual(options.offset, [0, 0]);
  assert.equal(options.duration, 0);
});

test('non-forward mode moves the center only when a short-screen overlay covers it', () => {
  const options = navigationCameraOptions({
    center: [0, 0], heading: 20, bearing: 271, height: 480, forward: false,
    usableRect: { top: 0, bottom: 200 },
  });
  assert.equal(options.pitch, 0);
  assert.deepEqual(options.offset, [0, -48]);
  assert.ok(480 / 2 + options.offset[1] <= 192);
  assert.equal('zoom' in options, false);
});
