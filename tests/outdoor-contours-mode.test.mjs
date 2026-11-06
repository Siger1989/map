import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_LAYERS } from '../modules/map/types.ts';
import { serializeNativeLayerSettings } from '../modules/map/native/layerPayload.ts';

test('native layer payload carries outdoor contour mode without altering adjacent layer choices', () => {
  const source = { ...DEFAULT_LAYERS, terrain: false, satellite: true, contours: true, outdoorContours: true };
  const payload = serializeNativeLayerSettings(source);
  assert.notEqual(payload, source);
  assert.deepEqual(payload, source);
  assert.equal(serializeNativeLayerSettings({ ...DEFAULT_LAYERS, terrain: false }).outdoorContours, false);
});

test('native render state serializes the explicit outdoor-contour setting and web mode is honest', async () => {
  const nativeMap = await readFile(new URL('../modules/map/native/NativeTerrainMap.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../modules/controls/LayerPanel.tsx', import.meta.url), 'utf8');
  assert.equal((nativeMap.match(/serializeNativeLayerSettings\(current\.settings\)/g) ?? []).length, 2);
  assert.match(panel, /key: 'outdoorContours'/);
  assert.match(panel, /label: '户外等高线'/);
  assert.match(panel, /此模式仅由 Android 原生地图支持；网页不模拟绘制，也不生成虚假地形/);
  assert.match(panel, /高程未加载处暂时留空/);
});
