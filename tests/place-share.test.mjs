import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { placeNavigationData, placeShareData } from '../modules/placeShare/data.ts';
import { copyAndOpenPlaceNavigation, sharePlace } from '../modules/placeShare/delivery.ts';
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
test('marker navigation copies the same destination and requests AMap without inventing an origin', () => {
  const place = { name: '营地', coordinates: [103.5, 30.7], shareText: '私有标记内容' };
  const data = placeNavigationData(place);
  const url = new URL(data.url);
  assert.equal(url.searchParams.get('position'), '103.5,30.7');
  assert.equal(url.searchParams.get('coordinate'), 'wgs84');
  assert.equal(url.searchParams.get('callnative'), '1');
  assert.equal(url.searchParams.has('from'), false);
  assert.match(data.text, /私有标记内容/);
  assert.ok(data.text.includes(data.url));
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
test('copy navigation writes the marker text before requesting the explicit AMap handler', async () => {
  const previous = globalThis.window;
  const calls = [];
  try {
    globalThis.window = { GuanyunNative: {
      clipboardWrite: text => { calls.push(['copy', text]); return true; },
      openAmapMarker: url => { calls.push(['open', url]); return 'requested'; },
    } };
    const result = await copyAndOpenPlaceNavigation({ name: '营地', coordinates: [103, 31] });
    assert.match(result, /已请求高德地图/);
    assert.equal(calls[0][0], 'copy');
    assert.equal(calls[1][0], 'open');
    assert.equal(calls[0][1].includes(calls[1][1]), true);
    globalThis.window.GuanyunNative.openAmapMarker = () => 'unavailable';
    assert.match(await copyAndOpenPlaceNavigation({ name: '营地', coordinates: [103, 31] }), /未检测到高德地图/);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
test('Android external launch is restricted to the installed AMap WGS84 marker handler', async () => {
  const source = await readFile(new URL('../mobile/android/src/com/guanyun/weather/NativeBridge.java', import.meta.url), 'utf8');
  const formatter = await readFile(new URL('../mobile/android/src/com/guanyun/weather/AmapNavigationUri.java', import.meta.url), 'utf8');
  assert.match(source, /trustedForeground\(\).*打开高德/s);
  assert.match(source, /"uri\.amap\.com"\.equals\(uri\.getHost\(\)\)/);
  assert.match(source, /"\/marker"\.equals\(uri\.getPath\(\)\)/);
  assert.match(source, /"wgs84"\.equals\(uri\.getQueryParameter\("coordinate"\)\)/);
  assert.match(source, /"1"\.equals\(uri\.getQueryParameter\("callnative"\)\)/);
  assert.match(source, /AmapNavigationUri\.build\(name, lat, lon\)/);
  assert.match(source, /new Intent\(Intent\.ACTION_VIEW, navigationUri\)/);
  assert.match(source, /setPackage\("com\.autonavi\.minimap"\)/);
  assert.match(source, /return "unavailable"/);
  assert.match(formatter, /"androidamap:\/\/viewMap\?sourceApplication="/);
  assert.match(formatter, /"&poiname=" \+ encode\(name\)/);
  assert.match(formatter, /"&lat=" \+ Double\.toString\(latitude\)/);
  assert.match(formatter, /"&lon=" \+ Double\.toString\(longitude\)/);
  assert.match(formatter, /"&dev=1"/);
  assert.doesNotMatch(formatter, /androidamap:\/\/navi\?|&style=/i);
  assert.match(formatter, /URLEncoder\.encode\(value, "UTF-8"\)/);
});
test('copy navigation action is exposed on the first selected-pin toolbar', async () => {
  const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const toolbar = source.slice(source.indexOf('className={`selection-tools glass'), source.indexOf('className="selection-tools-route-actions"'));
  const actionsAt = source.indexOf('className="selection-tools-route-actions"');
  const navigationActions = source.slice(actionsAt, actionsAt + 1400);
  assert.ok(toolbar.length > 0);
  assert.match(navigationActions, /复制导航/);
  assert.match(navigationActions, /copyAndOpenPlaceNavigation\(annotationSharePlace\(selectedAnnotation\)\)/);
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
