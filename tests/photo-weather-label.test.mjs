import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['modules/photos/export.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const { weatherLabel } = await import(moduleUrl);

test('photos without saved weather say not recorded, while stored errors remain visible', () => {
  assert.equal(weatherLabel({}), '拍摄天气：未记录');
  assert.equal(weatherLabel({ weatherError: '历史查询超时' }), '拍摄天气：历史查询超时');
});
