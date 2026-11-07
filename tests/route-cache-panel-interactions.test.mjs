import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadPanel() {
  await build({
    entryPoints: ['modules/outdoor/RouteCachePanel.tsx'],
    outdir: '.openai/route-cache-panel-interactions',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{ name: 'route-cache-panel-test-stubs', setup(api) {
      const stub = (filter, name, contents) => {
        api.onResolve({ filter }, () => ({ path: name, namespace: 'route-cache-stub' }));
        api.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'route-cache-stub' }, () => ({ contents, loader: 'js' }));
      };
      stub(/asyncImportedRoutePlan$/, 'estimate', `
        export async function estimateImportedRouteDownloadAsync() { return { count: 12, estimatedBytes: 4096, bounds: [103, 30, 104, 31] }; }
      `);
      stub(/nativeOffline$/, 'native-offline', `
        export function canExportLegacyOfflineArchive(){return false;}
        export function requestLegacyOfflineArchiveExport(){}
      `);
      stub(/tileCache$/, 'tile-cache', `export const OFFLINE_MAP_KEY='test.offline';`);
    } }],
    logLevel: 'silent',
  });
  return (await import('../.openai/route-cache-panel-interactions/RouteCachePanel.js')).RouteCachePanel;
}

test('selecting an online map source enables Next and opens cache settings without starting downloads', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const RouteCachePanel = await loadPanel();
  const mount = document.getElementById('root');
  const root = createRoot(mount);
  const calls = [];
  const source = {
    id: 'source-1', name: '测试影像', kind: 'online', tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'],
    minzoom: 12, maxzoom: 16, tileSize: 256, scheme: 'xyz',
  };
  const unsupportedSource = { ...source, id: 'osm-public', name: 'OpenStreetMap 公共瓦片', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'] };
  const offline = {
    current: null, packages: [{ id: 'focused-task', name: '被定位的缓存', urls: ['tile'], done: 0, bytes: 0, complete: false, provider: 'imported', sourceId: source.id, sourceName: source.name }], busy: false, message: '', background: false, removing: [],
    pause() {}, resume() {}, remove() {}, verify() {},
    createImportedRoute(...args) { calls.push(args); },
  };
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, value] of Object.entries({ window: previous.window, document: previous.document, localStorage: previous.localStorage, IS_REACT_ACT_ENVIRONMENT: previous.actEnvironment })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  await React.act(async () => root.render(React.createElement(RouteCachePanel, {
    routes: [{ id: 'route-1', name: '测试路线', segments: [[[103, 30], [103.01, 30.01]]] }],
    sources: [source, unsupportedSource], offline, onOpenMap() {}, onSources() {}, initialRouteId: 'route-1',
    focusTripId: 'focused-task',
  })));

  const sourceSelect = [...mount.querySelectorAll('.route-cache-select-row select')]
    .find(select => [...select.options].some(option => option.value === source.id));
  assert.ok(sourceSelect);
  const nextBeforeSource = [...mount.querySelectorAll('button')].find(button => button.textContent.trim() === '下一步');
  assert.equal(nextBeforeSource.disabled, true);
  assert.match(mount.querySelector('.route-cache-step-hint').textContent, /先选择在线图源/);
  const reactProps = element => element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
  await React.act(async () => reactProps(sourceSelect).onChange({ target: { value: source.id } }));
  const next = [...mount.querySelectorAll('button')].find(button => button.textContent.trim() === '下一步');
  assert.ok(next);
  assert.equal(next.disabled, false, 'a selected route and valid online source enable the next-step button');
  await React.act(async () => next.click());
  assert.ok(mount.querySelector('.route-cache-options'), 'Next opens the buffer and zoom settings step');
  assert.equal(calls.length, 0, 'selecting a source and advancing steps does not start network downloads');

  await React.act(async () => mount.querySelector('.route-cache-back').click());
  const sourceAfterReturn = [...mount.querySelectorAll('.route-cache-select-row select')]
    .find(select => [...select.options].some(option => option.value === unsupportedSource.id));
  await React.act(async () => reactProps(sourceAfterReturn).onChange({ target: { value: unsupportedSource.id } }));
  await React.act(async () => [...mount.querySelectorAll('button')].find(button => button.textContent.trim() === '下一步').click());
  assert.match(mount.querySelector('.route-cache-source-error').textContent, /公共地图服务不支持批量下载/);
  assert.equal(mount.querySelector('.route-cache-primary').disabled, true, 'unsupported sources show the real rejection reason and cannot start');

  let focusedId = '';
  window.HTMLElement.prototype.scrollIntoView = function () { focusedId = this.dataset.tripId ?? ''; };
  await React.act(async () => mount.querySelector('.route-cache-back').click());
  await React.act(async () => [...mount.querySelectorAll('[role="tab"]')].find(button => button.textContent.includes('缓存包')).click());
  assert.ok(mount.querySelector('.route-cache-package--focused'));
  assert.equal(focusedId, 'focused-task', 'opening a task can scroll directly to its package row');
});

test('cache prompt opens the real task and preserves real progress and failure details', async t => {
  await build({
    entryPoints: ['modules/outdoor/OfflineMapProgressPrompt.tsx'],
    outdir: '.openai/route-cache-panel-interactions', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = { window: globalThis.window, document: globalThis.document, actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { OfflineMapProgressPrompt } = await import('../.openai/route-cache-panel-interactions/OfflineMapProgressPrompt.js');
  const mount = document.getElementById('root'), root = createRoot(mount);
  let opened = 0;
  const trip = { id: 'real-task', name: '林道', urls: ['a', 'b', 'c'], done: 1, bytes: 1048576, complete: false, phase: 'failed', phaseMessage: '图源请求失败，已下载瓦片保留，可稍后手动继续' };
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, value] of Object.entries({ window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.actEnvironment })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  await React.act(async () => root.render(React.createElement(OfflineMapProgressPrompt, { trip, onOpenTask() { opened++; } })));
  const prompt = mount.querySelector('button.offline-map-progress-prompt');
  assert.ok(prompt);
  assert.match(prompt.getAttribute('aria-label'), /图源请求失败/);
  assert.equal(prompt.querySelector('progress').getAttribute('value'), '1');
  assert.equal(prompt.querySelector('progress').getAttribute('max'), '3');
  await React.act(async () => prompt.click());
  assert.equal(opened, 1);
});
