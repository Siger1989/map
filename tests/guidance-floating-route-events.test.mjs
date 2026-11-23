import test from 'node:test';
import assert from 'node:assert/strict';
import { pathOf } from '../modules/guidance/geometry.ts';
import { buildFloatingMarkerEvents, buildFloatingRainEvents, buildFloatingWeatherRoute } from '../modules/guidance/floatingRouteEvents.ts';
import { serializeFloatingNavigationPayload } from '../modules/guidance/floatingNavigation.ts';

test('sidebar markers use route distance for visible nearby pins and intermediate stops', () => {
  const points = [[179.99, 30], [-180, 30], [-179.99, 30]];
  const path = pathOf(points);
  const stops = points.map((coordinates, index) => ({ coordinates, name: ['起点', '途经点', '终点'][index] }));
  const marks = [
    { name: '途经点', kind: 'pin', visible: true, coordinates: [180, 30] },
    { name: '桥', kind: 'pin', visible: true, coordinates: [-179.995, 30.0002] },
    { name: '远处', kind: 'pin', visible: true, coordinates: [-179.995, 30.0005] },
    { name: '隐藏', kind: 'pin', visible: false, coordinates: [-179.995, 30] },
    { name: '模型', kind: 'box', visible: true, coordinates: [-179.995, 30] },
  ];
  const events = buildFloatingMarkerEvents(path, stops, marks);
  assert.deepEqual(events.map(event => event.label), ['途经点', '桥']);
  assert.ok(Math.abs(events[0].distanceM - path.length / 2) < 1);
  assert.ok(Math.abs(events[1].distanceM - path.length * 0.75) < 1);
});

test('arrival crossing into an observed forecast rain hour creates one expiring event, without treating snow or missing liquid data as rain', () => {
  const hourMs = 3_600_000;
  const now = Date.UTC(2026, 10, 23, 10, 45);
  const dryHourEnd = Date.UTC(2026, 10, 23, 11);
  const coordinates = [[103, 30], [103.01, 30]];
  const route = buildFloatingWeatherRoute(coordinates, hourMs / 1000);
  const forecast = { fetchedAt: now, points: [[
    { time: dryHourEnd, liquidRain: null, precipitation: 3, snowfall: 3 },
    { time: dryHourEnd + hourMs, liquidRain: 0.3, precipitation: 0.3 },
  ]] };
  const events = buildFloatingRainEvents(route, forecast, 0, now);
  assert.deepEqual(events, [{ kind: 'rain', distanceM: Math.floor(route.totalMeters / 4), label: '前方有雨', validUntilMs: dryHourEnd + hourMs }]);
  assert.deepEqual(buildFloatingRainEvents(route, forecast, 0, now + 2 * hourMs), []);
  const payload = { version: 1, kind: 'route', mode: 'north', label: '路线', coordinates, events };
  assert.deepEqual(JSON.parse(serializeFloatingNavigationPayload(payload)).events, events);
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, events: Array(33).fill(events[0]) }), /事件/);
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, events: [{ ...events[0], validUntilMs: undefined }] }), /事件/);
});
