import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { requestAppBack } from '../modules/input/appBack.ts';
import { parseHTML } from 'linkedom';

const nodeRequire = createRequire(import.meta.url);
let buildSequence = 0;

async function bundleModule(entry, plugins = []) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, plugins,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    nodeRequire, module, module.exports,
  );
  return module.exports;
}

async function makeHarness(t, { replies, hold = false } = {}) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.setTimeout = globalThis.setTimeout.bind(globalThis);
  window.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  window.setInterval = globalThis.setInterval.bind(globalThis);
  window.clearInterval = globalThis.clearInterval.bind(globalThis);
  window.location = { origin: 'http://localhost' };
  let requestCount = 0;
  const signals = [];
  globalThis.fetch = async (_url, init = {}) => {
    requestCount++;
    signals.push(init.signal);
    if (hold) return await new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const reply = typeof replies === 'function' ? replies(requestCount) : replies?.[requestCount - 1];
    if (reply instanceof Error) throw reply;
    return Response.json(reply);
  };
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useCmaRadar } = await bundleModule('modules/weather/useCmaRadar.ts');
  const root = createRoot(document.getElementById('root'));
  const mounted = [];
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const child of mounted) child.unmount?.();
    globalThis.fetch = old.fetch;
    if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window;
    if (old.document === undefined) delete globalThis.document; else globalThis.document = old.document;
    if (old.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
  });
  let state;
  function Probe({ enabled = true }) { state = useCmaRadar(enabled); return null; }
  const render = enabled => React.act(async () => root.render(React.createElement(Probe, { enabled })));
  const flush = () => React.act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await flush(); }
    assert.fail('timed out waiting for radar state');
  };
  return { React, window, document, root, mounted, useCmaRadar, render, flush, waitFor,
    get state() { return state; }, get requestCount() { return requestCount; }, signals };
}

function directory({ frames, latestAt = frames[0]?.observedAt ?? null, source = '国家气象数据网', product = '全国雷达拼图 · 组合反射率', unit = 'dBZ' } = {}) {
  return { source, product, unit, frames: frames.map(frame => ({
    imagePath: `/api/radar?date=20261006&frame=${frame.id}`, ...frame,
  })), latestAt };
}

function frame(id, ageMinutes = 5) {
  return { id, observedAt: new Date(Date.now() - ageMinutes * 60_000).toISOString() };
}

test('CMA hook rejects wrong source, unit, latestAt mismatch, and future frames', async t => {
  const invalids = [
    directory({ frames: [frame('a')], source: 'other' }),
    directory({ frames: [frame('a')], unit: 'mm' }),
    directory({ frames: [frame('a')], latestAt: null }),
    directory({ frames: [frame('future', -10)], latestAt: frame('future', -10).observedAt }),
  ];
  const h = await makeHarness(t, { replies: () => invalids[Math.min(h.requestCount - 1, invalids.length - 1)] });
  await h.render(true);
  for (const invalid of invalids) {
    await h.waitFor(() => !h.state.loading && !!h.state.error);
    assert.equal(h.state.frames.length, 0);
    await h.React.act(async () => h.state.refresh());
    await h.flush();
  }
  assert.equal(h.requestCount, invalids.length + 1);
});

test('timeout clears loading and allows a retry; disabling the hook aborts an outstanding request', async t => {
  const h = await makeHarness(t, { hold: true });
  let timeoutCallback;
  const nativeSetTimeout = h.window.setTimeout;
  h.window.setTimeout = (callback, delay) => {
    if (delay === 25_000) { timeoutCallback = callback; return 991; }
    return nativeSetTimeout(callback, delay);
  };
  h.window.clearTimeout = id => { if (id !== 991) globalThis.clearTimeout(id); };
  await h.render(true);
  await h.flush();
  assert.equal(h.state.loading, true);
  await h.React.act(async () => timeoutCallback());
  await h.waitFor(() => !h.state.loading);
  assert.match(h.state.error, /超时/);
  assert.equal(h.requestCount, 1);
  await h.React.act(async () => { void h.state.refresh(); });
  await h.flush();
  assert.equal(h.requestCount, 2);
  assert.equal(h.state.loading, true);
  assert.equal(h.signals[1].aborted, false);
  await h.render(false);
  assert.equal(h.signals[1].aborted, true);
  assert.equal(h.state.loading, false);
});

test('manual historical frame remains selected when directory refresh adds a newer frame', async t => {
  const older = frame('older', 12), latest = frame('latest', 3), newest = frame('newest', 1);
  const h = await makeHarness(t, { replies: [directory({ frames: [latest, older], latestAt: latest.observedAt }),
    directory({ frames: [newest, latest, older], latestAt: newest.observedAt })] });
  await h.render(true);
  await h.waitFor(() => !h.state.loading && h.state.frames.length === 2);
  await h.React.act(async () => h.state.select(1));
  assert.equal(h.state.selectedFrame.id, 'older');
  await h.React.act(async () => h.state.refresh());
  await h.waitFor(() => !h.state.loading && h.state.frames.length === 3);
  assert.equal(h.state.selectedFrame.id, 'older');
});

test('same-frame image error can be retried by update, and stale data is labeled explicitly', async t => {
  const stale = frame('same', 100);
  const payload = directory({ frames: [stale], latestAt: stale.observedAt });
  const h = await makeHarness(t, { replies: () => payload });
  const { CmaRadarPanel } = await bundleModule('modules/weather/CmaRadarPanel.tsx', [{
    name: `radar-icons-${buildSequence++}`,
    setup(buildApi) {
      buildApi.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'radar-icons' }));
      buildApi.onLoad({ filter: /.*/, namespace: 'radar-icons' }, () => ({ contents: `
        export const ChevronLeft=()=>null, ChevronRight=()=>null, Maximize2=()=>null, Minus=()=>null,
        Plus=()=>null, RefreshCw=()=>null, X=()=>null;`, loader: 'js' }));
    },
  }]);
  const panelRoot = h.root;
  const renderPanel = open => h.React.act(async () => panelRoot.render(h.React.createElement(CmaRadarPanel, { open, onClose() {} })));
  await renderPanel(true);
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await h.flush(); } assert.fail('timed out waiting for panel'); };
  await wait(() => document.querySelector('.cma-radar-image img'));
  const firstImage = document.querySelector('.cma-radar-image img');
  await h.React.act(async () => firstImage.dispatchEvent(new window.Event('error')));
  assert.match(document.querySelector('[role=status]').textContent, /加载失败/);
  assert.match(document.querySelector('.cma-radar-meta').textContent, /超过 90 分钟/);
  await h.React.act(async () => document.querySelector('[aria-label="更新雷达目录并重试图片"]').click());
  await wait(() => document.querySelector('.cma-radar-image img') !== firstImage);
  const retryImage = document.querySelector('.cma-radar-image img');
  await h.React.act(async () => retryImage.dispatchEvent(new window.Event('load')));
  assert.equal(retryImage.style.visibility, 'visible');
});

test('application back is consumed by the lightbox and leaves its radar panel open', async t => {
  const latest = frame('back-target', 4);
  const h = await makeHarness(t, { replies: () => directory({ frames: [latest], latestAt: latest.observedAt }) });
  const { CmaRadarPanel } = await bundleModule('modules/weather/CmaRadarPanel.tsx', [{
    name: `radar-icons-${buildSequence++}`,
    setup(buildApi) {
      buildApi.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'radar-icons' }));
      buildApi.onLoad({ filter: /.*/, namespace: 'radar-icons' }, () => ({ contents: 'export const ChevronLeft=()=>null, ChevronRight=()=>null, Maximize2=()=>null, Minus=()=>null, Plus=()=>null, RefreshCw=()=>null, X=()=>null;', loader: 'js' }));
    },
  }]);
  const root = h.root;
  await h.React.act(async () => root.render(h.React.createElement(CmaRadarPanel, { open: true, onClose() {} })));
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await h.flush(); } assert.fail('timed out waiting for lightbox'); };
  await wait(() => document.querySelector('.cma-radar-image img'));
  await h.React.act(async () => document.querySelector('.cma-radar-image img').dispatchEvent(new window.Event('load')));
  await wait(() => document.querySelector('[aria-label="放大查看雷达原图"]'));
  await h.React.act(async () => document.querySelector('[aria-label="放大查看雷达原图"]').click());
  await wait(() => document.querySelector('[role="dialog"][aria-modal="true"]'));
  let rootEscapeCount = 0;
  const appRoot = document.createElement('main'); appRoot.className = 'observatory'; document.body.append(appRoot);
  appRoot.addEventListener('keydown', () => rootEscapeCount++);
  const closeButton = document.querySelector('[aria-label="关闭放大原图"]');
  Object.defineProperty(document, 'activeElement', { configurable: true, value: closeButton });
  assert.equal(document.activeElement.getAttribute('aria-label'), '关闭放大原图');
  let backHandled;
  await h.React.act(async () => { backHandled = requestAppBack(document); });
  assert.equal(backHandled, true);
  await wait(() => !document.querySelector('.cma-radar-lightbox'));
  assert.ok(document.querySelector('.cma-radar-panel'), 'closing lightbox must leave panel open');
  assert.equal(rootEscapeCount, 0, 'consumed Escape must not fall through to app root');
  appRoot.remove();
});
