import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION, APP_VERSION_CODE } from '../config/product.ts';

test('Android installation and shared desktop/in-app identity use the same release', async () => {
  const manifest = await readFile(new URL('../mobile/android/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.equal(manifest.match(/android:versionName="([^"]+)"/)?.[1], APP_VERSION);
  assert.equal(Number(manifest.match(/android:versionCode="(\d+)"/)?.[1]), APP_VERSION_CODE);
});
