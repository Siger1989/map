import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserTileCache } from '../modules/mapSources/browserTileCache.ts';
import { mapTileRequestTransform, tiandituRequestTransform, registerTiandituProtocol, tiandituProtocol, fetchTiandituResponse } from '../modules/mapSources/tiandituProtocol.ts';
import { setOfflineMapOnly } from '../modules/outdoor/tileCache.ts';

const tile = 'https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=2&TILEROW=1&TILECOL=1&tk=fixture-key';

test('built-in tiles use protocol; other resources/providers remain unchanged', async () => {
  setOfflineMapOnly(false);
  assert.match((await mapTileRequestTransform(tile, 'Tile')).url, /^shantu-tdt:/);
  assert.deepEqual(tiandituRequestTransform(tile, 'Source'), { url: tile });
  const other = 'https://example.invalid/tiles/2/1/1.png';
  assert.deepEqual(await mapTileRequestTransform(other, 'Tile'), { url: other });
});

test('cache-only transform wins and direct loader cannot fall through to network', async () => {
  setOfflineMapOnly(true);
  try {
    assert.match((await mapTileRequestTransform(tile, 'Tile')).url, /^tripcache:/);
    await assert.rejects(fetchTiandituResponse(tile, new AbortController().signal), /缓存包/);
  } finally { setOfflineMapOnly(false); }
});

test('protocol registration is idempotent for main and secondary map registry', () => {
  const calls = [];
  const registry = { addProtocol: (...args) => calls.push(args) };
  registerTiandituProtocol(registry);
  registerTiandituProtocol(registry);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'shantu-tdt');
});

test('protocol rejects invalid destinations without echoing query credentials', async () => {
  await assert.rejects(tiandituProtocol({ url: 'shantu-tdt://tile/' + encodeURIComponent('https://example.invalid?tk=fixture-key') }, new AbortController()), error => {
    assert.equal(error.message.includes('fixture-key'), false);
    return /地址无效/.test(error.message);
  });
});

test('browser cache ready allows a cold cache instance to read persisted tiles', async () => {
  const indexedDB = new IDBFactory();
  const options = { indexedDB, databaseName: 'tdt-cold-fixture' };
  const first = createBrowserTileCache(options);
  await first.ready();
  first.put('sha256-fixture', new Uint8Array([1, 2, 3]).buffer, 60_000);
  // Wait for persistence, not merely the first instance memory hit.
  const second = createBrowserTileCache(options);
  await second.ready();
  let bytes;
  for (let i = 0; i < 50 && !bytes; i++) {
    bytes = await second.get('sha256-fixture');
    if (!bytes) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  first.dispose(); second.dispose();
});
