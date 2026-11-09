import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { probeMapSourceHealth } from '../modules/mapSources/health.ts';

const source = {
  id: 'health-fixture', name: 'Fixture source', kind: 'online', format: 'XYZ',
  tiles: ['https://tiles.fixture.invalid/{z}/{x}/{y}.png'], scheme: 'xyz',
  minzoom: 0, maxzoom: 24, datum: 'wgs84', tileSize: 256,
};
const placeholder = await readFile(new URL('./fixtures/jilin-no-data-placeholder.png', import.meta.url));

async function withTransport(transport, run) {
  const originalFetch = globalThis.fetch;
  const originalBitmap = globalThis.createImageBitmap;
  const requested = [];
  globalThis.fetch = async (input, init = {}) => {
    const endpoint = new URL(String(input));
    const providerUrl = endpoint.searchParams.get('url');
    requested.push(providerUrl);
    return transport(providerUrl, init.signal);
  };
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  try { await run(requested); }
  finally { globalThis.fetch = originalFetch; globalThis.createImageBitmap = originalBitmap; }
}

test('ordinary 202 raster is readable while the exact known no-data raster is missing', async () => {
  await withTransport(() => new Response(new Uint8Array([1, 2, 3, 4]), { status: 202 }), async requested => {
    const result = await probeMapSourceHealth(source, [103.8, 30.7], 19);
    assert.equal(result.status, 'ok');
    assert.equal(result.testedZoom, 19);
    assert.equal(result.sampled, 3);
    assert.equal(requested.length, 3);
    assert.match(result.sourceName, /Fixture source/);
    assert.equal(typeof result.elapsedMs, 'number');
    assert.ok(result.testedAt);
  });
  await withTransport(() => new Response(placeholder, { status: 202 }), async () => {
    const result = await probeMapSourceHealth(source, [103.8, 30.7], 19);
    assert.equal(result.status, 'missing');
  });
});

test('browser transport failure reports unknown and abort is classified as cancelled', async () => {
  await withTransport(() => { throw new TypeError('browser hides transport details'); }, async () => {
    const result = await probeMapSourceHealth(source, [103.8, 30.7], 12);
    assert.equal(result.status, 'unknown');
    assert.match(result.message, /具体网络原因未知/);
  });
  await withTransport((_url, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }), async () => {
    const controller = new AbortController();
    const pending = probeMapSourceHealth(source, [103.8, 30.7], 12, controller.signal);
    controller.abort();
    const result = await pending;
    assert.equal(result.status, 'cancelled');
  });
});

test('OVMAP multi-layer result explicitly limits scope to its base layer', async () => {
  const ovmap = { ...source, ovmap: { layers: [
    { tiles: source.tiles, minzoom: 0, maxzoom: 24 },
    { tiles: ['https://detail.fixture.invalid/{z}/{x}/{y}.png'], minzoom: 5, maxzoom: 20 },
  ] } };
  await withTransport(() => new Response(new Uint8Array([9, 8, 7]), { status: 200 }), async () => {
    const result = await probeMapSourceHealth(ovmap, [103.8, 30.7], 12);
    assert.equal(result.status, 'ok');
    assert.equal(result.scope, 'base-layer-only');
  });
});
