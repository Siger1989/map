import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { terrainRepairPath, legacyTerrainCacheUrl, TERRAIN_URL } from '../modules/terrain/tiles.ts';
import { offlineProtocol, regionTiles } from '../modules/outdoor/offline.ts';

test('repair manifest references verified bundled tiles with original Terrarium size', async () => {
  const root = new URL('../public/terrain/repairs-v1/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('SOURCE.json', root)));
  for (const [key, sha] of Object.entries(source.outputs_sha256)) {
    const [z, x, file] = key.split('/');
    assert.equal(terrainRepairPath(+z, +x, parseInt(file)), `/terrain/repairs-v1/${key}`);
    const png = await readFile(new URL(key, root));
    assert.equal(createHash('sha256').update(png).digest('hex'), sha);
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png.readUInt32BE(20), 256);
  }
  assert.equal(Object.keys(source.outputs_sha256).length, 23);
  assert.equal(terrainRepairPath(12, 3160, 1624), '/terrain/repairs-v1/12/3160/1624.png');
});

test('repair stays in reviewed footprint, preserves Chengdu and other global sources', () => {
  for (const tile of [[12, 3219, 1676], [12, 3162, 1624], [13, 6321, 3249], [1, 1, 1], [12, -1, 1], [12, 3160.1, 1624]])
    assert.equal(terrainRepairPath(...tile), null);
});

test('old offline DEMs are reusable only outside corrected tiles', () => {
  const origin = 'https://appassets.androidplatform.net';
  assert.equal(legacyTerrainCacheUrl(`${origin}/api/terrain/12/3160/1624.png?revision=repairs-v1`), null);
  assert.equal(legacyTerrainCacheUrl(`${origin}/api/terrain/12/3219/1676.png?revision=repairs-v1`), `${origin}/api/terrain/12/3219/1676.png`);
  assert.equal(legacyTerrainCacheUrl(`${origin}/api/geology/tiles/1/1/1`), null);
  const urls = regionTiles([97.76, 34.85, 97.761, 34.851], 12, origin + TERRAIN_URL);
  assert.ok(urls.every((url) => url.endsWith('?revision=repairs-v1')));
});

test('offline protocol bypasses cached bad tile but preserves unaffected offline package', async () => {
  const cachesBefore = globalThis.caches, fetchBefore = globalThis.fetch;
  const fetched = [];
  globalThis.caches = { open: async () => ({match: async (url) => url.includes('?') ? undefined : new Response('old')}) };
  globalThis.fetch = async (url) => { fetched.push(url); return new Response('repaired'); };
  try {
    const read = async (path) => new TextDecoder().decode((await offlineProtocol({url: `tripcache://${encodeURIComponent('http://localhost' + path + '?revision=repairs-v1')}`, type: 'arrayBuffer'}, new AbortController())).data);
    assert.equal(await read('/api/terrain/12/3160/1624.png'), 'repaired');
    assert.equal(await read('/api/terrain/12/3219/1676.png'), 'old');
    assert.equal(fetched.length, 1);
  } finally { globalThis.caches = cachesBefore; globalThis.fetch = fetchBefore; }
});

test('module and bundled Android repair manifests stay identical', async () => {
  const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  assert.deepEqual(await read('../modules/terrain/repair-coverage.json'), await read('../public/terrain/repairs-v1/coverage.json'));
});
