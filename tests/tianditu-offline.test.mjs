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
import {
  mapDownloadPlan,
  prepareMapPackage,
  downloadTrip,
  tripPackages,
  removeTrip,
  verifyTrip,
} from '../modules/outdoor/offline.ts';
import {
  cachedMapFetch,
  OFFLINE_MAP_KEY,
} from '../modules/outdoor/tileCache.ts';

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
    /清晰度/,
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
test('TianDiTu package resumes, reads with network prohibited, shares cache and restores its settings', async () => {
  const saved = Object.fromEntries(
    ['window', 'caches', 'localStorage', 'fetch'].map((k) => [
      k,
      globalThis[k],
    ]),
  );
  const oldKey = process.env.NEXT_PUBLIC_TIANDITU_KEY;
  process.env.NEXT_PUBLIC_TIANDITU_KEY = 'offlineTestKey123456';
  const storage = new Map(),
    entries = new Map(),
    requests = new Map();
  globalThis.window = {
    location: { origin: 'https://appassets.androidplatform.net' },
  };
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
  };
  globalThis.caches = {
    open: async () => ({
      match: async (k) => entries.get(k)?.clone(),
      put: async (k, v) => entries.set(k, v.clone()),
      delete: async (k) => entries.delete(k),
    }),
  };
  const controller = new AbortController();
  let interrupt = true;
  globalThis.fetch = async (url) => {
    const key = resourceCacheKey(url);
    requests.set(key, (requests.get(key) ?? 0) + 1);
    if (interrupt) {
      interrupt = false;
      controller.abort();
    }
    return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  };
  try {
    const settings = {
      ...DEFAULT_LAYERS,
      terrain: false,
      tiandituBase: 'ter',
      tiandituLabels: 'cta',
      tiandituBoundaries: true,
    };
    const trip = await prepareMapPackage(
      '测试沿线',
      { kind: 'region', bounds: [103.5, 30.7, 103.501, 30.701] },
      settings,
      'tianditu',
      12,
      new AbortController().signal,
    );
    assert.equal(trip.display.tiandituBase, 'ter');
    assert.equal(trip.display.offlineMaxZoom, 12);
    assert.deepEqual(trip.layers, ['ter', 'cta', 'ibo']);
    assert.ok(
      trip.urls.every(
        (u) =>
          u.startsWith('tdt:') &&
          !u.includes(process.env.NEXT_PUBLIC_TIANDITU_KEY),
      ),
    );
    // Small representative subset exercises the actual downloader without a long test delay.
    trip.urls = trip.urls.slice(0, 5);
    await assert.rejects(
      downloadTrip(trip, controller.signal, () => {}),
      /暂停/,
    );
    assert.ok(tripPackages()[0].done > 0);
    assert.equal(tripPackages()[0].complete, false);
    await downloadTrip(trip, new AbortController().signal, () => {});
    assert.equal(tripPackages()[0].complete, true);
    assert.ok([...requests.values()].every((n) => n === 1));
    assert.equal((await verifyTrip(trip)).complete, true);
    globalThis.fetch = () => {
      throw Error('Network prohibited');
    };
    storage.set(OFFLINE_MAP_KEY, 'true');
    const [_, layer, z, x, y] = trip.urls[0].split(':');
    const live = `https://t3.tianditu.gov.cn/${layer}_w/wmts?request=GetTile&layer=${layer}&tilematrixset=w&tilematrix=${z}&tilecol=${x}&tilerow=${y}&tk=changed`;
    assert.equal(
      (await cachedMapFetch(live, new AbortController().signal)).status,
      200,
    );
    await assert.rejects(
      cachedMapFetch(
        live.replace('tilecol=1&', 'tilecol=999&'),
        new AbortController().signal,
      ),
    );
    const second = { ...trip, id: 'other' };
    storage.set('guanyun.trips.v1', JSON.stringify([trip, second]));
    await removeTrip(trip);
    assert.equal(entries.size, 5);
    await removeTrip(second);
    assert.equal(entries.size, 0);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_TIANDITU_KEY;
    else process.env.NEXT_PUBLIC_TIANDITU_KEY = oldKey;
  }
});
