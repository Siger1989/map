import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { writeFavoriteSourceKeys } from '../modules/mapSources/favorites.ts';

async function loadSavedMapSources() {
  await build({
    entryPoints: ['modules/mapSources/SavedMapSources.tsx'],
    outdir: '.openai/saved-map-sources-favorites-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  return (await import('../.openai/saved-map-sources-favorites-test/SavedMapSources.js')).SavedMapSources;
}

test('my map sources group favorites once, persist only IDs, and preserve filtering and removal confirmation', async t => {
  const { window } = parseHTML('<html><body></body></html>');
  const values = new Map();
  const key = 'shantu-map-source-favorites-v1';
  values.set(key, JSON.stringify(['native:terrain']));
  let throwOnWrite = false;
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (throwOnWrite) throw new Error('storage unavailable'); values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, { window, document: window.document, localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const SavedMapSources = await loadSavedMapSources();
  const mount = document.createElement('div');
  document.body.append(mount);
  let root = createRoot(mount);
  const selected = [];
  const removed = [];
  const maps = [
    { id: 'online-1', name: '在线甲', kind: 'online', format: 'XYZ', attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 1 },
    { id: 'online-2', name: '在线乙', kind: 'online', format: 'XYZ', attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 1 },
    { id: 'offline-1', name: '离线影像', kind: 'mbtiles', format: 'MBTiles', attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 1 },
  ];
  const render = async (ready = true) => act(async () => root.render(React.createElement(SavedMapSources, {
    maps, selected: 'online-1', ready, busy: false,
    onSelect: map => selected.push(map.id),
    onRemove: id => removed.push(id),
    onAdd() {},
  })));
  const click = async selector => act(async () => mount.querySelector(selector).click());
  const rowInGroup = (group, name) => [...mount.querySelectorAll(`.saved-map-sources__group[data-group="${group}"] .saved-map-sources__item`)]
    .find(row => row.querySelector('.saved-map-sources__name')?.textContent === name);
  const chooseFilter = async value => act(async () => {
    const select = mount.querySelector('[aria-label="筛选图源"]');
    Object.defineProperty(select, 'value', { configurable: true, value });
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  const chooseSearch = async value => act(async () => {
    const input = mount.querySelector('[aria-label="搜索图源名称"]');
    const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'));
    input[propsKey].onChange({ target: { value }, currentTarget: { value } });
  });
  t.after(async () => {
    await act(async () => root.unmount());
    for (const key of ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (old[key] === undefined) delete globalThis[key];
      else globalThis[key] = old[key];
    }
  });

  await render();
  assert.equal(mount.querySelector('[data-group="common"] .saved-map-sources__favorite-hint')?.textContent, '点☆加入常用');
  assert.ok(rowInGroup('online', '在线甲'));
  assert.ok(rowInGroup('offline', '离线影像'));

  await click('[aria-label="加入常用：在线甲"]');
  assert.ok(rowInGroup('common', '在线甲'), 'favoriting moves the source into 常用');
  assert.equal(rowInGroup('online', '在线甲'), undefined, 'a favorite is not duplicated in 在线');
  assert.deepEqual(JSON.parse(values.get(key)), ['native:terrain', 'saved:online-1'], 'persistent preference stores source keys in the shared array');

  await act(async () => root.unmount());
  root = createRoot(mount);
  await render();
  assert.ok(rowInGroup('common', '在线甲'), 'favorite survives reopening the component');

  await act(async () => { writeFavoriteSourceKeys(['native:terrain', 'saved:offline-1']); });
  assert.ok(rowInGroup('common', '离线影像'), 'other selectors can update the shared preference while this list is mounted');
  assert.equal(rowInGroup('offline', '离线影像'), undefined);
  await act(async () => { writeFavoriteSourceKeys(['native:terrain', 'saved:online-1']); });

  throwOnWrite = true;
  await click('[aria-label="加入常用：在线乙"]');
  assert.ok(mount.querySelector('[role="status"]')?.textContent.includes('常用设置未能保存'), 'blocked persistence is reported');
  assert.ok(rowInGroup('online', '在线乙'), 'a failed write does not make the star appear saved');
  assert.deepEqual(JSON.parse(values.get(key)), ['native:terrain', 'saved:online-1']);
  throwOnWrite = false;

  await chooseFilter('favorites');
  assert.equal(mount.querySelectorAll('.saved-map-sources__item').length, 1, '常用 filter contains favorites only');
  await click('[aria-label="移出常用：在线甲"]');
  assert.deepEqual(JSON.parse(values.get(key)), ['native:terrain']);
  assert.equal(mount.querySelector('[data-group="common"] .saved-map-sources__favorite-hint')?.textContent, '点☆加入常用');

  await chooseFilter('all');
  assert.ok(rowInGroup('online', '在线甲'), 'removing a favorite returns it to its kind group');
  await chooseSearch('影像');
  assert.equal(mount.querySelectorAll('.saved-map-sources__item').length, 1, 'search still narrows grouped sources');
  assert.ok(rowInGroup('offline', '离线影像'));
  await click('[aria-label="移除离线影像"]');
  assert.equal(removed.length, 0, 'removal still waits for explicit confirmation');
  await click('[aria-label="确认移除离线影像"] button:first-of-type');
  assert.deepEqual(removed, ['offline-1']);

  await chooseSearch('');
  await chooseFilter('online');
  await click('.saved-map-sources__choice');
  assert.deepEqual(selected, ['online-1'], 'selection remains available inside grouped results');
});
