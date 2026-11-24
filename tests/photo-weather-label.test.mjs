import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fetchPhotoWeather } from '../modules/photos/weather.ts';

const built = await build({ entryPoints: ['modules/photos/export.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const { renderPhotoExport } = await import(moduleUrl);

test('photo exports retain ordinary metadata without showing or mutating historical weather', async (t) => {
  const text = [];
  let bitmapClosed = false;
  const ctx = {
    measureText: value => ({ width: value.length * 10 }),
    fillRect() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage() {},
    fillText: value => text.push(value),
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    toBlob: callback => callback(new Blob(['rendered-photo'], { type: 'image/jpeg' })),
  };
  const documentBefore = globalThis.document;
  const bitmapBefore = globalThis.createImageBitmap;
  globalThis.document = { createElement: () => canvas };
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 800, close() { bitmapClosed = true; } });
  t.after(() => {
    if (documentBefore === undefined) delete globalThis.document; else globalThis.document = documentBefore;
    if (bitmapBefore === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = bitmapBefore;
  });
  const weather = Object.freeze({ source: 'forecast', time: Date.UTC(2026, 10, 20), fetchedAt: Date.UTC(2026, 10, 20), temperature: 18, precipitation: 2, wind: 4, code: 61 });
  const photo = Object.freeze({
    name: '青城山照片', title: '山路', note: '保留备注', time: Date.UTC(2026, 10, 20),
    coordinates: [103.5, 30.9], altitude: { metres: 1234, source: 'exif' },
    preview: new Blob(['original']), weather, weatherError: '旧天气错误',
  });
  const file = await renderPhotoExport(photo, true);
  assert.equal(file.type, 'image/jpeg');
  assert.equal(bitmapClosed, true);
  const output = text.join('\n');
  assert.match(output, /山路/);
  assert.match(output, /保留备注/);
  assert.match(output, /1234/);
  assert.match(output, /30\.90000, 103\.50000/);
  assert.match(output, /2026/);
  assert.doesNotMatch(output, /天气|Open-Meteo|降水|风 |℃|旧天气错误/);
  assert.equal(photo.weather, weather);
  assert.equal(photo.weatherError, '旧天气错误');
});

test('the retired photo-weather transport performs no request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected weather request'); });
  await assert.rejects(fetchPhotoWeather(Date.now(), [103.5, 30.9], new AbortController().signal), /功能已移除/);
  assert.equal(fetch.mock.callCount(), 0);
});
