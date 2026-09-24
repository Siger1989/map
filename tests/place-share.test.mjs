import test from 'node:test';
import assert from 'node:assert/strict';
import { placeShareData } from '../modules/placeShare/data.ts';
import { sharePlace } from '../modules/placeShare/delivery.ts';
import { annotationSharePlace } from '../modules/annotations/share.ts';
import { newAnnotation } from '../modules/annotations/data.ts';

test('place links preserve longitude/latitude and explicitly declare WGS84', () => {
  for (const coordinates of [[103.52092, 30.79789], [-73.9, 40.7], [0, 0]]) {
    const data = placeShareData({ name: '山口 & 营地 #1', coordinates });
    const url = new URL(data.url);
    assert.equal(url.origin, 'https://uri.amap.com');
    assert.equal(url.pathname, '/marker');
    assert.equal(url.searchParams.get('position'), coordinates.join(','));
    assert.equal(url.searchParams.get('coordinate'), 'wgs84');
    assert.equal(url.searchParams.get('name'), '山口 & 营地 #1');
    assert.ok(data.text.includes(data.url));
  }
});
test('sharing validates coordinates, bounds names, and excludes private marker metadata', () => {
  for (const coordinates of [[NaN, 0], [181, 30], [30, -91], [0]]) assert.throws(() => placeShareData({ name: 'X', coordinates }), /坐标/);
  const place = { name: '营地\n第二行', coordinates: [103, 31], note: 'secret', photos: ['private-photo'], detail: 'private-address' };
  const before = structuredClone(place), data = placeShareData(place);
  assert.equal(data.name, '营地 第二行');
  assert.ok(!/secret|private-photo|private-address/.test(data.text));
  assert.deepEqual(place, before);
  assert.equal(placeShareData({ ...place, name: ' ' }).name, '地图位置');
  assert.equal(placeShareData({ ...place, name: '名'.repeat(300) }).name.length, 120);
});
test('pin sharing includes its editable information and explicitly excludes photo attachments', () => {
  const pin = newAnnotation('pin', [103, 31], 1234.5, 'pin');
  pin.name = '营地'; pin.note = '水源在东侧'; pin.icon = 'camp'; pin.color = '#598fff';
  pin.attributes = [{ name: '补给', value: '2 天' }];
  const data = placeShareData(annotationSharePlace(pin));
  for (const value of ['营地', '水源在东侧', '图案：营地', '#598FFF', '补给：2 天', '海拔：1234.5 m', '显示：是', '照片附件不会进入系统文本分享']) assert.match(data.text, new RegExp(value));
  assert.match(data.summary, /照片附件/);
});
test('native share uses the selected place and surfaces bridge failure without claiming success', async () => {
  const previous = globalThis.window;
  const place = { name: '集合点', coordinates: [103, 31] };
  let received;
  try {
    globalThis.window = { GuanyunNative: { placeTextShare: text => { received = text; return 'ok'; } } };
    assert.match(await sharePlace(place), /系统分享/);
    assert.equal(received, placeShareData(place).text);
    globalThis.window.GuanyunNative.placeTextShare = () => '分享不可用';
    await assert.rejects(sharePlace(place), /分享不可用/);
    globalThis.window.GuanyunNative = {};
    await assert.rejects(sharePlace(place), /新版 APK/);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
test('web sharing supplies plain text; cancellation is preserved and unsupported environments offer copying', async () => {
  const previousWindow = globalThis.window, previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    globalThis.window = {};
    let received;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { share: async data => { received = data; } } });
    await sharePlace({ name: '目的地', coordinates: [0, 0] });
    assert.equal(received.title, '目的地');
    assert.match(received.text, /WGS84/);
    assert.equal(received.files, undefined);
    navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); };
    await assert.rejects(sharePlace({ name: '地点', coordinates: [0, 0] }), { name: 'AbortError' });
    navigator.share = undefined;
    await assert.rejects(sharePlace({ name: '地点', coordinates: [0, 0] }), /复制地点信息/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
  }
});
