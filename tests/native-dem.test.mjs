import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeFetch } from '../modules/terrainPrint/nativeDem.ts';

const source = 'https://data.nsidc.earthdatacloud.nasa.gov/nsidc-cumulus-prod-protected/HMA/HMA_DEM8m_MOS/1/2002/01/28/HMA_DEM8m_MOS_20170716_tile-677.tif';
test('a nonzero source interval survives an Android WebView intercepted stream', async t => {
  const origin = 'https://appassets.androidplatform.net';
  const previous = globalThis.window;
  globalThis.window = { location: { origin } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });

  const bytes = Uint8Array.from([0x49, 0x2a, 0x00, 0xff]);
  const contentRange = 'bytes 96-99/100';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, origin);
    assert.equal(target.searchParams.get('file'), new URL(source).pathname);
    assert.equal(target.searchParams.get('range'), 'bytes=96-99');
    assert.equal(target.searchParams.get('wire'), 'bytes');
    const headers = new Headers(init.headers);
    assert.equal(headers.has('Range'), false);
    assert.equal(headers.get('Authorization'), 'Bearer fixture');
    return new Response(bytes, { status: 200, headers: { 'X-Shantu-Content-Range': contentRange, 'Content-Length': String(bytes.length) } });
  });
  const response = await nativeFetch(source, { headers: { Range: 'bytes=96-99', Authorization: 'Bearer fixture' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), contentRange);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('Android byte transport rejects shifted, truncated and mislabeled responses and preserves auth status', async t => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'https://appassets.androidplatform.net' } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  let reply;
  t.mock.method(globalThis, 'fetch', async () => reply);
  const options = { headers: { Range: 'bytes=96-103' } };
  for (const [range, size] of [['bytes 95-98/100', 4], ['bytes 96-99/100', 3], ['missing', 4]]) {
    reply = new Response(new Uint8Array(size), { headers: { 'X-Shantu-Content-Range': range } });
    await assert.rejects(nativeFetch(source, options));
  }
  reply = new Response(new Uint8Array(4), { headers: { 'X-Shantu-Content-Range': 'bytes 96-99/100' } });
  assert.equal((await nativeFetch(source, options)).status, 206);
  reply = new Response(null, { status: 428 });
  assert.equal((await nativeFetch(source, options)).status, 428);
});
