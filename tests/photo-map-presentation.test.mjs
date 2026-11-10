import test from 'node:test';
import assert from 'node:assert/strict';
import { markerPresentation, markerScale } from '../modules/annotations/markerScale.ts';
import { photoMapPresentation } from '../modules/photos/mapPresentation.ts';

test('photo presentation follows the shared pin mode thresholds and physical frame sizes', () => {
  const cases = [
    { zoom: 9, mode: 'label', base: 32 },
    { zoom: 8.999, mode: 'icon', base: 24.2 },
    { zoom: 8, mode: 'icon', base: 24.2 },
    { zoom: 7.999, mode: 'dot', base: 9.9 },
    { zoom: 0, mode: 'dot', base: 9.9 },
    { zoom: Number.NaN, mode: 'label', base: 32 },
  ];

  for (const { zoom, mode, base } of cases) {
    const frameCss = Math.max(20, base * markerScale(zoom));
    const result = photoMapPresentation(zoom);
    assert.equal(result.mode, markerPresentation(zoom, false));
    assert.equal(result.mode, mode);
    assert.ok(Math.abs(result.frameCss - frameCss) < 1e-10);
    assert.ok(Math.abs(result.scale - frameCss / 56) < 1e-10);
    assert.ok(Math.abs(result.canvasCss - 64 * frameCss / 56) < 1e-10);
  }
});

test('photos shrink through normal map zooms and never exceed the compact 32 pixel frame', () => {
  const distant = photoMapPresentation(4);
  const close = photoMapPresentation(18);
  assert.equal(distant.mode, 'dot');
  assert.equal(close.mode, 'label');
  assert.equal(distant.frameCss, 20);
  assert.equal(close.frameCss, 32);
  assert.equal(photoMapPresentation(7.9).frameCss, 20);
  assert.ok(photoMapPresentation(10).frameCss < photoMapPresentation(12).frameCss);
  assert.ok(photoMapPresentation(12).frameCss < photoMapPresentation(14).frameCss);
  assert.ok(photoMapPresentation(14).frameCss < photoMapPresentation(18).frameCss);
  for (let zoom = 0; zoom <= 24; zoom += .1) {
    assert.ok(photoMapPresentation(zoom).frameCss >= 20);
    assert.ok(photoMapPresentation(zoom).frameCss <= 32);
  }
});
