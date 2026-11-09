import test from 'node:test';
import assert from 'node:assert/strict';
import { markerPresentation } from '../modules/annotations/markerScale.ts';
import { photoMapPresentation } from '../modules/photos/mapPresentation.ts';

test('photo presentation follows the shared pin mode thresholds and physical frame sizes', () => {
  const cases = [
    { zoom: 9, mode: 'label', frameCss: 44 },
    { zoom: 8.999, mode: 'icon', frameCss: 24.2 },
    { zoom: 8, mode: 'icon', frameCss: 24.2 },
    { zoom: 7.999, mode: 'dot', frameCss: 9.9 },
    { zoom: 0, mode: 'dot', frameCss: 9.9 },
    { zoom: Number.NaN, mode: 'label', frameCss: 44 },
  ];

  for (const { zoom, mode, frameCss } of cases) {
    const result = photoMapPresentation(zoom);
    assert.equal(result.mode, markerPresentation(zoom, false));
    assert.equal(result.mode, mode);
    assert.ok(Math.abs(result.frameCss - frameCss) < 1e-10);
    assert.ok(Math.abs(result.scale - frameCss / 56) < 1e-10);
    assert.ok(Math.abs(result.canvasCss - 64 * frameCss / 56) < 1e-10);
  }
});

test('photo frame follows pin mode size without applying the generic zoom scale curve', () => {
  const distant = photoMapPresentation(4);
  const close = photoMapPresentation(18);
  assert.equal(distant.mode, 'dot');
  assert.equal(close.mode, 'label');
  assert.equal(distant.frameCss, 9.9);
  assert.equal(close.frameCss, 44);
  assert.equal(photoMapPresentation(7.9).frameCss, photoMapPresentation(4).frameCss);
  assert.equal(photoMapPresentation(12).frameCss, photoMapPresentation(18).frameCss);
});
