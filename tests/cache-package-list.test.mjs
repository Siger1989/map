import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadCachePackageList() {
  await build({
    entryPoints: ['modules/collections/CachePackageList.tsx'],
    outfile: '.openai/cache-package-list-test/CachePackageList.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
  });
  return (await import('../.openai/cache-package-list-test/CachePackageList.js')).CachePackageList;
}

function trip(id, name, phase, sourceName, done, complete = false) {
  return {
    id, name, phase, sourceName, provider: 'imported', done, complete,
    urls: ['one', 'two', 'three', 'four'], bytes: done * 1024, createdAt: 1,
    bounds: [0, 0, 1, 1],
  };
}

test('renders real cache packages with progress, filters name/source, and opens the selected task id', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const CachePackageList = await loadCachePackageList();
  const host = document.getElementById('root');
  const root = createRoot(host);
  t.after(async () => act(async () => root.unmount()));
  const opened = [];
  const packages = [
    trip('complete-id', '已完成路线', 'complete', '公开地形图', 4, true),
    trip('active-id', '青城山步道', 'running', '注册影像源', 2),
    trip('paused-id', '龙门山线路', 'paused', '公开地形图', 1),
    {
      ...trip('legacy-id', '旧版缓存路线', undefined, '旧版导入图源', 3178),
      urls: Array.from({ length: 4768 }, (_, index) => `tile-${index}`),
    },
  ];
  const props = { packages, query: '', totalCount: 3, onOpen: id => opened.push(id), onManage() {} };
  await act(async () => root.render(React.createElement(CachePackageList, props)));

  const rows = () => [...host.querySelectorAll('.workbench-cache-package')];
  assert.deepEqual(rows().map(row => row.querySelector('strong').textContent), ['青城山步道', '龙门山线路', '旧版缓存路线', '已完成路线']);
  assert.equal(host.querySelectorAll('.offline-progress progress').length, 4, 'each package uses its actual OfflineProgress component');
  assert.match(rows()[0].textContent, /正在缓存/);
  assert.match(rows()[1].textContent, /已暂停/);
  assert.match(rows()[2].textContent, /未完成，可继续/);
  assert.match(rows()[2].textContent, /3178\/4768 项/);
  await act(async () => rows()[0].querySelector('button[aria-label="查看缓存任务：青城山步道"]').dispatchEvent(new window.Event('click', { bubbles: true })));
  assert.deepEqual(opened, ['active-id']);

  await act(async () => root.render(React.createElement(CachePackageList, { ...props, query: '注册影像源' })));
  assert.deepEqual(rows().map(row => row.querySelector('strong').textContent), ['青城山步道']);
  await act(async () => root.render(React.createElement(CachePackageList, { ...props, query: '不存在' })));
  assert.equal(host.querySelector('.workbench-cache-empty')?.textContent, '没有匹配的缓存路线或图源');
});
