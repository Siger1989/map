import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadBounds,
  downloadTiles,
} from '../modules/outdoor/downloadPlan.ts';
import {
  resourceCacheKey,
  tdtIdentity,
  validateTileResponse,
} from '../modules/outdoor/tiandituCache.ts';
import {
  tiandituLayers,
  TIANDITU_LAYERS,
} from '../modules/cartography/tianditu.ts';
import { DEFAULT_LAYERS, applyLayerPatch } from '../modules/map/types.ts';
import { downloadNative } from '../modules/outdoor/nativeOffline.ts';
import { cachedMapFetch, OFFLINE_MAP_KEY } from '../modules/outdoor/tileCache.ts';
import {
  mapDownloadPlan,
  prepareMapPackage,
  downloadTrip,
  canDownloadTrip,
  TIANDITU_OFFLINE_DISABLED,
  tripPackages,
  verifyTrip,
  removeTrip,
} from '../modules/outdoor/offline.ts';

const tileAt = ([lng, lat], z) =>
  `${z}/${Math.floor(((lng + 180) / 360) * 2 ** z)}/${Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)}`;
const ids = (tiles) => new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
const route = {
  kind: 'route',
  segments: [
    [
      [103, 30],
      [103.5, 30.5],
      [104, 31],
    ],
  ],
  bufferKm: 10,
};
test('route corridor covers full tail and 10 km sides, and widens monotonically', () => {
  const sets = [5, 10, 20].map((bufferKm) =>
    ids(downloadTiles({ ...route, bufferKm }, 12)),
  );
  for (let i = 0; i < 2; i++) {
    assert.ok(sets[i + 1].size > sets[i].size);
    for (const id of sets[i]) assert.ok(sets[i + 1].has(id));
  }
  for (let i = 0; i <= 20; i++) {
    const lng = 103 + i / 20,
      lat = 30 + i / 20;
    for (const side of [-1, 0, 1])
      assert.ok(sets[1].has(tileAt([lng, lat + (side * 10) / 111.32], 12)));
  }
  const tiles = downloadTiles(route, 12);
  assert.equal(tiles.length, ids(tiles).size);
});
test('disconnected sections do not fill their gap; long routes fit at overview detail', () => {
  const area = {
    kind: 'route',
    segments: [
      [
        [102, 30],
        [102.1, 30],
      ],
      [
        [105, 30],
        [105.1, 30],
      ],
    ],
    bufferKm: 10,
  };
  const set = ids(downloadTiles(area, 12));
  assert.ok(set.has(tileAt([105.1, 30], 12)));
  assert.ok(!set.has(tileAt([103.5, 30], 12)));
  assert.ok(
    downloadTiles(
      {
        ...area,
        segments: [
          [
            [102, 30],
            [105.5, 30],
          ],
        ],
      },
      12,
    ).length < 20000,
  );
  assert.throws(
    () => downloadTiles({ ...route, bufferKm: 20 }, 18),
    /范围|清晰度/,
  );
  assert.throws(
    () =>
      downloadBounds({
        ...route,
        segments: [
          [
            [179, 0],
            [-179, 0],
          ],
        ],
      }),
    /日期/,
  );
  assert.throws(() =>
    downloadTiles({ kind: 'region', bounds: [0, 0, 0, 1] }, 14),
  );
});
test('all seven layers are selectable with matching default labels and caps', () => {
  const seen = new Set();
  for (const base of ['vec', 'img', 'ter']) {
    const layers = tiandituLayers({
      ...DEFAULT_LAYERS,
      tiandituBase: base,
      tiandituBoundaries: true,
    });
    layers.forEach((l) => seen.add(l));
    assert.equal(layers[1], { vec: 'cva', img: 'cia', ter: 'cta' }[base]);
  }
  assert.equal(seen.size, 7);
  assert.equal(TIANDITU_LAYERS.ter.maxzoom, 14);
  assert.deepEqual(
    tiandituLayers({
      ...DEFAULT_LAYERS,
      tiandituBase: 'img',
      tiandituLabels: 'none',
    }),
    ['img'],
  );
  const settings = applyLayerPatch(DEFAULT_LAYERS, {
    tiandituBase: 'ter',
    satellite: false,
    offlineMaxZoom: 14,
  });
  assert.equal(settings.tiandituBase, 'ter');
  assert.equal(
    applyLayerPatch(settings, { tiandituBase: 'vec', offlineBasemap: true })
      .offlineBasemap,
    true,
  );
  assert.throws(
    () => mapDownloadPlan(route, settings, 'tianditu', 16),
    /天地图离线下载已暂停/,
  );
});
test('cache identity ignores host, token and query casing; invalid tile bodies never enter cache', async () => {
  const a =
    'https://t0.tianditu.gov.cn/img_w/wmts?REQUEST=GetTile&LAYER=img&TILEMATRIXSET=w&TILEMATRIX=8&TILEROW=105&TILECOL=201&tk=old';
  const b = a
    .replace('t0.', 't7.')
    .replace('tk=old', 'tk=new')
    .replace('TILECOL', 'tilecol');
  assert.equal(tdtIdentity(a), 'tdt:img:8:201:105');
  assert.equal(resourceCacheKey(a), resourceCacheKey(b));
  assert.ok(!resourceCacheKey(a).includes('tk='));
  assert.equal(tdtIdentity(a.replace('tianditu.gov.cn', 'example.com')), null);
  await assert.rejects(
    validateTileResponse(a, new Response('<error/>')),
    /有效瓦片/,
  );
  await assert.rejects(
    validateTileResponse(a, new Response('', { status: 429 })),
    /配额/,
  );
});
test('TianDiTu offline downloads are blocked before storage, network, or native calls', async () => {
  const saved = Object.fromEntries(
    ['window', 'caches', 'localStorage', 'fetch'].map((k) => [
      k,
      globalThis[k],
    ]),
  );
  let calls = 0;
  globalThis.window = { GuanyunNative: { offlineStart() { calls++; return 'ok'; } } };
  globalThis.localStorage = { getItem() { calls++; return null; }, setItem() { calls++; } };
  globalThis.caches = { open() { calls++; throw Error('unexpected cache access'); } };
  globalThis.fetch = () => { calls++; throw Error('unexpected network request'); };
  try {
    const settings = { ...DEFAULT_LAYERS, terrain: false };
    assert.equal(canDownloadTrip({ provider: 'openfreemap', urls: ['https://tiles.openfreemap.org/a'] }), true);
    assert.equal(canDownloadTrip({ provider: 'tianditu', urls: [] }), false);
    assert.equal(canDownloadTrip({ urls: ['tdt:vec:8:201:105'] }), false);
    assert.equal(canDownloadTrip({ urls: ['https://t4.tianditu.gov.cn/img_w/wmts?request=GetTile'] }), false);
    assert.equal(canDownloadTrip({ urls: ['https://tiles.maps.tianditu.gov.cn/anything'] }), false);
    assert.equal(canDownloadTrip({ urls: ['https://tiles.tianditu.com/anything'] }), false);
    assert.throws(() => mapDownloadPlan(route, settings, 'tianditu', 12), new RegExp(TIANDITU_OFFLINE_DISABLED));
    await assert.rejects(prepareMapPackage('x', { kind: 'region', bounds: [103, 30, 103.01, 30.01] }, settings, 'tianditu', 12, new AbortController().signal), new RegExp(TIANDITU_OFFLINE_DISABLED));
    const legacy = { id: 'old', name: 'legacy', urls: ['tdt:vec:8:201:105'], done: 0, bytes: 0, createdAt: 0, complete: false };
    await assert.rejects(downloadTrip(legacy, new AbortController().signal, () => {}), new RegExp(TIANDITU_OFFLINE_DISABLED));
    await assert.rejects(downloadNative({ ...legacy, native: true }, new AbortController().signal, () => {}), new RegExp(TIANDITU_OFFLINE_DISABLED));
    assert.equal(calls, 0);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
});

test('legacy TianDiTu packages remain readable, verifiable, and safely removable offline', async () => {
  const saved = Object.fromEntries(
    ['window', 'caches', 'localStorage', 'fetch'].map((k) => [k, globalThis[k]]),
  );
  const storage = new Map();
  const entries = new Map();
  const shared = 'tdt:vec:8:201:105';
  const firstOnly = 'tdt:vec:8:202:105';
  const secondOnly = 'tdt:vec:8:203:105';
  const png = new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const cache = {
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, value) => entries.set(key, value.clone()),
    delete: async (key) => entries.delete(key),
  };
  const first = { id: 'legacy-1', name: '旧包1', provider: 'tianditu', urls: [shared, firstOnly], done: 0, bytes: 0, createdAt: 1, complete: false };
  const second = { id: 'legacy-2', name: '旧包2', provider: 'tianditu', urls: [shared, secondOnly], done: 0, bytes: 0, createdAt: 2, complete: false };
  for (const url of [shared, firstOnly, secondOnly]) entries.set(resourceCacheKey(url), png.clone());
  storage.set('guanyun.trips.v1', JSON.stringify([first, second]));
  storage.set(OFFLINE_MAP_KEY, 'true');
  globalThis.window = { location: { origin: 'https://appassets.androidplatform.net' } };
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  globalThis.caches = { open: async () => cache };
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('network prohibited'); };
  try {
    const live = 'https://t3.tianditu.gov.cn/vec_w/wmts?request=GetTile&layer=vec&tilematrixset=w&tilematrix=8&tilecol=201&tilerow=105&tk=expired';
    assert.equal((await cachedMapFetch(live, new AbortController().signal)).status, 200);
    assert.equal(requests, 0);
    const checked = await verifyTrip(first);
    assert.equal(checked.done, 2);
    assert.equal(checked.complete, true);
    await removeTrip(checked);
    assert.equal(tripPackages().length, 1);
    assert.equal(await cache.match(resourceCacheKey(shared)) instanceof Response, true);
    assert.equal(await cache.match(resourceCacheKey(firstOnly)), undefined);
    assert.equal(await cache.match(resourceCacheKey(secondOnly)) instanceof Response, true);
    assert.equal(requests, 0);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
