import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(globalThis, {
  window,
  document: window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const storage = new Map(),
  entries = new Map([['https://fixture.local/one', new Response('cached')]]);
const old = {
  id: 'old',
  name: '上个版本下载的路线',
  provider: 'tianditu',
  layers: ['img', 'cia'],
  zoom: 14,
  bufferKm: 10,
  bounds: [103, 30, 104, 31],
  urls: ['https://fixture.local/one'],
  done: 0,
  bytes: 0,
  complete: false,
  createdAt: 1750000000000,
};
storage.set('guanyun.trips.v1', JSON.stringify([old]));
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
};
globalThis.caches = {
  open: async () => ({
    match: async (k) => entries.get(k)?.clone(),
    put: async (k, r) => entries.set(k, r.clone()),
    delete: async (k) => entries.delete(k),
  }),
};
globalThis.fetch = () => {
  throw Error('Network prohibited');
};
await build({
  entryPoints: [
    'modules/collections/OfflineMapFolder.tsx',
    'modules/outdoor/useOffline.ts',
  ],
  outdir: '.openai/cache-folder-check',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
});
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { OfflineMapFolder } =
  await import('../.openai/cache-folder-check/collections/OfflineMapFolder.js');
const { useOffline } =
  await import('../.openai/cache-folder-check/outdoor/useOffline.js');
let offline,
  opened,
  downloaded = 0;
function Probe({ query = '' }) {
  offline = useOffline();
  return React.createElement(OfflineMapFolder, {
    offline,
    query,
    onOpen: (p) => {
      opened = p;
    },
    onDownload: () => downloaded++,
  });
}
const root = createRoot(document.getElementById('root'));
await act(() => root.render(React.createElement(Probe)));
const button = (t) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === t);
const click = async (b) => {
  assert.ok(b);
  await act(() => b.click());
};
assert.ok(document.body.textContent.includes(old.name));
assert.equal(offline.packages.length, 1);
await click(document.querySelector('[aria-label^="打开离线地图"]'));
assert.equal(opened.id, 'old');
await click(document.querySelector('[aria-label^="管理离线地图"]'));
await click(button('检查'));
await act(async () => {
  await new Promise((r) => setTimeout(r, 20));
});
assert.equal(offline.packages[0].complete, true);
assert.equal(JSON.parse(storage.get('guanyun.trips.v1'))[0].complete, true);
await click(button('缓存当前地图'));
assert.equal(downloaded, 1);
await click(button('移除'));
assert.equal(offline.packages.length, 1);
await click(button('取消'));
assert.equal(offline.packages.length, 1);
await click(button('移除'));
await click(button('移除缓存'));
await act(async () => {
  await new Promise((r) => setTimeout(r, 20));
});
assert.equal(offline.packages.length, 0);
assert.equal(entries.size, 0);
assert.ok(document.body.textContent.includes('尚未缓存地图'));
await act(() => root.render(React.createElement(Probe, { query: '不存在' })));
assert.equal(document.querySelector('.offline-map-folder'), null);
await act(() => root.unmount());
console.log(
  'PASS: existing package index appears in favorites; open, verification, add entry, remove confirmation/cancel, deletion and search.',
);
