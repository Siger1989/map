import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpression, latest } from '@maplibre/maplibre-gl-style-spec';
import { ROUTE_LINE_WIDTH_ZOOM_STOPS, routeLineWidthExpression, routeLineWidthScale } from '../modules/map/zoomLineWidth.ts';

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
    assert.ok(Math.abs(routeLineWidthScale(zoom - 0.0001) - routeLineWidthScale(zoom + 0.0001)) < 0.00002,
      `width factor must not jump at zoom ${zoom}`);
  }
  assert.ok(routeLineWidthScale(10) < routeLineWidthScale(18), 'distant routes are thinner than near routes');
  assert.equal(5 * routeLineWidthScale(10) / (0.5 * routeLineWidthScale(10)), 10,
    'zoom scaling preserves the ratio between user-selected widths');
  assert.equal(routeLineWidthScale(Number.NaN), 1, 'invalid zoom leaves the base style unchanged');
});

test('MapLibre uses the same camera-zoom width curve while scaling the whole base width', () => {
  assert.deepEqual(routeLineWidthExpression(['get', 'routeWidth']), [
    'interpolate', ['linear'], ['zoom'],
    0, ['*', ['get', 'routeWidth'], 0.25],
    6, ['*', ['get', 'routeWidth'], 0.25],
    10, ['*', ['get', 'routeWidth'], 0.5],
    14, ['*', ['get', 'routeWidth'], 0.8],
    16, ['*', ['get', 'routeWidth'], 1],
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
