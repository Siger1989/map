import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFloatingNavigationPayload,
  parseFloatingNavigationStatus,
  serializeFloatingNavigationPayload,
  validateFloatingNavigationPayloadBytes,
  validateFloatingNavigationInput,
} from '../modules/guidance/floatingNavigation.ts';

const coordinates = [[103.1, 30.2], [103.2, 30.3]];
const session = {
  route: { coordinates, stops: [{ name: '起点', coordinates: coordinates[0] }, { name: '目的地', coordinates: coordinates[1] }] },
};

test('floating navigation payload uses the live route, destination label, and selected direction', () => {
  const payload = buildFloatingNavigationPayload(session, 'motion');
  assert.deepEqual(payload, { version: 1, kind: 'route', mode: 'motion', label: '目的地', coordinates });
  assert.deepEqual(JSON.parse(serializeFloatingNavigationPayload(payload)).coordinates, coordinates);
});

test('floating navigation payload uses a fallback label when the final stop is unnamed', () => {
  assert.equal(buildFloatingNavigationPayload({ route: { coordinates, stops: [{ name: '' }] } }, 'north').label, '导航路线');
});

test('floating navigation validation enforces mode, coordinate bounds, and point count', () => {
  assert.throws(() => validateFloatingNavigationInput('south', 'x', coordinates), /方向模式/);
  assert.throws(() => validateFloatingNavigationInput('north', 'x', [[181, 0], [0, 0]]), /坐标/);
  assert.throws(() => validateFloatingNavigationInput('north', 'x', [[0, 91], [0, 0]]), /坐标/);
  assert.throws(() => validateFloatingNavigationInput('north', 'x', [[0, 0]]), /2至100000/);
  assert.throws(() => validateFloatingNavigationInput('north', 'x', Array.from({ length: 100_001 }, () => [0, 0])), /2至100000/);
  assert.equal(validateFloatingNavigationInput('north', 'x', coordinates), true);
});

test('serialized payload stays under the 4 MiB native bridge bound', () => {
  assert.equal(validateFloatingNavigationPayloadBytes('x'.repeat(4 * 1024 * 1024)), true);
  assert.throws(() => validateFloatingNavigationPayloadBytes('x'.repeat(4 * 1024 * 1024 + 1)), /4MiB/);
  const payload = serializeFloatingNavigationPayload({ version: 1, mode: 'north', label: 'x', coordinates: Array.from({ length: 100_000 }, () => [-179.99999999999997, -89.99999999999999]) });
  assert.ok(new TextEncoder().encode(payload).byteLength <= 4 * 1024 * 1024);
});

test('native status parsing exposes only concrete fields and tolerates malformed status', () => {
  assert.deepEqual(parseFloatingNavigationStatus('{"available":true,"enabled":true,"visible":false,"mode":"motion","message":"权限待确认"}'), {
    available: true, enabled: true, visible: false, mode: 'motion', kind: 'route', message: '权限待确认',
  });
  assert.equal(parseFloatingNavigationStatus('{broken'), null);
  assert.equal(parseFloatingNavigationStatus(null), null);
});

test('ordinary positioning has no route dependency or fabricated route coordinates', () => {
  const payload = buildFloatingNavigationPayload(null, 'north');
  assert.deepEqual(payload, { version: 1, kind: 'position', mode: 'north', label: '定位小地图', coordinates: [] });
  assert.deepEqual(JSON.parse(serializeFloatingNavigationPayload(payload)), payload);
  assert.throws(() => buildFloatingNavigationPayload(null, 'north', 'route'), /请先开始导航/);
  assert.throws(() => validateFloatingNavigationInput('north', 'x', coordinates, 'position'), /不应包含路线/);
  assert.deepEqual(parseFloatingNavigationStatus({ available: true, kind: 'position', zoom: 17, widthDp: 240, heightDp: 260 }), {
    available: true, enabled: false, visible: false, mode: 'north', kind: 'position', message: '', zoom: 17, widthDp: 240, heightDp: 260,
  });
});

test('floating route carries the actual selected route color and rejects invalid colors', () => {
  const colored = { route: { ...session.route, style: { color: '#ffbb00', width: 4 } } };
  const payload = buildFloatingNavigationPayload(colored, 'north');
  assert.equal(payload.color, '#FFBB00');
  assert.equal(JSON.parse(serializeFloatingNavigationPayload(payload)).color, '#FFBB00');
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, color: 'orange' }), /六位/);
  assert.throws(() => serializeFloatingNavigationPayload({ ...payload, kind: 'position', coordinates: [] }), /仅导航/);
});
