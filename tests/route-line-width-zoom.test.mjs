import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpression, latest } from '@maplibre/maplibre-gl-style-spec';
import {
  ROUTE_LINE_OPACITY_ZOOM_STOPS,
  ROUTE_LINE_WIDTH_ZOOM_STOPS,
  routeLineOpacityExpression,
  routeLineOpacityScale,
  routeLineWidthExpression,
  routeLineWidthScale,
} from '../modules/map/zoomLineWidth.ts';

test('route-like strokes scale smoothly and monotonically with camera zoom', () => {
  for (const [zoom, expected] of ROUTE_LINE_WIDTH_ZOOM_STOPS) {
    assert.equal(routeLineWidthScale(zoom), expected);
  }
  for (let zoom = 0; zoom < 22; zoom += 0.25) {
    const current = routeLineWidthScale(zoom);
    const next = routeLineWidthScale(zoom + 0.25);
    assert.ok(next >= current, `width factor must not decrease while zooming in (${zoom} -> ${zoom + 0.25})`);
  }
  for (const [zoom] of ROUTE_LINE_WIDTH_ZOOM_STOPS.slice(1, -1)) {
    assert.ok(Math.abs(routeLineWidthScale(zoom - 0.0001) - routeLineWidthScale(zoom + 0.0001)) < 0.00004,
      `width factor must not jump at zoom ${zoom}`);
  }
  assert.ok(routeLineWidthScale(10) < routeLineWidthScale(18), 'distant routes are thinner than near routes');
  assert.ok(routeLineWidthScale(6) < routeLineWidthScale(10), 'the distant width is materially reduced');
  assert.equal(5 * routeLineWidthScale(10) / (0.5 * routeLineWidthScale(10)), 10,
    'zoom scaling preserves the ratio between user-selected widths');
  assert.equal(routeLineWidthScale(Number.NaN), 1, 'invalid zoom leaves the base style unchanged');
});

test('route-like strokes fade smoothly while preserving user opacity and width-to-width ratios', () => {
  for (const [zoom, expected] of ROUTE_LINE_OPACITY_ZOOM_STOPS) {
    assert.equal(routeLineOpacityScale(zoom), expected);
  }
  for (let zoom = 0; zoom < 22; zoom += 0.25) {
    assert.ok(routeLineOpacityScale(zoom + 0.25) >= routeLineOpacityScale(zoom),
      `opacity factor must not decrease while zooming in (${zoom})`);
  }
  for (const [zoom] of ROUTE_LINE_OPACITY_ZOOM_STOPS.slice(1, -1)) {
    assert.ok(Math.abs(routeLineOpacityScale(zoom - 0.0001) - routeLineOpacityScale(zoom + 0.0001)) < 0.00004,
      `opacity factor must not jump at zoom ${zoom}`);
  }
  assert.equal(0.2 * routeLineOpacityScale(6) / (0.8 * routeLineOpacityScale(6)), 0.25,
    'zoom fading preserves the user-selected opacity ratio');
  assert.equal(routeLineOpacityScale(Number.NaN), 1, 'invalid zoom leaves base opacity unchanged');
});

test('MapLibre uses the same camera-zoom width curve while scaling the whole base width', () => {
  assert.deepEqual(routeLineWidthExpression(['get', 'routeWidth']), [
    'interpolate', ['linear'], ['zoom'],
    0, ['*', ['get', 'routeWidth'], 0.12],
    6, ['*', ['get', 'routeWidth'], 0.12],
    10, ['*', ['get', 'routeWidth'], 0.3],
    14, ['*', ['get', 'routeWidth'], 0.7],
    16, ['*', ['get', 'routeWidth'], 1],
  ]);
});

test('MapLibre line opacity expression multiplies original alpha inside top-level zoom interpolation', () => {
  assert.deepEqual(routeLineOpacityExpression(['coalesce', ['get', 'opacity'], 1]), [
    'interpolate', ['linear'], ['zoom'],
    0, ['*', ['coalesce', ['get', 'opacity'], 1], 0.35],
    6, ['*', ['coalesce', ['get', 'opacity'], 1], 0.35],
    10, ['*', ['coalesce', ['get', 'opacity'], 1], 0.55],
    14, ['*', ['coalesce', ['get', 'opacity'], 1], 0.85],
    16, ['*', ['coalesce', ['get', 'opacity'], 1], 1],
  ]);
});

test('all route-like line-width forms pass MapLibre style-spec parsing and evaluate at each zoom stop', () => {
  const bases = [
    4,
    5,
    8,
    9,
    ['get', 'width'],
    ['+', ['get', 'width'], ['case', ['get', 'selected'], 2, 1]],
    ['coalesce', ['get', 'routeWidth'], 4],
    ['+', ['coalesce', ['get', 'routeWidth'], 4], 4],
  ];
  const feature = { type: 'Feature', properties: { width: 6, selected: true, routeWidth: 3 } };
  const baseValues = [4, 5, 8, 9, 6, 8, 3, 7];

  for (const [index, base] of bases.entries()) {
    const expression = routeLineWidthExpression(base);
    const parsed = createExpression(expression, 'layers[0].paint.line-width', latest.paint_line['line-width']);
    assert.equal(parsed.result, 'success', `line-width expression ${index} must parse under MapLibre's real line-width property spec`);
    for (const [zoom, scale] of ROUTE_LINE_WIDTH_ZOOM_STOPS) {
      assert.equal(parsed.value.evaluate({ zoom }, feature), baseValues[index] * scale,
        `line-width expression ${index} should evaluate to base width × ${scale} at zoom ${zoom}`);
    }
  }
});

test('all route-like line-opacity forms pass MapLibre style-spec parsing and keep original alpha', () => {
  const bases = [
    1,
    0.82,
    ['get', 'opacity'],
    ['coalesce', ['get', 'opacity'], 1],
    ['*', 0.65, ['get', 'opacity']],
  ];
  const feature = { type: 'Feature', properties: { opacity: 0.4 } };
  const baseValues = [1, 0.82, 0.4, 0.4, 0.26];
  for (const [index, base] of bases.entries()) {
    const expression = routeLineOpacityExpression(base);
    const parsed = createExpression(expression, 'layers[0].paint.line-opacity', latest.paint_line['line-opacity']);
    assert.equal(parsed.result, 'success', `line-opacity expression ${index} must parse under MapLibre's real line-opacity property spec`);
    for (const [zoom, scale] of ROUTE_LINE_OPACITY_ZOOM_STOPS) {
      assert.ok(Math.abs(parsed.value.evaluate({ zoom }, feature) - baseValues[index] * scale) < 1e-9,
        `line-opacity expression ${index} should preserve base opacity × ${scale} at zoom ${zoom}`);
    }
  }
});
