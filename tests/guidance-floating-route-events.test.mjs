import test from 'node:test';
import assert from 'node:assert/strict';
import { pathOf } from '../modules/guidance/geometry.ts';
import { buildFloatingMarkerEvents } from '../modules/guidance/floatingRouteEvents.ts';
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

test('marker events remain valid while retired events are ignored without changing the route', () => {
  const coordinates = [[103, 30], [103.01, 30]];
  const events = [{ kind: 'marker', distanceM: 150, label: '桥' }];
  const payload = { version: 1, kind: 'route', mode: 'north', label: '路线', coordinates, events };
  assert.deepEqual(JSON.parse(serializeFloatingNavigationPayload(payload)).events, events);
  const legacy = { kind: 'rain', distanceM: 0, label: 'legacy', validUntilMs: Date.now() + 3_600_000 };
  assert.deepEqual(JSON.parse(serializeFloatingNavigationPayload({ ...payload, events: [legacy, ...events] })), payload);
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, events: Array(33).fill(events[0]) }), /事件/);
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, events: [{ ...events[0], validUntilMs: 1 }] }), /事件/);
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, events: [{ ...events[0], kind: 'unknown' }] }), /事件/);
});
