import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { writeFavoriteSourceKeys } from '../modules/mapSources/favorites.ts';

async function loadComponents() {
  await build({
    stdin: { contents: `export { FavoriteSourceSwitcher } from './modules/mapSources/FavoriteSourceSwitcher'; export { FreeMapLibrary } from './modules/mapSources/FreeMapLibrary'; export { TiandituSources } from './modules/cartography/TiandituSources';`, resolveDir: process.cwd(), loader: 'tsx' },
    outfile: '.openai/favorite-source-switcher-test/components.js', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  return import('../.openai/favorite-source-switcher-test/components.js');
}

test('quick switch filters the shared favorites, selects without an implicit management step, and closes accessibly', async t => {
  const { window } = parseHTML('<html><body></body></html>');
  const storage = new Map([['shantu-map-source-favorites-v1', JSON.stringify(['terrain', 'saved:map-1', 'public:builtin-osm'])]]);
  const old = Object.fromEntries(['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window, document: window.document, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  }, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { FavoriteSourceSwitcher } = await loadComponents();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const selected = []; const managed = []; const openChanges = [];
  const choices = [
    { id: 'terrain', name: '地形地图', group: '内置' },
    { id: 'sentinel', name: 'Sentinel-2 2025', group: '内置' },
    { id: 'saved:map-1', name: '我的在线图源', group: '我的图源' },
    { id: 'public:builtin-osm', name: 'OSM 标准地图', group: '公共库' },
  ];
  const render = async () => act(async () => root.render(React.createElement(FavoriteSourceSwitcher, {
    choices, currentId: 'terrain', onSelect: id => selected.push(id), onManage: () => managed.push(true), onOpenChange: open => openChanges.push(open),
  })));
  const click = async selector => act(async () => host.querySelector(selector).click());
  t.after(async () => {
    await act(async () => root.unmount());
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  });
  await render();
  await click('[aria-label="收藏图源快捷切换"]');
  const popup = host.querySelector('[role="dialog"][aria-label="收藏图源快捷切换"]');
  assert.ok(popup);
  assert.deepEqual([...popup.querySelectorAll('[data-favorite-source]')].map(row => row.dataset.favoriteSource), ['terrain', 'saved:map-1', 'public:builtin-osm']);
  await click('[data-favorite-source="public:builtin-osm"]');
  assert.deepEqual(selected, ['public:builtin-osm']);
  assert.deepEqual(managed, []);
  assert.equal(host.querySelector('[role="dialog"]'), null);
  assert.deepEqual(openChanges, [true, false]);

  await click('[aria-label="收藏图源快捷切换"]');
  await act(async () => { writeFavoriteSourceKeys([]); });
  assert.equal(host.querySelector('.favorite-source-empty')?.textContent, '还没有收藏图源');
  await click('.favorite-source-manage');
  assert.deepEqual(managed, [true]);
});

test('public and built-in source cards share canonical favorite keys without selecting the source', async t => {
  const { window } = parseHTML('<html><body></body></html>');
  const storage = new Map();
  const old = Object.fromEntries(['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window, document: window.document, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  }, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { FreeMapLibrary, TiandituSources } = await loadComponents();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const selected = []; const settingsChanged = [];
  const settings = { satellite: false, satelliteProvider: 'sentinel', imageryMode: 'detail', offlineBasemap: false, labels: true, tiandituBase: 'vec', tiandituBoundaries: true };
  const renderFree = async () => act(async () => root.render(React.createElement(FreeMapLibrary, { selected: '', onSelect: id => selected.push(id), onFocus() {} })));
  const renderBuiltin = async () => act(async () => root.render(React.createElement(TiandituSources, { settings, onChange: patch => settingsChanged.push(patch) })));
  const click = async selector => act(async () => host.querySelector(selector).click());
  t.after(async () => {
    await act(async () => root.unmount());
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  });

  await renderFree();
  assert.ok(host.querySelector('[aria-label="加入常用：OSM 标准地图"]'));
  await click('[aria-label="加入常用：OSM 标准地图"]');
  assert.deepEqual(JSON.parse(storage.get('shantu-map-source-favorites-v1')), ['public:builtin-osm']);
  assert.deepEqual(selected, [], 'star clicks do not activate the neighboring source card');
  await click('.free-map-card > button:first-child');
  assert.deepEqual(selected, ['builtin-osm']);

  await renderBuiltin();
  await click('[aria-label="加入常用：Sentinel-2 2025"]');
  await click('[aria-label="加入常用：矢量底图"]');
  assert.deepEqual(JSON.parse(storage.get('shantu-map-source-favorites-v1')), ['public:builtin-osm', 'sentinel', 'tdt-vec']);
  assert.deepEqual(settingsChanged, [], 'favoriting does not change map source settings');
});
