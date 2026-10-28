import test from 'node:test';
import assert from 'node:assert/strict';
import { canExportLegacyOfflineArchive, requestLegacyOfflineArchiveExport } from '../modules/outdoor/nativeOffline.ts';

test('old APK export action is shown only when the native SAF export bridge exists', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = { GuanyunNative: { offlineStart() {} } };
    assert.equal(canExportLegacyOfflineArchive(), false);
    assert.throws(() => requestLegacyOfflineArchiveExport(), /没有旧版缓存导出入口/);

    let calls = 0;
    globalThis.window.GuanyunNative.offlineExportLegacyArchive = () => { calls++; return 'started'; };
    assert.equal(canExportLegacyOfflineArchive(), true);
    assert.equal(requestLegacyOfflineArchiveExport(), 'started');
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('the old APK export reports a bridge failure without pretending a file was saved', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = { GuanyunNative: { offlineStart() {}, offlineExportLegacyArchive: () => '请先暂停离线下载' } };
    assert.throws(() => requestLegacyOfflineArchiveExport(), /请先暂停离线下载/);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
