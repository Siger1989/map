import test from 'node:test';
import assert from 'node:assert/strict';
import { canShareGeneratedFile } from '../modules/files/delivery.ts';

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
    Object.assign(globalThis.window.GuanyunNative, {
      archiveBegin() {}, archiveAppend() {}, archiveFinish() {}, archiveCancel() {},
    });
    assert.equal(canShareGeneratedFile('collection.zip', 'application/zip'), true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});
