import test from 'node:test';
import assert from 'node:assert/strict';
import { zlibSync } from 'fflate';
import { parseOvmap } from '../modules/mapSources/ovmap.ts';

const encoder = new TextEncoder();

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function join(...parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function makeRecord({
  id = 200,
  name = 'Synthetic source',
  host = 'tiles.example.invalid',
  path = '/{z}/{x}/{y}.png?key=fixture-value',
  minzoom = 1,
  maxzoom = 18,
  coordType = 0,
  tileFormat = 4,
  port = 443,
  hostStart = 0,
  hostEnd = 0,
  tileSize = 256,
  overlayBig = 0,
  overlaySmall = 0,
  layerFlags = 0,
  tls = true,
  revision = 102,
  frameType = 37,
} = {}) {
  const nameBytes = encoder.encode(name);
  const hostBytes = encoder.encode(host);
  const pathBytes = encoder.encode(path);
  const body = new Uint8Array(
    120 + 4 + nameBytes.length + 4 + hostBytes.length + 4 + pathBytes.length,
  );
  const view = new DataView(body.buffer);
  view.setUint32(0, 37, true);
  view.setUint32(4, revision, true);
  view.setUint32(16, id, true);
  view.setUint32(20, minzoom, true);
  view.setUint32(24, maxzoom, true);
  view.setUint32(28, coordType, true);
  view.setUint32(32, tileFormat, true);
  view.setUint32(
    36,
    (port & 0xffff) | ((hostStart & 0xff) << 16) | ((hostEnd & 0xff) << 24),
    true,
  );
  view.setUint32(40, tileSize, true);
  view.setUint32(44, overlayBig, true);
  view.setUint32(48, overlaySmall, true);
  view.setUint32(60, layerFlags, true);
  view.setUint32(64, tls ? 0x10000 : 0, true);
  let offset = 120;
  view.setUint32(offset, nameBytes.length, true);
  offset += 4;
  body.set(nameBytes, offset);
  offset += nameBytes.length;
  view.setUint32(offset, hostBytes.length, true);
  offset += 4;
  body.set(hostBytes, offset);
  offset += hostBytes.length;
  view.setUint32(offset, pathBytes.length, true);
  offset += 4;
  body.set(pathBytes, offset);
  const frame = new Uint8Array(8 + body.length);
  const frameView = new DataView(frame.buffer);
  frameView.setUint32(0, body.length, true);
  frameView.setUint32(4, frameType, true);
  frame.set(body, 8);
  return frame;
}

function makeContainer(records) {
  const payload = join(...records);
  const compressed = zlibSync(payload);
  const file = new Uint8Array(24 + compressed.length);
  file.set(encoder.encode('OviO'), 0);
  file.set(u32(file.length), 4);
  file.set(u32(payload.length), 8);
  file.set(u32(104), 12);
  file.set(u32(100), 16);
  file.set(u32(0), 20);
  file.set(compressed, 24);
  return file;
}

test('accepts a v104 opaque 16-byte footer while still validating zlib checksum', () => {
  const original = makeContainer([makeRecord()]);
  const file = join(original, new Uint8Array(16).fill(0xa5));
  file.set(u32(file.length), 4);
  assert.equal(parseOvmap(file).drafts.length, 1);
  file[file.length - 17] ^= 1;
  assert.throws(() => parseOvmap(file), /校验/);
});

test('parses bounded type-37 frames and retains HTTPS XYZ query data', () => {
  const file = makeContainer([
    makeRecord({ name: 'Raster A', maxzoom: 17 }),
    makeRecord({ name: 'Raster B', path: '/tiles/{z}/{x}/{y}.jpg?token=fixture-secret' }),
  ]);
  const result = parseOvmap(file);
  assert.equal(result.total, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.drafts.length, 2);
  assert.equal(result.drafts[0].name, 'Raster A');
  assert.equal(result.drafts[0].minzoom, 1);
  assert.equal(result.drafts[0].maxzoom, 17);
  assert.equal(result.drafts[0].tiles[0], 'https://tiles.example.invalid/{z}/{x}/{y}.png?key=fixture-value');
  assert.equal(result.drafts[1].tiles[0], 'https://tiles.example.invalid/tiles/{z}/{x}/{y}.jpg?token=fixture-secret');
});

test('expands only bounded numeric or alphabetic serverpart ranges', () => {
  const numeric = makeRecord({
    name: 'Numeric shards',
    host: 'tile-{$serverpart}.example.invalid',
    hostStart: '0'.charCodeAt(0),
    hostEnd: '2'.charCodeAt(0),
  });
  const alpha = makeRecord({
    name: 'Alphabetic shards',
    host: 'tile-{$serverpart}.example.invalid',
    hostStart: 'a'.charCodeAt(0),
    hostEnd: 'c'.charCodeAt(0),
    path: '/{z}/{x}/{y}.png',
  });
  const result = parseOvmap(makeContainer([numeric, alpha]));
  assert.equal(result.drafts.length, 2);
  assert.deepEqual(
    result.drafts[0].tiles.map((url) => new URL(url).hostname),
    ['tile-0.example.invalid', 'tile-1.example.invalid', 'tile-2.example.invalid'],
  );
  assert.deepEqual(
    result.drafts[1].tiles.map((url) => new URL(url).hostname),
    ['tile-a.example.invalid', 'tile-b.example.invalid', 'tile-c.example.invalid'],
  );
});

test('imports HTTP, China Mercator, optional overlays, and scaled templates', () => {
  const result = parseOvmap(
    makeContainer([
      makeRecord({ name: 'Plain HTTP', tls: false, port: 80 }),
      makeRecord({ name: 'China Mercator', coordType: 1 }),
      makeRecord({ name: 'Layered', overlaySmall: 243, layerFlags: 1 }),
      makeRecord({ name: 'Scaled', path: '/{$z-1}/{$x/2}/{$y/2}.png' }),
    ]),
  );
  assert.equal(result.total, 4);
  assert.equal(result.drafts.length, 4);
  assert.equal(result.skipped.length, 0);
  assert.match(result.drafts[0].tiles[0], /^http:/);
  assert.equal(result.drafts[1].datum, 'gcj02');
  assert.deepEqual(result.drafts[2].ovmap.missingOverlayIds, [243]);
  assert.equal(result.drafts[3].ovmap.layers[0].subdivide, true);
});

test('only enabled layer records attach same-package overlays; missing references preserve the base map', () => {
  const result = parseOvmap(makeContainer([
    makeRecord({ id: 10, name: 'Base with disabled overlay', overlayBig: 11, layerFlags: 0 }),
    makeRecord({ id: 11, name: 'Disabled overlay' }),
    makeRecord({ id: 20, name: 'Base with enabled overlay', overlaySmall: 21, layerFlags: 1 }),
    makeRecord({ id: 21, name: 'Enabled overlay', path: '/labels/{z}/{x}/{y}.png' }),
    makeRecord({ id: 30, name: 'Base with absent overlay', overlayBig: 99, layerFlags: 1 }),
  ]));

  const byName = new Map(result.drafts.map(draft => [draft.name, draft]));
  assert.equal(byName.get('Base with disabled overlay').ovmap.layers.length, 1);
  assert.equal(byName.get('Base with disabled overlay').ovmap.missingOverlayIds, undefined);
  assert.equal(byName.get('Base with enabled overlay').ovmap.layers.length, 2);
  assert.match(byName.get('Base with enabled overlay').ovmap.layers[1].tiles[0], /labels/);
  const absent = byName.get('Base with absent overlay');
  assert.equal(absent.tiles.length, 1);
  assert.equal(absent.ovmap.layers.length, 1);
  assert.deepEqual(absent.ovmap.missingOverlayIds, [99]);
  assert.match(absent.detail, /底图/);
  assert.equal(result.skipped.length, 0);
});

test('512-pixel OVMAP tiles using z-1 and x/2,y/2 are marked for 2x2 subdivision', () => {
  const result = parseOvmap(makeContainer([
    makeRecord({ id: 40, tileSize: 512, path: '/{$z-1}/{$x/2}/{$y/2}.png' }),
  ]));
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].ovmap.layers[0].tileSize, 512);
  assert.equal(result.drafts[0].ovmap.layers[0].subdivide, true);
});

test('rejects malformed container, checksum, frame, and string boundaries', () => {
  const valid = makeContainer([makeRecord()]);
  const badMagic = valid.slice();
  badMagic[0] = 0;
  assert.throws(() => parseOvmap(badMagic), /容器/);

  const badChecksum = valid.slice();
  badChecksum[badChecksum.length - 1] ^= 0xff;
  assert.throws(() => parseOvmap(badChecksum), /zlib|解压|校验/);

  const badFrame = makeContainer([makeRecord({ frameType: 38 })]);
  const unsupported = parseOvmap(badFrame);
  assert.equal(unsupported.total, 1);
  assert.equal(unsupported.drafts.length, 0);
  assert.match(unsupported.skipped[0].reason, /记录类型/);

  const badDeclaredLength = valid.slice();
  badDeclaredLength.set(u32(999999), 8);
  assert.throws(() => parseOvmap(badDeclaredLength), /长度|安全上限/);
});

test('rejects invalid length prefixes instead of reading into the next frame', () => {
  const body = makeRecord();
  const bodyBytes = body.slice(8);
  new DataView(bodyBytes.buffer).setUint32(120, 0xffffffff, true);
  const malformed = new Uint8Array(body.length);
  malformed.set(u32(bodyBytes.length), 0);
  malformed.set(u32(37), 4);
  malformed.set(bodyBytes, 8);
  const result = parseOvmap(makeContainer([malformed]));
  assert.equal(result.total, 1);
  assert.equal(result.drafts.length, 0);
  assert.match(result.skipped[0].reason, /名称超过安全上限/);
});
