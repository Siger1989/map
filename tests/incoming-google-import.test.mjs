import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { newAnnotation } from '../modules/annotations/data.ts';

const ANNOTATIONS_KEY = 'guanyun.annotations.v1';
let bundlePromise;

function bundleHarness() {
  bundlePromise ??= build({
    stdin: {
      contents: "export { IncomingPlacePrompt } from './modules/incomingPlace/IncomingPlacePrompt'; export { useAnnotations } from './modules/annotations/useAnnotations';",
      resolveDir: process.cwd(), loader: 'tsx',
    },
    outfile: '.openai/incoming-google-import.mjs', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
    plugins: [{ name: 'no-network-terrain', setup(api) {
      api.onResolve({ filter: /terrain\/elevation$/ }, () => ({ path: 'terrain', namespace: 'test' }));
      api.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export async function readElevation(){return null}' }));
    } }],
  });
  return bundlePromise;
}

async function harness(t, initialInfo, { failWrites = 0, failAnnotationReads = false, seed = [] } = {}) {
  // React DOM must see the linkedom document at first import.
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const old = Object.fromEntries(['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  const disk = new Map();
  if (seed.length) disk.set(ANNOTATIONS_KEY, JSON.stringify(seed));
  let annotationWrites = 0;
  const localStorage = {
    getItem(key) {
      if (key === ANNOTATIONS_KEY && failAnnotationReads) throw new Error('synthetic annotation read failure');
      return disk.get(key) ?? null;
    },
    setItem(key, value) {
      if (key === ANNOTATIONS_KEY && failWrites > 0) {
        failWrites--;
        throw new Error('synthetic storage failure');
      }
      if (key === ANNOTATIONS_KEY) annotationWrites++;
      disk.set(key, value);
    },
  };
  Object.assign(globalThis, { window, document: window.document, localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  window.setTimeout = globalThis.setTimeout.bind(globalThis);
  window.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  window.requestAnimationFrame = callback => setTimeout(callback, 0);
  window.cancelAnimationFrame = clearTimeout;

  let info = initialInfo;
  const dismissCalls = [], retryCalls = [], navigated = [], autoSaveCalls = [];
  window.GuanyunNative = {
    incomingPlaceInfo: () => JSON.stringify(info),
    incomingPlaceDismiss: token => dismissCalls.push(token),
    incomingPlaceRetry: token => retryCalls.push(token),
  };
  await bundleHarness();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { IncomingPlacePrompt, useAnnotations } = await import('../.openai/incoming-google-import.mjs');
  let state;
  let root;
  function Probe() {
    state = useAnnotations();
    return React.createElement(IncomingPlacePrompt, {
      onNavigate: place => { navigated.push(place); return true; },
      onAutoSave: place => { autoSaveCalls.push(place); return state.savePlace(place); },
      saveError: state.error,
    });
  }
  const flush = () => React.act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const setInfo = async (next, notify = true) => {
    info = next;
    if (notify) await React.act(async () => window.dispatchEvent(new window.Event('shantu-incoming-place')));
  };
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
    assert.ok(button, `missing button: ${label}`);
    await React.act(async () => button.click());
  };
  const mount = async () => {
    root = createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(Probe)));
    await flush();
  };
  const unmount = async () => {
    if (!root) return;
    const prior = root;
    root = undefined;
    await React.act(async () => prior.unmount());
  };
  await mount();
  t.after(async () => {
    await unmount();
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete globalThis[key];
      else globalThis[key] = old[key];
    }
  });
  return {
    React, setInfo, click, flush, mount, unmount, disk, get state() { return state; },
    annotationWrites: () => annotationWrites,
    annotations: () => JSON.parse(disk.get(ANNOTATIONS_KEY) ?? '[]'),
    dialogText: () => document.querySelector('[role="dialog"]')?.textContent ?? '',
    hasDialog: () => !!document.querySelector('[role="dialog"]'),
    autoSaveCalls, dismissCalls, retryCalls, navigated,
  };
}

const googleInfo = (token, overrides = {}) => ({
  token, state: 'received', raw: 'https://www.google.com/maps/place/Synthetic+Summit/data=!4m2!3d12.3456!4d-98.7654', ...overrides,
});

test('resolving share shows progress without writing an annotation', async t => {
  const h = await harness(t, { token: 'resolve-1', state: 'resolving', raw: '' });
  assert.match(h.dialogText(), /正在读取 Google 地点/);
  assert.match(h.dialogText(), /正在联网展开地点链接/);
  assert.equal(h.annotationWrites(), 0);
  assert.equal(h.autoSaveCalls.length, 0);
});

test('received Google place auto-saves the parsed name and WGS84 coordinates to localStorage', async t => {
  const h = await harness(t, googleInfo('google-1', { title: 'System Share Title' }));
  const [marker] = h.annotations();
  assert.equal(h.annotationWrites(), 1);
  assert.equal(h.annotations().length, 1);
  assert.equal(marker.name, 'Synthetic Summit', 'Google place path name wins over the system title');
  assert.deepEqual(marker.coordinates, [-98.7654, 12.3456]);
  assert.equal(h.autoSaveCalls.length, 1);
  assert.match(h.dialogText(), /已添加 Google 地点/);
  assert.equal(h.state.items.length, 1);
});

test('same token is saved once and a new share token for the same place does not duplicate the marker', async t => {
  const h = await harness(t, googleInfo('same-token'));
  await h.setInfo(googleInfo('same-token'));
  assert.equal(h.autoSaveCalls.length, 1);
  assert.equal(h.annotationWrites(), 1);

  await h.setInfo(googleInfo('new-token'));
  assert.equal(h.autoSaveCalls.length, 2, 'a distinct native share token is handled once');
  assert.equal(h.annotationWrites(), 1, 'the real annotation store recognizes the existing named place');
  assert.equal(h.annotations().length, 1);
});

test('cold-start auto-save preserves an existing marker and a remount does not duplicate the same token', async t => {
  const existing = newAnnotation('pin', [104.5, 30.5], null, 'legacy-marker-1');
  existing.name = 'Existing field note';
  existing.color = '#4b6f29';
  existing.note = 'Keep this local note';
  const expectedExisting = structuredClone(existing);
  const h = await harness(t, googleInfo('cold-start-1'), { seed: [existing] });

  let markers = h.annotations();
  assert.equal(h.annotationWrites(), 1);
  assert.equal(markers.length, 2);
  assert.deepEqual(markers.find(marker => marker.id === existing.id), expectedExisting);
  assert.equal(markers.filter(marker => marker.name === 'Synthetic Summit').length, 1);

  const writesBeforeRemount = h.annotationWrites();
  await h.unmount();
  await h.mount();
  markers = h.annotations();
  assert.equal(h.dismissCalls.length, 0, 'the native token remains unacknowledged during this remount');
  assert.equal(h.annotationWrites(), writesBeforeRemount, 'store-level deduplication avoids another write');
  assert.equal(markers.length, 2);
  assert.deepEqual(markers.find(marker => marker.id === existing.id), expectedExisting);
  assert.equal(markers.filter(marker => marker.name === 'Synthetic Summit').length, 1);
});

test('closing the received prompt dismisses its token and keeps the saved marker', async t => {
  const h = await harness(t, googleInfo('close-1'));
  await h.click('关闭');
  assert.deepEqual(h.dismissCalls, ['close-1']);
  assert.equal(h.hasDialog(), false);
  assert.equal(h.annotations().length, 1);
  assert.equal(h.annotations()[0].name, 'Synthetic Summit');
});

test('AMap explicit POI share auto-saves only converted place data and navigates without a resolution step', async t => {
  const raw = 'https://m.amap.com/poi/detail?__p=BSYNTHETIC01%2C39.915%2C116.404%2C%E5%90%88%E6%88%90%E6%B5%8B%E8%AF%95%E5%85%A5%E5%8F%A3%2C%E5%90%88%E6%88%90%E5%9C%B0%E5%9D%80&userRelationToken=SYNTHETIC_TRACKING';
  const h = await harness(t, { token: 'amap-1', state: 'received', raw });
  assert.match(h.dialogText(), /已添加高德地点/);
  assert.match(h.dialogText(), /高德坐标已转换为 WGS84/);
  assert.equal(h.annotations().length, 1);
  const marker = h.annotations()[0];
  assert.equal(marker.name, '合成测试入口');
  assert.equal(JSON.stringify(marker).includes('SYNTHETIC_TRACKING'), false);
  await h.click('在山兔导航');
  assert.equal(h.navigated.length, 1);
  assert.ok(Math.abs(h.navigated[0].coordinates[0] - 116.39775550083061) < 1e-9);
  assert.ok(Math.abs(h.navigated[0].coordinates[1] - 39.91359571849836) < 1e-9);
  assert.equal(h.retryCalls.length, 0);
});

test('navigation receives the original parsed place only after its marker is saved', async t => {
  const h = await harness(t, googleInfo('navigate-1'));
  await h.click('在山兔导航');
  assert.equal(h.navigated.length, 1);
  assert.deepEqual(h.navigated[0], {
    name: 'Synthetic Summit', coordinates: [-98.7654, 12.3456], coordinateSystem: 'WGS84', precision: 'unknown',
  });
  assert.deepEqual(h.dismissCalls, ['navigate-1']);
  assert.equal(h.annotations().length, 1);
});

test('invalid and viewport-only Google links never create markers', async t => {
  const h = await harness(t, googleInfo('invalid-1', { raw: 'https://www.google.com/maps/@12.3456,-98.7654,12z' }));
  assert.equal(h.annotationWrites(), 0);
  assert.equal(h.autoSaveCalls.length, 0);
  assert.match(h.dialogText(), /无法读取/);
  await h.setInfo(googleInfo('invalid-2', { raw: 'https://www.google.com/maps?q=91,181' }));
  assert.equal(h.annotationWrites(), 0);
  assert.equal(h.autoSaveCalls.length, 0);
  await h.setInfo(googleInfo('id-only-3', { raw: 'https://www.google.com/maps/place/Synthetic+ID+Only/data=!4m2!3m1!1s0xsynthetic:0xsynthetic!18m1!1e1' }));
  assert.match(h.dialogText(), /本版尚不能据此确认坐标/);
  assert.equal(h.annotationWrites(), 0);
  assert.equal(h.autoSaveCalls.length, 0);
  assert.equal(h.navigated.length, 0);
});

test('retryable failed resolution requests the same native token and accepts its resolved event', async t => {
  const h = await harness(t, { token: 'retry-read-7', state: 'failed', raw: '', reason: '网络暂不可用', retryable: true });
  assert.match(h.dialogText(), /网络暂不可用/);
  await h.click('重试读取');
  assert.deepEqual(h.retryCalls, ['retry-read-7']);
  await h.setInfo(googleInfo('retry-read-7'));
  assert.equal(h.annotations().length, 1);
  assert.equal(h.annotations()[0].name, 'Synthetic Summit');
});

test('pending foreground share observes failure and success even when native completion event is missed', async t => {
  const h = await harness(t, { token: 'lost-event', state: 'resolving', raw: '' });
  await h.setInfo({ token: 'lost-event', state: 'failed', raw: '', reason: 'Google 短链接不含坐标，山兔暂时无法连接 Google。', retryable: true }, false);
  await h.React.act(async () => new Promise(resolve => setTimeout(resolve, 560)));
  assert.match(h.dialogText(), /短链接不含坐标/);
  assert.doesNotMatch(h.dialogText(), /正在读取 Google 地点/);
  assert.equal(h.annotations().length, 0);
  await h.setInfo({ token: 'lost-event', state: 'resolving', raw: '' });
  await h.setInfo(googleInfo('lost-event'), false);
  await h.React.act(async () => new Promise(resolve => setTimeout(resolve, 560)));
  assert.equal(h.annotations().length, 1);
  assert.match(h.dialogText(), /已添加 Google 地点/);
});

test('failed auto-save cannot navigate and explicit save retry persists the place', async t => {
  const h = await harness(t, googleInfo('retry-save-9'), { failWrites: 1 });
  assert.equal(h.annotationWrites(), 0);
  assert.match(h.dialogText(), /标记尚未保存/);
  assert.match(h.dialogText(), /本机空间不足/);
  const nav = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '在山兔导航');
  assert.equal(nav.disabled, true);
  await h.click('在山兔导航');
  assert.equal(h.navigated.length, 0);

  await h.click('重试保存');
  assert.equal(h.annotationWrites(), 1);
  assert.equal(h.annotations().length, 1);
  assert.match(h.dialogText(), /已添加 Google 地点/);
  await h.click('在山兔导航');
  assert.equal(h.navigated.length, 1);
  assert.equal(h.navigated[0].name, 'Synthetic Summit');
  assert.deepEqual(h.navigated[0].coordinates, [-98.7654, 12.3456]);
});

test('annotation storage read failure preserves its original value and blocks navigation', async t => {
  const existing = newAnnotation('pin', [104.5, 30.5], null, 'unreadable-existing-marker');
  existing.name = 'Protected original';
  const original = JSON.stringify([existing]);
  const h = await harness(t, googleInfo('read-failure-1'), { seed: [existing], failAnnotationReads: true });
  assert.equal(h.annotationWrites(), 0);
  assert.equal(h.disk.get(ANNOTATIONS_KEY), original, 'failed reads never overwrite the stored bytes');
  assert.match(h.dialogText(), /标记尚未保存/);
  assert.match(h.dialogText(), /标记存档不可写/);
  const nav = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '在山兔导航');
  assert.equal(nav.disabled, true);
  await h.click('在山兔导航');
  assert.equal(h.navigated.length, 0);
  assert.equal(h.annotationWrites(), 0);
  assert.equal(h.disk.get(ANNOTATIONS_KEY), original);
});
