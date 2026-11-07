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
        export async function estimateImportedRouteDownloadAsync(area) { globalThis.__estimatedCacheArea = area; return { count: 12, estimatedBytes: 4096, bounds: [103, 30, 104, 31] }; }
      `);
      stub(/nativeOffline$/, 'native-offline', `
        export function canExportLegacyOfflineArchive(){return globalThis.__legacyExportAvailable===true;}
        export function requestLegacyOfflineArchiveExport(){globalThis.__legacyExportCalls=(globalThis.__legacyExportCalls??0)+1;return 'started';}
      `);
      stub(/tileCache$/, 'tile-cache', `export const OFFLINE_MAP_KEY='test.offline';`);
    } }],
    logLevel: 'silent',
  });
  return (await import('../.openai/route-cache-panel-interactions/RouteCachePanel.js')).RouteCachePanel;
}

test('area cache uses the selected polygon boundary and omits route buffer settings', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
    estimatedCacheArea: globalThis.__estimatedCacheArea,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
    __estimatedCacheArea: undefined,
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const RouteCachePanel = await loadPanel();
  const mount = document.getElementById('root'), root = createRoot(mount);
  const source = {
    id: 'area-source', name: '区域影像', kind: 'online', tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'],
    minzoom: 12, maxzoom: 16, tileSize: 256, scheme: 'xyz',
  };
  const boundary = [[103, 30], [103.02, 30], [103.02, 30.02], [103, 30.02], [103, 30]];
  const calls = [];
  const offline = {
    current: null, packages: [], busy: false, message: '', background: false, removing: [],
    pause() {}, resume() {}, remove() {}, verify() {},
    createImportedRoute(...args) { calls.push(args); },
  };
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, value] of Object.entries({
      window: previous.window,
      document: previous.document,
      localStorage: previous.localStorage,
      IS_REACT_ACT_ENVIRONMENT: previous.actEnvironment,
      __estimatedCacheArea: previous.estimatedCacheArea,
    })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  await React.act(async () => root.render(React.createElement(RouteCachePanel, {
    routes: [], areas: [{ id: 'drawn-area', name: '河谷区域', boundary }], initialAreaId: 'drawn-area',
    sources: [source], offline, onOpenMap() {}, onSources() {},
  })));

  assert.equal(mount.querySelector('.route-cache-mode button[aria-pressed="true"]').textContent, '区域缓存');
  assert.match(mount.querySelector('.route-cache-mode button[title]')?.title ?? '', /按区域内部及边界瓦片缓存/);
  const reactProps = element => element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
  assert.equal(mount.querySelectorAll('.route-cache-select-row select').length, 1, 'first step contains only the selected area dropdown');
  assert.equal(mount.querySelector('.route-cache-primary').textContent.trim(), '确认区域');
  assert.equal([...mount.querySelectorAll('select')].some(select => [...select.options].some(option => option.value === source.id)), false, 'source selection is deferred to its own step');
  await React.act(async () => mount.querySelector('.route-cache-primary').click());
  const sourceSelect = [...mount.querySelectorAll('.route-cache-select-row select')]
    .find(select => [...select.options].some(option => option.value === source.id));
  assert.ok(sourceSelect, 'the next step presents the common source selector');
  await React.act(async () => reactProps(sourceSelect).onChange({ target: { value: source.id } }));
  await React.act(async () => mount.querySelector('.route-cache-back').click());
  assert.equal(mount.querySelector('.route-cache-mode button[aria-pressed="true"]').textContent, '区域缓存', 'returning keeps the selected scope type');
  assert.equal(mount.querySelector('.route-cache-select-row select').value, 'drawn-area', 'returning keeps the selected polygon');
  await React.act(async () => mount.querySelector('.route-cache-primary').click());
  assert.equal([...mount.querySelectorAll('.route-cache-select-row select')].find(select => select.value === source.id)?.value, source.id, 'returning to source setup keeps the selected source');
  await React.act(async () => [...mount.querySelectorAll('button')].find(button => button.textContent.trim() === '下一步').click());

  assert.ok(mount.querySelector('.route-cache-options'), 'area mode follows the same zoom configuration step');
  assert.doesNotMatch(mount.textContent, /路线两侧/);
  await React.act(async () => mount.querySelector('.route-cache-primary').click());
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '河谷区域');
  assert.deepEqual(calls[0][1], { kind: 'polygon', boundary });
  assert.equal(calls[0][2], source);
  assert.equal(calls[0][4], undefined, 'area downloads do not pass route names');
  assert.deepEqual(globalThis.__estimatedCacheArea, { kind: 'polygon', boundary }, 'estimate uses the same polygon instead of route length or a rectangle');
});

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

  assert.equal(mount.querySelector('.route-cache-primary').textContent.trim(), '确认路线');
  assert.equal(mount.querySelector('.route-cache-step-hint'), null, 'the scope step does not ask for a source before its own step');
  assert.equal(mount.querySelectorAll('.route-cache-select-row select').length, 1);
  await React.act(async () => mount.querySelector('.route-cache-primary').click());
  const sourceSelect = [...mount.querySelectorAll('.route-cache-select-row select')]
    .find(select => [...select.options].some(option => option.value === source.id));
  assert.ok(sourceSelect, 'route confirmation advances to the dedicated source step');
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
  await React.act(async () => mount.querySelector('.route-cache-back').click());
  assert.ok(mount.querySelector('.route-cache-mode'), 'return through source selection before switching to package management');
  await React.act(async () => [...mount.querySelectorAll('[role="tab"]')].find(button => button.textContent.includes('缓存包')).click());
  assert.ok(mount.querySelector('.route-cache-package--focused'));
  assert.equal(focusedId, 'focused-task', 'opening a task can scroll directly to its package row');
});

test('package list leads, current task is located, unavailable sources remain visible, and backup stays collapsed', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
    legacyExportAvailable: globalThis.__legacyExportAvailable,
    legacyExportCalls: globalThis.__legacyExportCalls,
  };
  const stored = new Map();
  Object.assign(globalThis, {
    window, document: window.document,
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) },
    IS_REACT_ACT_ENVIRONMENT: true,
    __legacyExportAvailable: true,
    __legacyExportCalls: 0,
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const RouteCachePanel = await loadPanel();
  const mount = document.getElementById('root'), root = createRoot(mount);
  const source = { id: 'available-source', name: '已导入图源', kind: 'online', tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'], minzoom: 12, maxzoom: 16, tileSize: 256 };
  const active = {
    id: 'active-181-task', name: '林道缓存 · 正在下载', provider: 'imported', sourceId: source.id, sourceName: source.name,
    urls: Array.from({ length: 4768 }, (_, index) => `https://tiles.example.test/${index}`), done: 3178, bytes: 45_403_340,
    complete: false, phase: 'running', phaseMessage: '缓存中', createdAt: 1760000000000,
  };
  const missingSource = {
    id: 'retained-failed-task', name: '北坡缓存 · 暂停', provider: 'imported', sourceId: 'removed-source', sourceName: '已移除图源',
    urls: Array.from({ length: 12 }, (_, index) => `https://removed.example.test/${index}`), done: 8, bytes: 819200,
    complete: false, phase: 'failed', phaseMessage: '最近失败原因：图源连接超时，已下载内容保留', createdAt: 1760000001000,
  };
  const calls = { open: [], resume: [], verify: [], remove: [], pause: 0 };
  const openMap = trip => {
    calls.open.push(trip.id);
    stored.set('shantu.offline-package.v1', trip.id);
    stored.set('test.offline', 'true');
    window.dispatchEvent(new window.Event('shantu:offline-map-mode'));
  };
  const offline = {
    current: active, packages: [active, missingSource], busy: true, message: '', background: true, removing: [],
    pause() { calls.pause++; }, resume(trip) { calls.resume.push(trip.id); }, verify(trip) { calls.verify.push(trip.id); }, remove(trip) { calls.remove.push(trip.id); },
  };
  let focusedId = '';
  window.HTMLElement.prototype.scrollIntoView = function () { focusedId = this.dataset.tripId ?? ''; };
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, value] of Object.entries({ window: previous.window, document: previous.document, localStorage: previous.localStorage, IS_REACT_ACT_ENVIRONMENT: previous.actEnvironment, __legacyExportAvailable: previous.legacyExportAvailable, __legacyExportCalls: previous.legacyExportCalls })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  await React.act(async () => root.render(React.createElement(RouteCachePanel, {
    routes: [], sources: [source], offline, onOpenMap: openMap, onSources() {}, initialTab: 'packages',
    focusTripId: 'stale-focus-id',
  })));

  const rows = [...mount.querySelectorAll('.route-cache-package[data-trip-id]')];
  assert.equal(rows.length, 2, 'both imported task rows are rendered with export capability present');
  assert.equal(rows[0].dataset.tripId, active.id);
  assert.equal(focusedId, active.id, 'the matching current task is scrolled into view');
  assert.match(rows[0].textContent, /林道缓存 · 正在下载/);
  assert.match(rows[0].textContent, /图源：已导入图源/);
  assert.match(rows[0].textContent, /下载中/);
  assert.match(rows[0].textContent, /3178\/4768 项/);
  assert.match(rows[0].textContent, /43\.3 MB/);
  assert.equal(rows[0].querySelector('progress').getAttribute('value'), '3178');
  assert.equal(rows[0].querySelector('progress').getAttribute('max'), '4768');

  const missingRow = rows[1];
  assert.match(missingRow.textContent, /原图源已移除或未导入/);
  assert.match(missingRow.textContent, /最近失败原因：图源连接超时/);
  assert.equal(missingRow.querySelector('.route-cache-package-open').disabled, true);
  assert.equal([...missingRow.querySelectorAll('button')].find(button => button.textContent.includes('仅缓存浏览')).disabled, true);
  assert.equal([...missingRow.querySelectorAll('button')].find(button => button.textContent.trim() === '检查完整性').disabled, true, 'the shared verifier stays gated while the native download is active');

  const archive = mount.querySelector('.route-cache-archive-details');
  assert.ok(archive, 'native export capability keeps the backup action available');
  assert.equal(archive.parentElement, mount.querySelector('.route-cache-package-list'), 'backup entry lives in the same scrolling list');
  assert.equal(mount.querySelector('.route-cache-package-list').lastElementChild, archive, 'the backup entry follows every package row');
  assert.equal(archive.hasAttribute('open'), false, 'backup/import help does not consume the initial viewport');
  assert.match(archive.querySelector('summary').textContent, /缓存备份与迁入/);
  assert.doesNotMatch(archive.textContent, /新应用|此旧版APK/);
  await React.act(async () => archive.querySelector('.route-cache-archive-action').click());
  assert.equal(globalThis.__legacyExportCalls, 1, 'the legacy private-cache export bridge remains connected');

  await React.act(async () => rows[0].querySelector('.route-cache-actions button').click());
  assert.equal(calls.pause, 1, 'live current task keeps its pause callback');
  offline.busy = false;
  active.phase = 'paused';
  active.phaseMessage = '已暂停，可继续';
  await React.act(async () => root.render(React.createElement(RouteCachePanel, {
    routes: [], sources: [source], offline, onOpenMap: openMap, onSources() {}, initialTab: 'packages',
  })));
  const pausedRow = mount.querySelector(`[data-trip-id="${active.id}"]`);
  const missingAfterPause = mount.querySelector(`[data-trip-id="${missingSource.id}"]`);
  assert.equal([...pausedRow.querySelectorAll('button')].find(button => button.textContent.trim() === '继续').disabled, false, 'paused package can resume');
  await React.act(async () => [...pausedRow.querySelectorAll('button')].find(button => button.textContent.trim() === '继续').click());
  assert.deepEqual(calls.resume, [active.id]);
  const verify = [...missingAfterPause.querySelectorAll('button')].find(button => button.textContent.trim() === '检查完整性');
  assert.equal(verify.disabled, false, 'a missing-source package still exposes integrity verification');
  await React.act(async () => verify.click());
  assert.deepEqual(calls.verify, [missingSource.id]);
  await React.act(async () => [...missingAfterPause.querySelectorAll('button')].find(button => button.textContent.trim() === '删除').click());
  const confirmDelete = [...missingAfterPause.querySelectorAll('button')].find(button => button.textContent.trim() === '确认删除');
  assert.ok(confirmDelete, 'removal still requires explicit confirmation');
  await React.act(async () => confirmDelete.click());
  assert.deepEqual(calls.remove, [missingSource.id]);
  assert.ok(mount.querySelector(`[data-trip-id="${missingSource.id}"]`), 'the component keeps the package row until the offline hook reports successful removal');
  await React.act(async () => pausedRow.querySelector('.route-cache-use-offline').click());
  assert.deepEqual(calls.open, [active.id], 'offline browsing uses the host source/display/bounds workflow instead of only changing flags');
  assert.equal(stored.get('shantu.offline-package.v1'), active.id);
  assert.equal(stored.get('test.offline'), 'true');
  assert.match(pausedRow.querySelector('.route-cache-use-offline').textContent, /恢复在线地图/);
  await React.act(async () => pausedRow.querySelector('.route-cache-package-open').click());
  assert.deepEqual(calls.open, [active.id, active.id]);

  const css = await (await import('node:fs/promises')).readFile(new URL('../modules/outdoor/routeCachePanel.css', import.meta.url), 'utf8');
  assert.match(css, /\.route-cache-package-list\s*\{[^}]*overflow-y:\s*auto/s, 'only the package list scrolls inside its pane');
  assert.match(css, /\.route-cache-archive-content\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s, 'archive copy and button remain in one horizontal row');

  offline.packages = [];
  offline.current = null;
  await React.act(async () => root.render(React.createElement(RouteCachePanel, {
    routes: [], sources: [source], offline, onOpenMap: trip => calls.open.push(trip.id), onSources() {}, initialTab: 'packages',
  })));
  const emptyList = mount.querySelector('.route-cache-package-list');
  assert.match(emptyList.querySelector('.route-cache-empty').textContent, /还没有路线缓存包/);
  const emptyArchive = emptyList.lastElementChild;
  assert.equal(emptyArchive.tagName.toLowerCase(), 'details');
  assert.equal(emptyArchive.hasAttribute('open'), false, 'the empty-state backup entry is available without occupying a fixed footer');
  assert.ok(emptyArchive.querySelector('summary'));
  await React.act(async () => emptyArchive.querySelector('.route-cache-archive-action').click());
  assert.equal(globalThis.__legacyExportCalls, 2, 'export remains callable when there are no package rows');
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
