import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { downloadTiles } from '../modules/outdoor/downloadPlan.ts';
const built = await build({ entryPoints: ['modules/outdoor/importedRouteDownload.ts', 'modules/mapSources/coordinates.ts'], bundle: true, platform: 'node', format: 'esm', write: false, outdir: '.openai/imported-route-tests' });
const modules = await Promise.all(built.outputFiles.map((file) => import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`)));
const { planImportedRouteDownload } = modules.find((module) => module.planImportedRouteDownload);
const { warpPlan } = modules.find((module) => module.warpPlan);

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

test('imported route plan offers declared odd max zoom and counts unique requests without fetching', () => {
  const at18 = planImportedRouteDownload(route(), source(), 18);
  const at19 = planImportedRouteDownload(route(), source(), 19);
  assert.ok(at19.urls.some((url) => pathCoords(url)?.[0] === 19));
  assert.ok(at19.count > at18.count);
  assert.equal(at19.count, new Set(at19.urls).size);
  assert.ok(at19.estimatedBytes > 0 && at19.estimatedBytes <= 1024 ** 3);
  assert.throws(() => planImportedRouteDownload(route(), source(), 20), /支持的最高级别/);
});

test('ratio templates include both standard and high-density tile URLs', () => {
  const map = source({ minzoom: 12, maxzoom: 12, tiles: ['https://tiles.example.test/{z}/{x}/{y}{ratio}.png'] });
  const plan = planImportedRouteDownload(route(), map, 12);
  assert.ok(plan.urls.some((url) => /\/12\/\d+\/\d+\.png$/.test(url)));
  assert.ok(plan.urls.some((url) => /\/12\/\d+\/\d+@2x\.png$/.test(url)));
});

test('disconnected route segments remain separate corridor clusters', () => {
  const area = route({ segments: [[[0, 0], [0.01, 0]], [[10, 0], [10.01, 0]]] });
  const plan = planImportedRouteDownload(area, source(), 12);
  const xs = plan.urls.map(pathCoords).filter((parts) => parts?.[0] === 12).map((parts) => parts[1]);
  const left = xs.filter((x) => x < 2050), right = xs.filter((x) => x > 2100);
  assert.ok(left.length && right.length);
  assert.ok(xs.every((x) => x < 2050 || x > 2100));
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
  const long = route({ bufferKm: 0.5, segments: [[[0, 0], [0.002, 0]]] });
  assert.throws(() => planImportedRouteDownload(long, source({ minzoom: 24, maxzoom: 24 }), 24), /过大|2 万项/);
});
