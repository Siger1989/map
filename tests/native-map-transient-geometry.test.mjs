import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeTransientGeometry } from '../modules/map/native/transientGeometry.ts';
import { coverageGeometry } from '../modules/outdoor/offlineCoverage.ts';

test('preview route is display-only and can be removed with a null coordinate', () => {
  const transient = new NativeTransientGeometry();
  const shown = transient.previewRoute([104.1, 30.6]);
  assert.equal(shown.features.length, 1);
  assert.deepEqual(shown.features[0].geometry.coordinates, [104.1, 30.6]);
  assert.equal(shown.features[0].properties.role, 'previewRoute');
  assert.equal(transient.previewRoute(null).features.length, 0);
});

test('route gap and issue cues carry the exact source coordinates and clear independently', () => {
  const transient = new NativeTransientGeometry();
  const gap = { from: [104, 30], to: [104.01, 30.02], distance: 2400 };
  let scene = transient.routeGap(gap);
  assert.equal(scene.features.length, 4);
  assert.deepEqual(scene.features[0].geometry.coordinates, [gap.from, gap.to]);
  assert.equal(scene.features[3].properties.label, '断开约 2400 米');
  scene = transient.routeIssue([104.02, 30.03], 'candidate');
  assert.equal(scene.features.length, 5);
  assert.equal(scene.features[4].properties.label, '末端候选 · 待设终点');
  scene = transient.routeGap(null);
  assert.equal(scene.features.length, 1);
  assert.equal(scene.features[0].properties.role, 'routeIssue');
  assert.equal(transient.routeIssue(null).features.length, 0);
});

test('offline coverage keeps the original tile geometry, filled state, label and temporary timeout', async () => {
  const trip = {
    id: 'trip', name: '测试包', bounds: [100, 20, 101, 21], urls: ['tdt:vec:14:8192:6000'],
    done: 1, bytes: 12, createdAt: 1, complete: true, zoom: 14,
  };
  const original = coverageGeometry(trip);
  let expired = 0;
  const transient = new NativeTransientGeometry(() => expired++);
  const scene = transient.offlineCoverage(trip, 0);
  assert.equal(scene.features.length, original.data.features.length + 1);
  assert.equal(scene.features[0].geometry.type, 'Polygon');
  assert.equal(scene.features[0].properties.fillOpacity, 0.22);
  assert.equal(scene.features.at(-1).properties.label, original.label);
  assert.equal(scene.features.at(-1).properties.role, 'offlineCoverageLabel');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(transient.snapshot().features.length, 0);
  assert.equal(expired, 1);
  assert.equal(trip.urls[0], 'tdt:vec:14:8192:6000');
});
