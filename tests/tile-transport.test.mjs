import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMapTile, tileResponseError, TileTransportError } from '../modules/mapSources/tileTransport.ts';

test('Tianditu browser tiles use HTTPS direct requests and preserve key parameters', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response(null, { status: 200 });
  };
  try {
    const signal = new AbortController().signal;
    await fetchMapTile('http://t0.tianditu.gov.cn/DataServer?T=vec_w&x=4&y=7&l=8&tk=fixture', signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'https://t0.tianditu.gov.cn/DataServer?T=vec_w&x=4&y=7&l=8&tk=fixture');
    assert.equal(calls[0][1].signal, signal);
    assert.equal(calls[0][1].credentials, 'omit');
    assert.equal(calls[0][1].referrerPolicy, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unrelated domains and non-HTTPS URLs keep using the app map-tile bridge', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const calls = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'http://127.0.0.1:9174' },
  });
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response(null, { status: 200 });
  };
  try {
    const signal = new AbortController().signal;
    await fetchMapTile('https://t0.tianditu.gov.cn.evil.invalid/DataServer?tk=fixture', signal);
    await fetchMapTile('ftp://t0.tianditu.gov.cn/DataServer?tk=fixture', signal);
    assert.equal(calls.length, 2);
    for (const [endpoint, options] of calls) {
      const parsed = new URL(endpoint);
      assert.equal(parsed.origin, 'http://127.0.0.1:9174');
      assert.equal(parsed.pathname, '/api/map-tile');
      assert.equal(options.signal, signal);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
  }
});

test('online map transport ignores app cache stores and offline browser state', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('online tile');
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, get() { throw Error('CacheStorage accessed'); } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('offline preference accessed'); } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const signal = new AbortController().signal;
    const url = 'https://tiles.example.org/12/40/60.png';
    assert.equal(await (await fetchMapTile(url, signal)).text(), 'online tile');
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0][0]).pathname, '/api/map-tile');
    assert.equal(calls[0][1].signal, signal);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches);
    else delete globalThis.caches;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});

test('aborting a proxied tile cancels the matching native request without sending its URL', async () => {
  const previousFetch = globalThis.fetch;
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const previousBridge = Object.getOwnPropertyDescriptor(globalThis, 'GuanyunNative');
  const calls = [];
  const cancelled = [];
  let finish;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://appassets.androidplatform.net' },
  });
  Object.defineProperty(globalThis, 'GuanyunNative', {
    configurable: true,
    value: { cancelMapTile: (id) => cancelled.push(id) },
  });
  globalThis.fetch = (endpoint, options) => {
    calls.push([endpoint, options]);
    return new Promise((resolve) => { finish = () => resolve(new Response('tile')); });
  };
  try {
    const controller = new AbortController();
    const pending = fetchMapTile('https://private.example/tiles/1/2/3.png?token=do-not-log', controller.signal);
    const request = new URL(calls[0][0]);
    const requestId = request.searchParams.get('requestId');
    assert.match(requestId, /^mt-[a-f0-9-]+$/);
    assert.ok(requestId.length <= 64);
    assert.equal(request.searchParams.get('url'), 'https://private.example/tiles/1/2/3.png?token=do-not-log');
    assert.equal(calls[0][1].signal, controller.signal);

    controller.abort();
    assert.deepEqual(cancelled, [requestId]);
    assert.equal(cancelled.join(' ').includes('private.example'), false);
    assert.equal(cancelled.join(' ').includes('do-not-log'), false);
    finish();
    assert.equal(await (await pending).text(), 'tile');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else delete globalThis.location;
    if (previousBridge) Object.defineProperty(globalThis, 'GuanyunNative', previousBridge);
    else delete globalThis.GuanyunNative;
  }
});

test('native diagnostic response codes become safe, specific Chinese errors', () => {
  const expected = new Map([
    ['url', '图源地址无效或格式不受支持'],
    ['dns', '图源域名解析失败'],
    ['blocked', '图源地址被安全规则拒绝'],
    ['connect', '无法连接图源服务器'],
    ['tls', '图源 HTTPS 证书或加密连接失败'],
    ['timeout', '图源请求超时'],
    ['upstream_http', '图源服务器返回错误'],
    ['format', '图源返回的内容不是受支持的地图图片'],
  ]);
  for (const [code, message] of expected) {
    const response = new Response(null, { status: 502, headers: { 'X-Shantu-Tile-Error': code } });
    const error = tileResponseError(response);
    assert.ok(error instanceof TileTransportError);
    assert.equal(error.message, `图源加载失败：${message}`);
  }
  const unknown = tileResponseError(new Response(null, { status: 502, headers: { 'X-Shantu-Tile-Error': 'private-host-token-secret' } }));
  assert.equal(unknown.message, '图源加载失败：图源瓦片暂不可用 (502)');
  assert.equal(unknown.message.includes('private-host-token-secret'), false);
});
