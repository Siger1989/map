import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { downloadTiles } from '../modules/outdoor/downloadPlan.ts';
import { renderOvmapTileAddress } from '../modules/mapSources/ovmapTemplates.ts';
const built = await build({ entryPoints: ['modules/outdoor/importedRouteDownload.ts', 'modules/outdoor/asyncImportedRoutePlan.ts', 'modules/mapSources/coordinates.ts', 'modules/mapSources/ovmapTiles.ts'], bundle: true, platform: 'node', format: 'esm', write: false, outdir: '.openai/imported-route-tests' });
const modules = await Promise.all(built.outputFiles.map((file) => import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`)));
const { planImportedRouteDownload, MAX_IMPORTED_DOWNLOAD_BYTES, MAX_IMPORTED_DOWNLOAD_RESOURCES } = modules.find((module) => module.planImportedRouteDownload);
const { warpPlan } = modules.find((module) => module.warpPlan);
const { planImportedRouteDownloadAsync, estimateImportedRouteDownloadAsync } = modules.find((module) => module.planImportedRouteDownloadAsync);
const { renderOvmapLayerTile } = modules.find((module) => module.renderOvmapLayerTile);

const source = (overrides = {}) => ({
  id: 'imported-source', name: 'Imported raster', kind: 'online', format: 'XYZ', attribution: '',
  minzoom: 12, maxzoom: 19, tileSize: 256, tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'],
  scheme: 'xyz', bytes: 128, ...overrides,
});
const route = (overrides = {}) => ({
  kind: 'route', segments: [[[104, 30], [104.01, 30.01]]], bufferKm: 1, ...overrides,
});
const pathCoords = (url) => {
  const match = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
  return match && match.slice(1).map(Number);
};
const rawUrl = (templates, z, x, y) => templates[0].replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
const tileLon = (x, z) => x / 2 ** z * 360 - 180;
const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

test('batch routes equal the union of individual corridors, without connecting routes or duplicate requests', () => {
  const map = source({ minzoom: 12, maxzoom: 14 });
  const first = route({ bufferKm: 4 });
  const second = route({ bufferKm: 4, segments: [[[105, 31], [105.02, 31.02]]] });
  const expected = new Set([...planImportedRouteDownload(first, map, 14).urls, ...planImportedRouteDownload(second, map, 14).urls]);
  const batch = planImportedRouteDownload(route({ bufferKm: 4, segments: [...first.segments, ...second.segments, ...first.segments] }), map, 14);
  assert.deepEqual(new Set(batch.urls), expected);
  assert.equal(batch.count, expected.size);
});

test('imported route plan offers declared odd max zoom and counts unique requests without fetching', () => {
  const area = route({ bufferKm: 4 });
  const at18 = planImportedRouteDownload(area, source(), 18);
  const at19 = planImportedRouteDownload(area, source(), 19);
  assert.ok(at19.urls.some((url) => pathCoords(url)?.[0] === 19));
  assert.ok(at19.count > at18.count);
  assert.equal(at19.count, new Set(at19.urls).size);
  assert.ok(at19.estimatedBytes > 0 && at19.estimatedBytes <= 8 * 1024 ** 3);
  assert.throws(() => planImportedRouteDownload(route(), source(), 20), /支持的最高级别/);
});

test('ratio templates include both standard and high-density tile URLs', () => {
  const map = source({ minzoom: 12, maxzoom: 12, tiles: ['https://tiles.example.test/{z}/{x}/{y}{ratio}.png'] });
  const plan = planImportedRouteDownload(route(), map, 12);
  assert.ok(plan.urls.some((url) => /\/12\/\d+\/\d+\.png$/.test(url)));
  assert.ok(plan.urls.some((url) => /\/12\/\d+\/\d+@2x\.png$/.test(url)));
  const oneSize = Math.ceil(256 * 256 * 0.4);
  assert.equal(plan.estimatedBytes, plan.count / 2 * oneSize * 5);
});

test('4 km per-side corridor is accepted and included in the route bounds', () => {
  const area = route({ bufferKm: 4 });
  const bounds = planImportedRouteDownload(area, source({ minzoom: 12, maxzoom: 12 }), 12).bounds;
  assert.ok(bounds[0] < 104 && bounds[2] > 104.01);
  assert.ok(bounds[1] < 30 && bounds[3] > 30.01);
  assert.throws(() => planImportedRouteDownload(route({ bufferKm: 3 }), source(), 14), /沿线范围/);
});

test('disconnected route segments remain separate corridor clusters', () => {
  const area = route({ segments: [[[0, 0], [0.01, 0]], [[10, 0], [10.01, 0]]] });
  const plan = planImportedRouteDownload(area, source(), 12);
  const xs = plan.urls.map(pathCoords).filter((parts) => parts?.[0] === 12).map((parts) => parts[1]);
  const left = xs.filter((x) => x < 2050), right = xs.filter((x) => x > 2100);
  assert.ok(left.length && right.length);
  assert.ok(xs.every((x) => x < 2050 || x > 2100));
});

test('polygon area planning includes interior and intersecting boundary tiles, not only its perimeter or bounds rectangle', () => {
  const z = 12, west = 2048, east = 2052, north = 2048, south = 2052;
  const area = { kind: 'polygon', boundary: [
    [tileLon(west, z), tileLat(north, z)], [tileLon(east, z), tileLat(north, z)],
    [tileLon(east, z), tileLat(south, z)], [tileLon(west, z), tileLat(south, z)],
  ] };
  const outputTiles = downloadTiles(area, z, MAX_IMPORTED_DOWNLOAD_RESOURCES, false, z);
  const keys = new Set(outputTiles.map(tile => `${tile.x}/${tile.y}`));
  assert.ok(keys.has('2050/2050'), 'a central interior tile is included');
  assert.ok(keys.has('2048/2048') && keys.has('2051/2051'), 'tiles intersecting the polygon boundary are included');
  assert.ok(outputTiles.length >= 16, 'the polygon interior is filled, not just its perimeter');
  const plan = planImportedRouteDownload(area, source({ minzoom: z, maxzoom: z }), z);
  assert.equal(plan.bounds[0], tileLon(west, z));
  assert.equal(plan.bounds[2], tileLon(east, z));
  assert.ok(plan.urls.some(url => pathCoords(url)?.slice(1).join('/') === '2050/2050'));
});

test('polygon edge supercover retains a tile touched only at an exact corner crossing', () => {
  const z = 12, baseX = 2048, baseY = 2048;
  const point = (x, y) => [tileLon(baseX + x, z), tileLat(baseY + y, z)];
  // This narrow polygon's diagonal edge crosses (1,1) between the old half-tile
  // samples. Tile (1,0) is touched at that corner but contains no scanline fill.
  const area = { kind: 'polygon', boundary: [point(0.1, 0.1), point(2.9, 2.9), point(2.85, 2.95), point(0.05, 0.15)] };
  const oldSampled = new Set();
  const [start, end] = [[0.1, 0.1], [2.9, 2.9]];
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) * 2));
  for (let k = 0; k <= steps; k++) oldSampled.add(`${baseX + Math.floor(start[0] + (end[0] - start[0]) * k / steps)}/${baseY + Math.floor(start[1] + (end[1] - start[1]) * k / steps)}`);
  assert.equal(oldSampled.has(`${baseX + 1}/${baseY}`), false, 'the previous half-tile samples miss the corner-only tile');
  const keys = new Set(downloadTiles(area, z, MAX_IMPORTED_DOWNLOAD_RESOURCES, false, z).map(tile => `${tile.x}/${tile.y}`));
  assert.ok(keys.has(`${baseX + 1}/${baseY}`), 'corner-touch tile is included by exact supercover');
});

test('polygon area validation rejects degenerate or oversized boundaries', () => {
  assert.throws(() => downloadTiles({ kind: 'polygon', boundary: [[0, 0], [1, 1]] }, 12), /至少包含 3 个有效节点/);
  assert.throws(() => downloadTiles({ kind: 'polygon', boundary: Array.from({ length: 2001 }, (_, i) => [i / 2000, i % 2]) }, 12), /2000 个节点/);
  assert.throws(() => downloadTiles({ kind: 'polygon', boundary: [[0, 0], [1, 0], [NaN, 1]] }, 12), /无效坐标/);
});

test('OVMAP layer stack enumerates only active layer URLs and de-duplicates them', () => {
  const map = source({
    format: 'OVMAP',
    ovmap: { layers: [
      { tiles: ['https://base.example.test/{$z}/{$x}/{$y}.png'], tileSize: 256, minzoom: 12, maxzoom: 19 },
      { tiles: ['https://labels.example.test/{$z}/{$x}/{$y}.png'], tileSize: 256, minzoom: 19, maxzoom: 19 },
    ] },
  });
  const plan = planImportedRouteDownload(route(), map, 19);
  assert.ok(plan.urls.some((url) => url.includes('base.example.test')));
  assert.ok(plan.urls.some((url) => url.includes('labels.example.test/19/')));
  assert.ok(!plan.urls.some((url) => url.includes('labels.example.test/18/')));
  assert.equal(plan.count, new Set(plan.urls).size);
});

test('Tencent map rendering and imported-route download use the same reversed-row address', async () => {
  const z = 12, x = 3231, y = 1681;
  const template = 'https://p0.map.gtimg.com/sateTiles/{$z}/{$x/16}/{$y/16}/{$x}_{$y}.jpg';
  const expectedUrl = renderOvmapTileAddress(template, z, x, y);
  assert.equal(expectedUrl, 'https://p0.map.gtimg.com/sateTiles/12/201/150/3231_2414.jpg');
  const map = source({
    minzoom: z, maxzoom: z, scheme: 'xyz', format: 'OVMAP', tiles: [template],
    ovmap: { layers: [{ tiles: [template], tileSize: 256, minzoom: z, maxzoom: z }] },
  });
  const planned = planImportedRouteDownload(route({
    segments: [[[104.0185, 30.6379], [104.019, 30.6382]]], bufferKm: 4,
  }), map, z);
  assert.ok(planned.urls.includes(expectedUrl), 'the offline plan contains the same canonical address');

  const previousFetch = globalThis.fetch;
  let requestedTileUrl;
  globalThis.fetch = async (request) => {
    const endpoint = new URL(String(request), 'http://localhost');
    requestedTileUrl = endpoint.searchParams.get('url') ?? endpoint.href;
    return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
  try {
    const bytes = await renderOvmapLayerTile(map.ovmap.layers[0], z, x, y, new AbortController().signal);
    assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  } finally { globalThis.fetch = previousFetch; }
  assert.equal(requestedTileUrl, expectedUrl, 'the map request resolves through the same address helper');
  assert.ok(planned.urls.includes(requestedTileUrl));
});

test('GCJ02 route plan includes every neighboring raw tile required to warp the displayed WGS84 tiles', () => {
  const area = route({ segments: [[[104.001, 30.001], [104.002, 30.002]]] });
  const map = source({ minzoom: 14, maxzoom: 14, datum: 'gcj02' });
  const plan = planImportedRouteDownload(area, map, 14);
  const planned = new Set(plan.urls);
  const outputs = downloadTiles(area, 14, 20_000, false, 14);
  const required = new Set();
  for (const output of outputs) {
    const warp = warpPlan(output.z, output.x, output.y, map.tileSize, 'gcj02');
    for (let row = 0; row < warp.height; row++) for (let col = 0; col < warp.width; col++) {
      const tile = { z: output.z, x: warp.left + col, y: warp.top + row };
      const n = 2 ** tile.z;
      required.add(rawUrl(map.tiles, tile.z, ((tile.x % n) + n) % n, tile.y));
    }
  }
  for (const url of required) assert.ok(planned.has(url), 'warped map tile input is in the package plan');
});

test('route planner rejects unsupported sources, templates, providers and excessive request plans', () => {
  assert.throws(() => planImportedRouteDownload({ kind: 'region', bounds: [0, 0, 1, 1] }, source(), 14), /有效路段/);
  assert.throws(() => planImportedRouteDownload(route(), source({ kind: 'mbtiles' }), 14), /在线图源/);
  assert.throws(() => planImportedRouteDownload(route(), source({ tiles: ['https://example.test/{s}/{z}/{x}/{y}.png'] }), 14), /模板变量/);
  assert.throws(() => planImportedRouteDownload(route(), source({ tiles: ['https://t0.tianditu.gov.cn/tiles/{z}/{x}/{y}.png'] }), 14), /天地图离线下载已暂停/);
  assert.throws(() => planImportedRouteDownload(route(), source({ tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'] }), 14), /不支持批量下载/);
  const long = route({ bufferKm: 0.5, segments: [[[0, 0], [0.2, 0]]] });
  assert.throws(() => planImportedRouteDownload(long, source({ minzoom: 24, maxzoom: 24 }), 24), /两侧各 0.5 km 范围保持不变/);
});

test('current source and persisted URLs are rechecked against provider restrictions before resume', async () => {
  const { validateImportedDownloadSource, validateImportedDownloadUrls, assertImportedDownloadBudget } = modules.find((module) => module.validateImportedDownloadSource);
  assert.throws(() => validateImportedDownloadSource(source({ tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'] })), /不支持批量下载/);
  assert.throws(() => validateImportedDownloadUrls(['https://t0.tianditu.gov.cn/{z}/{x}/{y}.png']), /天地图离线下载已暂停/);
  assert.throws(() => validateImportedDownloadUrls(['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png']), /不支持批量下载/);
  assert.throws(() => assertImportedDownloadBudget(MAX_IMPORTED_DOWNLOAD_BYTES + 1), /8 GiB 上限/);
  assert.doesNotThrow(() => assertImportedDownloadBudget(MAX_IMPORTED_DOWNLOAD_BYTES));
  assert.equal(MAX_IMPORTED_DOWNLOAD_RESOURCES, 250_000);
  assert.equal(MAX_IMPORTED_DOWNLOAD_BYTES, 8 * 1024 ** 3);
});

test('async adapter falls back for Node, returns compact estimates, and discards aborted work', async () => {
  const area = route({ bufferKm: 4 });
  const map = source({ minzoom: 12, maxzoom: 14 });
  const plan = await planImportedRouteDownloadAsync(area, map, 14);
  const estimate = await estimateImportedRouteDownloadAsync(area, map, 14);
  assert.equal(estimate.count, plan.count);
  assert.equal(estimate.estimatedBytes, plan.estimatedBytes);
  const polygonArea = { kind: 'polygon', boundary: [[104, 30], [104.02, 30], [104.02, 30.02], [104, 30.02]] };
  const areaPlan = await planImportedRouteDownloadAsync(polygonArea, map, 14);
  const areaEstimate = await estimateImportedRouteDownloadAsync(polygonArea, map, 14);
  assert.ok(areaPlan.urls.length > 0);
  assert.equal(areaEstimate.count, areaPlan.count);
  const controller = new AbortController();
  const pending = estimateImportedRouteDownloadAsync(area, map, 14, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('worker estimate timeout settles the UI instead of leaving an endless pending state', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const previousUrl = Object.getOwnPropertyDescriptor(globalThis, 'URL');
  let terminated = 0;
  globalThis.Worker = class {
    postMessage() {}
    terminate() { terminated++; }
  };
  globalThis.URL = class { constructor(path) { this.href = String(path); } };
  try {
    await assert.rejects(
      estimateImportedRouteDownloadAsync(route(), source(), 14, { timeoutMs: 5 }),
      /路线缓存量估算超时/,
    );
    assert.equal(terminated, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else delete globalThis.Worker;
    if (previousUrl) Object.defineProperty(globalThis, 'URL', previousUrl);
    else delete globalThis.URL;
  }
});
