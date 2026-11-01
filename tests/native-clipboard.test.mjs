import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('clipboard uses Android native result, reports failure, and retains browser fallback', async () => {
  await build({ entryPoints: ['modules/platform/macNative.ts'], outfile: '.openai/native161-clipboard-test.js', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  const { writeClipboard } = await import('../.openai/native161-clipboard-test.js');
  const calls = [];
  globalThis.window = { GuanyunNative: { clipboardWrite: text => { calls.push(text); return true; } } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async text => { calls.push(`web:${text}`); } } } });
  try {
    await writeClipboard('-33.8688, 151.2093');
    assert.deepEqual(calls, ['-33.8688, 151.2093']);
    window.GuanyunNative.clipboardWrite = () => false;
    await assert.rejects(writeClipboard('0, 0'), /Android/);
    assert.equal(calls.length, 1, 'a refused native write must not claim browser fallback success');
    delete window.GuanyunNative;
    await writeClipboard('0, 0');
    assert.deepEqual(calls, ['-33.8688, 151.2093', 'web:0, 0']);
  } finally { delete globalThis.window; delete globalThis.navigator; }
});
