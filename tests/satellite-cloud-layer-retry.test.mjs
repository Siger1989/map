import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let sequence = 0;
async function harness(t, { retryDelayMs = 5, metadataReplies = [], imageOk = () => true } = {}) {
  const originals = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap,
    OffscreenCanvas: globalThis.OffscreenCanvas,
  };
  const date = new Date(Date.UTC(2026, 9, 6, 0, sequence++));
  const older = new Date(date.getTime() - 60_000);
  const stampFor = value => `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}${String(value.getUTCHours()).padStart(2, '0')}${String(value.getUTCMinutes()).padStart(2, '0')}`;
  const stamp = stampFor(date), olderStamp = stampFor(older);
  const asFrameEntry = value => ({ dataDate: value.slice(0, 8), dataTime: `${value.slice(8)}00` });
  const metadataPayload = { returnCode: 0, ds: [asFrameEntry(olderStamp), asFrameEntry(stamp)] };
  const sources = new Map(), layers = new Map(), protocols = new Map();
  const counts = { sourceAdds: 0, metadata: 0, image: 0 };
  const emitted = [];
  const built = await build({
    entryPoints: ['modules/weather/SatelliteCloudLayer.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { SatelliteCloudLayer, CLOUD_LAYER_ID } = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}#${sequence}`,
  );
  const map = {
    getSource: id => sources.get(id),
    addSource: (id, spec) => { counts.sourceAdds++; sources.set(id, spec); },
    removeSource: id => sources.delete(id),
    getLayer: id => layers.get(id),
    addLayer: layer => layers.set(layer.id, layer),
    removeLayer: id => layers.delete(id),
    setPaintProperty: (id, key, value) => { const layer = layers.get(id); if (layer) layer.paint[key] = value; },
    getStyle: () => ({ layers: [] }),
  };
  const api = { addProtocol: (name, handler) => protocols.set(name, handler), removeProtocol: name => protocols.delete(name) };
  const layer = new SatelliteCloudLayer(map, api, state => emitted.push({ ...state }), { retryDelayMs });
  t.after(() => {
    layer.dispose();
    globalThis.fetch = originals.fetch;
    if (originals.document === undefined) delete globalThis.document; else globalThis.document = originals.document;
    if (originals.createImageBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originals.createImageBitmap;
    if (originals.OffscreenCanvas === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = originals.OffscreenCanvas;
  });
  globalThis.document = {
    hidden: false,
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob: callback => callback(new Blob([new Uint8Array([1])], { type: 'image/png' })),
    }),
  };
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
  globalThis.OffscreenCanvas = class {
    getContext() {
      return {
        drawImage() {},
        getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]) }; },
      };
    }
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/mongodb')) {
      const reply = metadataReplies[counts.metadata++];
      if (reply === 'fail') return new Response('unavailable', { status: 502 });
      return Response.json(metadataPayload);
    }
    if (url.pathname === '/api/map-tile') {
      counts.image++;
      const upstream = new URL(url.searchParams.get('url'));
      if (!await imageOk(counts.image, upstream)) return new Response('upstream unavailable', { status: 502 });
      return new Response(new Blob([new Uint8Array(256)], { type: 'image/jpeg' }), {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const settings = { clouds: true, cloudOpacity: 0.55 };
  const wait = async predicate => {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.fail('timed out waiting for cloud layer state');
  };
  const update = () => layer.update(settings);
  const requestTile = async (requestedStamp = stamp) => {
    const protocol = [...protocols.values()][0];
    assert.ok(protocol);
    const controller = new AbortController();
    return protocol({ url: `${[...protocols.keys()][0]}://${requestedStamp}/0/0/0.png` }, controller);
  };
  return { layer, map, sources, counts, emitted, settings, stamp, olderStamp, wait, update, requestTile };
}

test('failed current frame is rebuilt once and a successful retry clears the error', async t => {
  let allowImage = false;
  const h = await harness(t, { imageOk: () => allowImage });
  h.update();
  await h.wait(() => h.counts.sourceAdds === 1);
  await assert.rejects(h.requestTile());
  assert.match(h.emitted.at(-1).error, /502/);
  await h.wait(() => h.counts.sourceAdds === 2);
  allowImage = true;
  await h.requestTile();
  assert.equal(h.emitted.at(-1).ready, true);
  assert.equal(h.emitted.at(-1).error, '');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.counts.sourceAdds, 2, 'success cancels the scheduled retry');
  await h.layer.loadFrames();
  assert.equal(h.counts.sourceAdds, 2, 'same ready frame is not rebuilt by metadata refresh');
});

test('image retry budget is two per selected stamp even when every attempt fails', async t => {
  const h = await harness(t, { imageOk: () => false });
  h.update();
  await h.wait(() => h.counts.sourceAdds === 1);
  await assert.rejects(h.requestTile());
  await h.wait(() => h.counts.sourceAdds === 2);
  await assert.rejects(h.requestTile());
  await h.wait(() => h.counts.sourceAdds === 3);
  await assert.rejects(h.requestTile());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.counts.sourceAdds, 3, 'initial load plus no more than two retries');
  assert.equal(h.emitted.at(-1).loading, false);
  assert.match(h.emitted.at(-1).error, /502/);
});

test('concurrent failed tiles coalesce and do not abort a slow retry request', async t => {
  let releaseRetry;
  let retrySignal;
  const h = await harness(t, {
    retryDelayMs: 8,
    imageOk: count => {
      if (count <= 2) return false;
      return new Promise(resolve => { releaseRetry = resolve; });
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/map-tile') retrySignal = init.signal;
    return originalFetch(input, init);
  };
  h.update();
  await h.wait(() => h.counts.sourceAdds === 1);
  const failures = await Promise.allSettled([h.requestTile(), h.requestTile(), h.requestTile()]);
  assert.ok(failures.every(result => result.status === 'rejected'));
  await h.wait(() => h.counts.sourceAdds === 2);
  const retryRequest = h.requestTile();
  await h.wait(() => typeof releaseRetry === 'function');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(h.counts.sourceAdds, 2, 'duplicate tile errors do not queue a second retry');
  assert.equal(retrySignal?.aborted, false, 'the slow retry tile request remains active past the retry delay');
  releaseRetry(true);
  await retryRequest;
  assert.equal(h.emitted.at(-1).ready, true);
  assert.equal(h.emitted.at(-1).error, '');
  assert.equal(h.counts.sourceAdds, 2);
});

test('changing observation cancels the old retry and gives the new stamp its own bounded budget', async t => {
  const h = await harness(t, { retryDelayMs: 15, imageOk: () => false });
  h.update();
  await h.wait(() => h.counts.sourceAdds === 1);
  await assert.rejects(h.requestTile());
  await h.wait(() => h.counts.sourceAdds === 2);
  await assert.rejects(h.requestTile());
  // The second retry is pending now; changing time must cancel that timer.
  h.layer.update({ ...h.settings, cloudTime: h.olderStamp });
  assert.equal(h.counts.sourceAdds, 3, 'switching time installs the selected observation');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.counts.sourceAdds, 3, 'the old observation retry timer was cancelled');
  await assert.rejects(h.requestTile(h.olderStamp));
  await h.wait(() => h.counts.sourceAdds === 4);
  await assert.rejects(h.requestTile(h.olderStamp));
  await h.wait(() => h.counts.sourceAdds === 5);
  await assert.rejects(h.requestTile(h.olderStamp));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.map.getSource('satellite-cloud-observation-source') !== undefined, true);
  assert.equal(h.counts.sourceAdds, 5, 'the new stamp receives two retries and then stops');
});

test('metadata failure retries twice and then stops', async t => {
  const h = await harness(t, { metadataReplies: ['fail', 'fail', 'fail'] });
  h.update();
  await h.wait(() => h.counts.metadata === 1 && h.emitted.at(-1)?.error);
  await h.wait(() => h.counts.metadata === 2);
  await h.wait(() => h.counts.metadata === 3);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.counts.metadata, 3, 'initial request plus two retries');
  assert.equal(h.counts.sourceAdds, 0);
  assert.equal(h.emitted.at(-1).loading, false);
  assert.match(h.emitted.at(-1).error, /502/);
});

test('metadata retry succeeds after a transient list failure', async t => {
  const h = await harness(t, { metadataReplies: ['fail', 'ok'] });
  h.update();
  await h.wait(() => h.counts.sourceAdds === 1);
  assert.equal(h.counts.metadata, 2);
  assert.equal(h.emitted.at(-1).frame.stamp, h.stamp);
});

for (const endMode of ['disabled', 'disposed']) {
  test(`pending image retry is cancelled when the layer is ${endMode}`, async t => {
    const h = await harness(t, { retryDelayMs: 25, imageOk: () => false });
    h.update();
    await h.wait(() => h.counts.sourceAdds === 1);
    await assert.rejects(h.requestTile());
    if (endMode === 'disabled') h.layer.update({ ...h.settings, clouds: false });
    else h.layer.dispose();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(h.counts.sourceAdds, 1);
    assert.equal(h.map.getLayer('satellite-cloud-observation'), undefined);
  });
}
