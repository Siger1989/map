import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCameraSync } from '../modules/map/native/cameraSync.ts';

const camera = (patch = {}) => ({ center: [102.9, 31], zoom: 12, pitch: 55, bearing: 20, ...patch });

test('repeated WorldWind terrain/zoom round trips stay programmatic despite reconstruction drift', () => {
  const sync = new NativeCameraSync();
  const target = camera();
  sync.apply(target, camera({ zoom: 11.5 }));

  // Representative drift from reconstructing range and terrain-height-adjusted
  // eye position into a WGS84 center/zoom snapshot.
  for (let frame = 0; frame < 200; frame++) {
    const actual = camera({
      center: [102.9 + (frame % 2 ? 0.00007 : -0.00006), 31 - 0.00004],
      zoom: 12 + (frame % 2 ? 0.09 : -0.08),
      pitch: 55 + (frame % 2 ? 0.3 : -0.2),
      bearing: 20 + (frame % 2 ? 0.3 : -0.25),
    });
    assert.equal(sync.isProgrammatic(actual), true);
  }
});

test('late frames from both panes remain echoes while the newest target is pending', () => {
  const primary = new NativeCameraSync(), secondary = new NativeCameraSync();
  const first = camera({ center: [103, 31], zoom: 12.1 });
  const second = camera({ center: [103.2, 31.1], zoom: 12.3, pitch: 54.5 });
  const firstPrimaryToken = primary.apply(first, camera({ zoom: 11 }));
  const firstSecondaryToken = secondary.apply(first, camera({ center: [102, 30] }));

  // A real camera update from one side issues a newer command to the other.
  const secondPrimaryToken = primary.apply(second, first);
  const secondSecondaryToken = secondary.apply(second, first);
  assert.ok(secondPrimaryToken > firstPrimaryToken);
  assert.ok(secondSecondaryToken > firstSecondaryToken);

  // Old native replies can arrive after the newer command on either pane.
  assert.equal(primary.isProgrammatic(first, firstPrimaryToken), true);
  assert.equal(secondary.isProgrammatic(first, firstSecondaryToken), true);
  assert.equal(primary.isStaleProgrammatic(firstPrimaryToken), true);
  assert.equal(secondary.isStaleProgrammatic(firstSecondaryToken), true);
  assert.equal(primary.isProgrammatic(camera({ ...second, zoom: 12.37 }), secondPrimaryToken), true);
  assert.equal(secondary.isProgrammatic(camera({ ...second, zoom: 12.37 }), secondSecondaryToken), true);
  assert.equal(primary.isStaleProgrammatic(secondPrimaryToken), false);
  assert.equal(secondary.isStaleProgrammatic(secondSecondaryToken), false);
});

test('a real gesture releases approximate suppression and marks older native replies stale', () => {
  const sync = new NativeCameraSync();
  const firstToken = sync.apply(camera(), camera({ zoom: 11 }));
  sync.beginUserGesture();

  // Finger-driven frames have no programmatic origin and must reach the caller.
  assert.equal(sync.isProgrammatic(camera({ center: [102.91, 31] })), false);
  assert.equal(sync.isStaleProgrammatic(firstToken), true);

  // The host can safely ignore a delayed old command without overwriting the
  // new camera captured by the user's gesture.
  const nextToken = sync.apply(camera({ center: [103, 31], zoom: 12.2 }), camera());
  assert.equal(sync.isProgrammatic(camera(), firstToken), true);
  assert.equal(sync.isStaleProgrammatic(firstToken), true);
  assert.equal(sync.isStaleProgrammatic(nextToken), false);
  assert.equal(sync.isProgrammatic(camera({ center: [103, 31], zoom: 12.2 }), nextToken), true);
});

test('unmatched tracking/navigation changes propagate without discarding a pending response', () => {
  const sync = new NativeCameraSync();
  const target = camera();
  sync.apply(target, camera({ zoom: 11 }));

  // Legitimate non-touch camera movement is not mistaken for the command just
  // because a command is still pending. A later terrain-adjusted reply is too.
  assert.equal(sync.isProgrammatic(camera({ center: [103.02, 31.02], zoom: 13 })), false);
  assert.equal(sync.isProgrammatic(camera({ center: [102.90003, 30.99996], zoom: 12.04 })), true);
});

test('native command tokens identify drifted echoes and reject unknown tokens', () => {
  const sync = new NativeCameraSync();
  const token = sync.apply(camera(), null);
  const drifted = camera({ center: [102.90008, 31.00006], zoom: 12.11 });
  assert.equal(sync.isProgrammatic(drifted, token), true);
  assert.equal(sync.isProgrammatic(drifted, token + 10), false);
  assert.equal(sync.isProgrammatic(camera(), null), false);
});

test('wrapped centers and bearings are equivalent across the antimeridian and 180 degrees', () => {
  const sync = new NativeCameraSync();
  sync.apply(camera({ center: [179.99998, 31], bearing: 181 }), null);
  assert.equal(sync.isProgrammatic(camera({ center: [-179.99998, 31], bearing: -179 })), true);
  assert.equal(sync.isProgrammatic(camera({ center: [-179.998, 31], bearing: -178 })), false);
});

test('an untagged pre-command frame is quiet only until the current command is acknowledged', () => {
  const sync = new NativeCameraSync();
  const before = camera({ zoom: 10 });
  const target = camera({ zoom: 12 });
  const token = sync.apply(target, before);
  assert.equal(sync.isProgrammatic(before, null), true);
  assert.equal(sync.isProgrammatic(camera({ center: [104, 32] }), null), false);
  assert.equal(sync.isProgrammatic(target, token), true);
  assert.equal(sync.isProgrammatic(before, null), false);
  sync.beginUserGesture();
  assert.equal(sync.isProgrammatic(target, null), false);
});
