import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fetchWithParentFallback,
  isKnownNoImageryBytes,
  isNoImageryResponse,
  NoImageryTileError,
  parentTile,
} from '../modules/mapSources/noImageryTile.ts';

const placeholder = await readFile(new URL('./fixtures/tianditu-no-imagery-placeholder.jpg', import.meta.url));

test('recognizes only the exact observed no-imagery raster, not ordinary white images', async () => {
  assert.equal(await isKnownNoImageryBytes(placeholder), true);
  assert.equal(await isKnownNoImageryBytes(new Uint8Array(placeholder.length).fill(255)), false);
  const nearMatch=placeholder.slice();nearMatch[100]^=1;
  assert.equal(await isKnownNoImageryBytes(nearMatch), false);
});

test('classifies provider no-tile status and header without treating authorization as missing imagery', () => {
  for (const status of [204, 404, 410]) assert.equal(isNoImageryResponse(new Response(null, { status })), true);
  assert.equal(isNoImageryResponse(new Response(null, { status: 200, headers: { 'X-VE-Tile-Info': 'no-tile' } })), true);
  for (const status of [200, 401, 403, 429, 500]) assert.equal(isNoImageryResponse(new Response(null, { status })), false);
  for (const status of [401,403]) assert.equal(isNoImageryResponse(new Response(null, { status, headers: { 'X-VE-Tile-Info': 'no-tile' } })), false);
});

test('walks to the nearest available ancestor and crops the requested descendant once', async () => {
  assert.deepEqual(parentTile(18, 103, 219), { z: 17, x: 51, y: 109 });
  const fetched = [];
  const crops = [];
  const result = await fetchWithParentFallback({
    z: 18, x: 103, y: 219, minZoom: 10, signal: new AbortController().signal,
    tileKey: (z, x, y) => `${z}/${x}/${y}`,
    fetchTile: async (z, x, y) => {
      fetched.push([z, x, y]);
      if (z > 16) throw new NoImageryTileError();
      return new Uint8Array([7]).buffer;
    },
    cropTile: async (bytes, x, y, scale) => { crops.push([x, y, scale]); return bytes; },
  });
  assert.deepEqual(fetched, [[18, 103, 219], [17, 51, 109], [16, 25, 54]]);
  assert.deepEqual(crops, [[3, 3, 4]]);
  assert.deepEqual([...new Uint8Array(result)], [7]);
});

test('does not hide authorization failures or recurse below the source minimum', async () => {
  await assert.rejects(fetchWithParentFallback({
    z: 3, x: 2, y: 3, minZoom: 0, signal: new AbortController().signal,
    fetchTile: async () => { throw new Error('unauthorized'); },
  }), /unauthorized/);
  await assert.rejects(fetchWithParentFallback({
    z: 1, x: 0, y: 0, minZoom: 1, signal: new AbortController().signal,
    fetchTile: async () => { throw new NoImageryTileError(); },
  }), NoImageryTileError);
});
