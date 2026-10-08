import test from 'node:test';
import assert from 'node:assert/strict';
import { canShareGeneratedFile, deliverFile } from '../modules/files/delivery.ts';

test('browser share capability is checked with the selected file MIME type', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const received = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { canShare: ({ files }) => {
      received.push(files[0].type);
      return files[0].type === 'application/json';
    } },
  });
  try {
    assert.equal(canShareGeneratedFile('collection.json', 'application/json'), true);
    assert.equal(canShareGeneratedFile('collection.xlsx', 'application/vnd.test.xlsx'), false);
    assert.deepEqual(received, ['application/json', 'application/vnd.test.xlsx']);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('native share capability requires the matching output bridge', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { GuanyunNative: { routeOutput() {} } },
  });
  try {
    assert.equal(canShareGeneratedFile('collection.json', 'application/json'), true);
    assert.equal(canShareGeneratedFile('collection.zip', 'application/zip'), false);
    assert.equal(canShareGeneratedFile('Shantu-workspace.json', 'application/json'), false);
    Object.assign(globalThis.window.GuanyunNative, {
      archiveBegin() {}, archiveAppend() {}, archiveFinish() {}, archiveCancel() {},
    });
    assert.equal(canShareGeneratedFile('collection.zip', 'application/zip'), true);
    assert.equal(canShareGeneratedFile('Shantu-route-coordinates-123.csv', 'text/csv'), true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('large workspace JSON uses bounded native chunks and propagates a failed finish', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const bytes = new Uint8Array(9 * 1024 * 1024);
  bytes.fill(65);
  let written = 0, cancelled = false, shareValue;
  const bridge = {
    archiveBegin(name, size) { assert.equal(name, 'Shantu-workspace.json'); assert.equal(size, bytes.length); return 'ok:test'; },
    archiveAppend(token, offset, encoded) {
      assert.equal(token, 'test'); assert.equal(offset, written); assert.ok(encoded.length <= 256 * 1024);
      const chunk = Buffer.from(encoded, 'base64'); assert.ok(chunk.every(value => value === 65)); written += chunk.length; return 'ok';
    },
    archiveFinish(token, share) { assert.equal(written, bytes.length); shareValue = share; return 'ok'; },
    archiveCancel() { cancelled = true; },
    routeOutput() { assert.fail('large workspace must not use the legacy 8 MB bridge'); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { GuanyunNative: bridge } });
  try {
    await deliverFile(new File([bytes], 'Shantu-workspace.json', {type:'application/json'}), false);
    assert.equal(shareValue, false); assert.equal(cancelled, true);
    written = 0; cancelled = false;
    bridge.archiveFinish = () => 'storage failure';
    await assert.rejects(deliverFile(new File([bytes], 'Shantu-workspace.json'), false), /storage failure/);
    assert.equal(cancelled, true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});
