import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativePhotoImportInfo } from '../modules/photos/nativeImportStatus.ts';

const report = (changes = {}) => ({
  id: 2, status: 'complete', message: '照片文件已读取', selected: 1, prepared: 1,
  notes: ['相机原片.jpg：已通过所选文件读取。'], failures: [], ...changes,
});

test('successful fallback remains informational and does not become a GPS/save failure', () => {
  const info = parseNativePhotoImportInfo(JSON.stringify(report()));
  assert.equal(info.status, 'complete');
  assert.equal(info.prepared, 1);
  assert.deepEqual(info.failures, []);
  assert.equal(info.notes[0], '相机原片.jpg：已通过所选文件读取。');
});

test('failed or denied reads retain complete messages without a transient-toast limit', () => {
  const failures = Array.from({ length: 9 }, (_, index) => `照片${index}：无法读取所选文件，请重新选择本机原片。`);
  const info = parseNativePhotoImportInfo(JSON.stringify(report({ status: 'failed', selected: 9, prepared: 0, notes: [], failures })));
  assert.deepEqual(info.failures, failures);
  assert.equal(parseNativePhotoImportInfo(JSON.stringify(report({
    status: 'failed', selected: 0, prepared: 0, message: '未授予照片位置读取权限，本次未开始选择；可确认系统权限后重新尝试',
  }))).message, '未授予照片位置读取权限，本次未开始选择；可确认系统权限后重新尝试');
});

test('old bridge, malformed JSON, unsupported states and unbounded payloads are ignored', () => {
  for (const raw of ['{}', 'not-json', 'null', '[]', ' '.repeat(256_001),
    JSON.stringify(report({ status: 'saved' })), JSON.stringify(report({ id: -1 })),
    JSON.stringify(report({ prepared: 2 })), JSON.stringify(report({ selected: 201 })),
    JSON.stringify(report({ failures: [{}] })), JSON.stringify(report({ notes: Array(201).fill('x') })),
  ]) assert.equal(parseNativePhotoImportInfo(raw), null);
});
