import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSatelliteCloudFramesUrl,
  buildSatelliteCloudImageUrl,
  fetchSatelliteCloudImage,
  listSatelliteCloudFrames,
  parseSatelliteCloudFrames,
  cloudPixelsHaveVariation,
} from '../modules/weather/satelliteCloud.ts';

const signal = () => new AbortController().signal;
const framesPayload = {
  returnCode: 0,
  ds: [
    { dataDate: '20261003', dataTime: '060000' },
    { dataDate: '20261003', dataTime: '050000' },
    { dataDate: '20261003', dataTime: '060000' },
    { dataDate: 'bad', dataTime: '120000' },
  ],
};
const frame = { stamp: '202610030600', timeUTC: Date.UTC(2026, 9, 3, 6, 0) };
const tileBounds = [90, 30, 101.25, 40.98];

test('white cloud masks with varying alpha are real spatial data; uniform blanks fail', () => {
  assert.equal(cloudPixelsHaveVariation(new Uint8ClampedArray([255,255,255,0,255,255,255,32,255,255,255,180])), true);
  assert.equal(cloudPixelsHaveVariation(new Uint8ClampedArray([0,0,0,0,0,0,0,0])), false);
  assert.equal(cloudPixelsHaveVariation(new Uint8ClampedArray([255,255,255,255,255,255,255,255])), false);
});

test('frame parsing returns unique UTC stamps in chronological order', () => {
  assert.deepEqual(parseSatelliteCloudFrames(framesPayload), [
    { stamp: '202610030500', timeUTC: Date.UTC(2026, 9, 3, 5, 0) },
    frame,
  ]);
  assert.throws(() => parseSatelliteCloudFrames({ returnCode: 5, ds: [] }), /暂不可用/);
  assert.throws(() => parseSatelliteCloudFrames({ returnCode: 0 }), /缺少时次/);
});

test('official frame-list URL and request parser use the documented product and UTC times', async () => {
  const url = new URL(buildSatelliteCloudFramesUrl());
  assert.equal(url.origin, 'https://data.nsmc.org.cn');
  assert.equal(url.pathname, '/nsmcapi/v1/nsmc/image/animation/datatime/mongodb');
  assert.equal(url.searchParams.get('dataCode'), 'GEO_MULT_GBAL_L2_GGM_IRX_GLL_YYYYMMDD_HHmm_4000M.PNG');
  assert.equal(url.searchParams.get('hourRange'), '24');

  let requestedUrl = '';
  let requestedSignal;
  const inputSignal = signal();
  const frames = await listSatelliteCloudFrames(inputSignal, {
    cacheMs: 0,
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedSignal = init.signal;
      return Response.json(framesPayload);
    },
  });
  assert.deepEqual(frames.map(({ stamp }) => stamp), ['202610030500', '202610030600']);
  assert.equal(requestedUrl, buildSatelliteCloudFramesUrl());
  assert.ok(requestedSignal instanceof AbortSignal);
  assert.notEqual(requestedSignal, inputSignal);
});

test('GetMap URL uses the documented GEOS_IRX example protocol and validates bounds/time', () => {
  const url = new URL(buildSatelliteCloudImageUrl(frame, tileBounds, { width: 256, height: 256 }));
  assert.equal(url.origin, 'https://data.nsmc.org.cn');
  assert.equal(url.pathname, '/NSMCAPI/v1/nsmc/image/wms/compose');
  assert.equal(url.searchParams.get('layers'), 'GEOS_IRX');
  assert.equal(url.searchParams.get('datetime'), '202610030600');
  assert.equal(url.searchParams.get('bbox'), tileBounds.join(','));
  assert.equal(url.searchParams.get('width'), '256');
  assert.equal(url.searchParams.get('height'), '256');
  assert.equal(url.searchParams.get('version'), '1.1.0');
  assert.equal(url.searchParams.get('format'), 'png');
  assert.throws(() => buildSatelliteCloudImageUrl({ ...frame, stamp: '202610030500' }, tileBounds), /不匹配/);
  assert.throws(() => buildSatelliteCloudImageUrl(frame, [110, 0, 90, 40]), /范围无效/);
});

test('cloud fetch requests a full global image and returns its EPSG:4326 source bounds', async () => {
  const requests = [];
  const imageBytes = new Uint8Array(256);
  const blob = new Blob([imageBytes], { type: 'image/jpeg' });
  const image = await fetchSatelliteCloudImage(frame, tileBounds, signal(), {
    fetchImpl: async (url, requestSignal) => {
      requests.push({ url: new URL(url), requestSignal });
      return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    },
    inspectImage: async (value) => value.size === 256,
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].url.searchParams.get('bbox'), '-180,-90,180,90');
  assert.equal(requests[0].url.searchParams.get('width'), '2048');
  assert.equal(requests[0].url.searchParams.get('height'), '1024');
  assert.equal(requests[0].url.searchParams.get('datetime'), frame.stamp);
  assert.notEqual(requests[0].requestSignal, undefined);
  assert.deepEqual(new Uint8Array(await image.blob.arrayBuffer()), imageBytes);
  assert.deepEqual(image.bounds, [-180, -90, 180, 90]);
});

test('an empty first-size response retries 1024 global image and blank frames fail closed', async () => {
  const widths = [];
  const blobs = [
    new Blob([new Uint8Array(256)], { type: 'image/jpeg' }),
    new Blob([new Uint8Array(256)], { type: 'image/jpeg' }),
  ];
  let inspections = 0;
  const result = await fetchSatelliteCloudImage(frame, tileBounds, signal(), {
    fetchImpl: async (url) => {
      widths.push(new URL(url).searchParams.get('width'));
      return new Response(blobs[widths.length - 1], { headers: { 'Content-Type': 'image/jpeg' } });
    },
    inspectImage: async () => ++inspections === 2,
  });
  assert.deepEqual(widths, ['2048', '1024']);
  assert.equal(result.blob.size, blobs[1].size);

  await assert.rejects(fetchSatelliteCloudImage(frame, tileBounds, signal(), {
    fetchImpl: async () => new Response(new Blob([new Uint8Array(256)]), { headers: { 'Content-Type': 'image/jpeg' } }),
    inspectImage: async () => false,
  }), /空白云图/);
});

test('HTTP success with a non-image payload is rejected', async () => {
  await assert.rejects(fetchSatelliteCloudImage(frame, tileBounds, signal(), {
    fetchImpl: async () => new Response('{"error":"empty"}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    inspectImage: async () => true,
  }), /不是云图/);
});

test('concurrent tile loads share one frame image and one caller abort does not cancel the other', async () => {
  const originals = {
    fetch: globalThis.fetch,
    createImageBitmap: globalThis.createImageBitmap,
    OffscreenCanvas: globalThis.OffscreenCanvas,
  };
  let finishFetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Promise((resolve) => { finishFetch = resolve; });
  };
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
  globalThis.OffscreenCanvas = class {
    getContext() {
      return {
        drawImage() {},
        getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) }; },
      };
    }
  };
  const firstController = new AbortController();
  const secondController = new AbortController();
  try {
    const first = fetchSatelliteCloudImage(frame, tileBounds, firstController.signal);
    await new Promise((resolve) => setImmediate(resolve));
    const second = fetchSatelliteCloudImage(frame, [101.25, 30, 112.5, 40], secondController.signal);
    await new Promise((resolve) => setImmediate(resolve));
    firstController.abort();
    finishFetch(new Response(new Blob([new Uint8Array(256)], { type: 'image/jpeg' }), {
      headers: { 'Content-Type': 'image/jpeg' },
    }));
    await assert.rejects(first, { name: 'AbortError' });
    const image = await second;
    assert.equal(fetchCount, 1);
    assert.deepEqual(image.bounds, [-180, -90, 180, 90]);
  } finally {
    globalThis.fetch = originals.fetch;
    if (originals.createImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originals.createImageBitmap;
    if (originals.OffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originals.OffscreenCanvas;
  }
});
