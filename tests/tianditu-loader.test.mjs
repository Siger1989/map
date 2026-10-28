import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiandituLoader, isTiandituTileUrl, TiandituLoadError } from '../modules/mapSources/tiandituLoader.ts';

const validPng = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
]).buffer;

function tile({ host = 't0', layer = 'img', z = 2, x = 1, y = 1, tk = 'fixture-key', extra = '' } = {}) {
  return `https://${host}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILECOL=${x}&TILEROW=${y}&tk=${tk}${extra}`;
}

function dataServerTile({ host = 't0', layer = 'img', z = 4, x = 3, y = 5, tk = 'fixture-key', extra = '' } = {}) {
  return `https://${host}.tianditu.gov.cn/DataServer?T=${layer}_w&x=${x}&y=${y}&l=${z}&tk=${tk}${extra}`;
}

function imageResponse({ headers = {}, bytes = validPng, status = 200 } = {}) {
  return new Response(status === 200 ? bytes : null, { status, headers: { 'Content-Type': 'image/png', ...headers } });
}

function memoryCache() {
  const values = new Map();
  return {
    values,
    get: async key => values.get(key)?.bytes.slice(0),
    put: (key, bytes, ttlMs) => values.set(key, { bytes: bytes.slice(0), ttlMs }),
    forget: key => values.delete(key),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function until(predicate, message = 'condition did not become true') {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

async function withImageDecoder(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 256, height: 256, close() {} }),
  });
  try { await run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else delete globalThis.createImageBitmap;
  }
}

test('accepts only Tianditu WMTS tile URLs with valid layer and XYZ coordinates', () => {
  assert.equal(isTiandituTileUrl(tile({ host: 't7' })), true);
  assert.equal(isTiandituTileUrl(tile().replace('https:', 'http:')), true);
  for (const url of [
    tile().replace('t0.tianditu.gov.cn', 't8.tianditu.gov.cn'),
    tile().replace('t0.tianditu.gov.cn', 't0.tianditu.gov.cn.evil.invalid'),
    tile().replace('/img_w/wmts', '/bad_w/wmts'),
    tile().replace('TILECOL=1', 'TILECOL=4'),
    tile().replace('TILEMATRIX=2', 'TILEMATRIX=20'),
    tile().replace('tk=fixture-key', ''),
    tile().replace('/wmts?', '/DataServer?'),
    tile().replace('REQUEST=GetTile', 'REQUEST=GetCapabilities'),
  ]) assert.equal(isTiandituTileUrl(url), false, url);
});

test('accepts strict official Tianditu DataServer URLs used by imported layers', () => {
  assert.equal(isTiandituTileUrl(dataServerTile({ host: 't7', layer: 'img' })), true);
  assert.equal(isTiandituTileUrl(dataServerTile({ host: 't3', layer: 'cva', z: 19, x: 524_287, y: 524_287 })), true);
  assert.equal(isTiandituTileUrl(dataServerTile().replace('https:', 'http:')), true);
  for (const url of [
    dataServerTile().replace('/DataServer?', '/DataServer/evil?'),
    dataServerTile().replace('t0.tianditu.gov.cn', 't0.tianditu.gov.cn.evil.invalid'),
    dataServerTile().replace('T=img_w', 'T=evil_w'),
    dataServerTile().replace('x=3', 'x=16'),
    dataServerTile().replace('l=4', 'l=20'),
    dataServerTile().replace('&tk=fixture-key', ''),
  ]) assert.equal(isTiandituTileUrl(url), false, url);
});

test('keeps DataServer and WMTS endpoint identities separate and preserves the DataServer request', async () => {
  const cache = memoryCache();
  const urls = [];
  const loader = createTiandituLoader({ startIntervalMs: 1, cache, fetcher: async url => { urls.push(url); return imageResponse({ headers: { 'Cache-Control': 'max-age=60' } }); } });
  await withImageDecoder(async () => {
    await loader.load(dataServerTile(), new AbortController().signal);
    await loader.load(tile({ z: 4, x: 3, y: 5 }), new AbortController().signal);
  });
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]).pathname, '/DataServer');
  assert.equal(new URL(urls[0]).searchParams.get('T'), 'img_w');
  assert.equal(new URL(urls[0]).searchParams.get('x'), '3');
  assert.equal(new URL(urls[0]).searchParams.get('y'), '5');
  assert.equal(new URL(urls[0]).searchParams.get('l'), '4');
  assert.equal(cache.values.size, 2);
  loader.dispose();
});

test('upgrades HTTP to HTTPS and never exposes tile URL or key in safe errors', async () => {
  const calls = [];
  const loader = createTiandituLoader({ fetcher: async (url, init) => { calls.push([url, init]); return imageResponse(); } });
  await withImageDecoder(async () => {
    await loader.load(tile().replace('https:', 'http:'), new AbortController().signal);
    assert.equal(new URL(calls[0][0]).protocol, 'https:');
    assert.equal(calls[0][1].credentials, 'omit');
    assert.equal(calls[0][1].cache, 'no-store');
    assert.equal(calls[0][1].referrerPolicy, undefined);
    assert.equal(calls[0][1].headers.Accept, 'image/png,image/jpeg,image/webp,image/gif');
    const failed = createTiandituLoader({ fetcher: async () => { throw new Error('private detail'); } });
    await assert.rejects(failed.load(tile(), new AbortController().signal), error => {
      assert.ok(error instanceof TiandituLoadError);
      assert.equal(error.message.includes('fixture-key'), false);
      assert.equal(error.message.includes('tianditu.gov.cn'), false);
      return true;
    });
    failed.dispose();
  });
  loader.dispose();
});

test('accepts built-in zoom 19 while still rejecting zoom 20', async () => {
  let calls = 0;
  const loader = createTiandituLoader({ fetcher: async () => { calls++; return imageResponse(); } });
  await withImageDecoder(async () => {
    const z19 = tile({ layer: 'cva', z: 19, x: 524_287, y: 524_287 });
    assert.equal(isTiandituTileUrl(z19), true);
    await loader.load(z19, new AbortController().signal);
    assert.equal(calls, 1);
    assert.equal(isTiandituTileUrl(tile({ z: 20, x: 1, y: 1 })), false);
  });
  loader.dispose();
});

test('uses bounded FIFO network scheduling and cancelling a queued middle tile preserves order', async () => {
  const pending = new Map();
  const started = [];
  const loader = createTiandituLoader({ maxConcurrent: 1, startIntervalMs: 1, fetcher: url => {
    const x = new URL(url).searchParams.get('TILECOL');
    started.push(x);
    const gate = deferred(); pending.set(x, gate);
    return gate.promise;
  } });
  await withImageDecoder(async () => {
    const current = loader.load(tile({ x: 0, z: 3 }), new AbortController().signal);
    await until(() => started.length === 1);
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const queued = [1, 2, 3].map((x, index) => loader.load(tile({ x, z: 3 }), controllers[index].signal));
    await until(() => loader.snapshot().queuedRequests === 3);
    controllers[1].abort();
    assert.equal(await queued[1].catch(error => error.code), 'cancelled');
    pending.get('0').resolve(imageResponse());
    await until(() => started.length === 2);
    assert.equal(started[1], '1');
    pending.get('1').resolve(imageResponse());
    await until(() => started.length === 3);
    assert.equal(started[2], '3');
    pending.get('3').resolve(imageResponse());
    await Promise.all([current, queued[0], queued[2]]);
    assert.deepEqual(started, ['0', '1', '3']);
    assert.equal(loader.snapshot().networkRequests, 3);
  });
  loader.dispose();
});

test('deduplicates across t0-t7 while keeping layer and semantic query/key isolated', async () => {
  const gate = deferred();
  let calls = 0;
  const cache = memoryCache();
  const loader = createTiandituLoader({ cache, fetcher: () => { calls++; return calls === 1 ? gate.promise : Promise.resolve(imageResponse()); } });
  await withImageDecoder(async () => {
    const one = loader.load(tile({ host: 't0', extra: '&foo=bar' }), new AbortController().signal);
    const two = loader.load(tile({ host: 't7', extra: '&foo=bar' }), new AbortController().signal);
    await until(() => calls === 1);
    gate.resolve(imageResponse({ headers: { 'Cache-Control': 'max-age=30' } }));
    await Promise.all([one, two]);
    assert.equal(calls, 1);
    assert.equal(cache.values.size, 1);
    assert.equal([...cache.values.keys()][0].includes('fixture-key'), false);
    assert.equal([...cache.values.keys()][0].includes('tianditu.gov.cn'), false);
    await loader.load(tile({ layer: 'vec', extra: '&foo=bar' }), new AbortController().signal);
    await loader.load(tile({ layer: 'img', tk: 'different-key', extra: '&foo=bar' }), new AbortController().signal);
    assert.equal(calls, 3);
  });
  loader.dispose();
});

test('one cancelled consumer does not cancel a shared request; last cancellation aborts it', async () => {
  const firstGate = deferred();
  const signals = [];
  let calls = 0;
  const loader = createTiandituLoader({ fetcher: (_url, init) => {
    calls++; signals.push(init.signal);
    if (calls === 1) return firstGate.promise;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await withImageDecoder(async () => {
    const a = new AbortController(); const b = new AbortController();
    const p1 = loader.load(tile(), a.signal);
    const p2 = loader.load(tile({ host: 't7' }), b.signal);
    await until(() => calls === 1);
    a.abort();
    await assert.rejects(p1, error => error.code === 'cancelled');
    assert.equal(signals[0].aborted, false);
    firstGate.resolve(imageResponse());
    await p2;

    const c = new AbortController();
    const p3 = loader.load(tile({ x: 2 }), c.signal);
    await until(() => calls === 2);
    c.abort();
    await assert.rejects(p3, error => error.code === 'cancelled');
    assert.equal(signals[1].aborted, true);
  });
  loader.dispose();
});

test('body that hangs past the timeout releases its concurrency slot', async () => {
  let calls = 0;
  const loader = createTiandituLoader({ timeoutMs: 35, maxConcurrent: 1, fetcher: async () => {
    calls++;
    if (calls === 1) return {
      status: 200,
      ok: true,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {}, releaseLock() {} }) },
    };
    return imageResponse();
  } });
  await withImageDecoder(async () => {
    await assert.rejects(loader.load(tile(), new AbortController().signal), error => error.code === 'timeout');
    await loader.load(tile({ x: 2 }), new AbortController().signal);
    assert.equal(calls, 2);
    assert.equal(loader.snapshot().timeouts, 1);
  });
  loader.dispose();
});

test('declared oversized bodies are cancelled before rejection', async () => {
  let cancelled = false;
  const loader = createTiandituLoader({ fetcher: async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ 'Content-Length': '8388609' }),
    body: { cancel: async () => { cancelled = true; } },
  }) });
  await assert.rejects(loader.load(tile(), new AbortController().signal), error => error.code === 'oversize');
  assert.equal(cancelled, true);
  loader.dispose();
});

test('accepts only HTTP 200 and rejects partial-content tile responses', async () => {
  let calls = 0;
  const loader = createTiandituLoader({ fetcher: async () => { calls++; return imageResponse({ status: 206 }); } });
  await assert.rejects(loader.load(tile(), new AbortController().signal), error => error.code === 'http' && error.retryable === false);
  assert.equal(calls, 1);
  loader.dispose();
});

test('429 shares a long cooldown across tile subdomains and huge delays do not overflow', async () => {
  let now = 1_800_000_000_000;
  let calls = 0;
  const loader = createTiandituLoader({ now: () => now, fetcher: async () => {
    calls++;
    return new Response(null, { status: 429, headers: { 'Retry-After': '3600' } });
  } });
  const first = await loader.load(tile(), new AbortController().signal).catch(error => error);
  assert.equal(first.code, 'rate-limited');
  assert.equal(first.retryAt, now + 3_600_000);
  const queuedController = new AbortController();
  const queued = loader.load(tile({ host: 't7', x: 2 }), queuedController.signal);
  await until(() => loader.snapshot().queuedRequests === 1);
  assert.equal(loader.snapshot().remainingCooldownMs, 3_600_000);
  assert.equal(loader.snapshot().startIntervalMs, 1_000);
  queuedController.abort();
  assert.equal(await queued.catch(error => error.code), 'cancelled');
  assert.equal(calls, 1);
  loader.dispose();

  const huge = createTiandituLoader({ now: () => now, fetcher: async () => new Response(null, { status: 503, headers: { 'Retry-After': '999999999999999999999999999999999999' } }) });
  const hugeError = await huge.load(tile({ x: 3 }), new AbortController().signal).catch(error => error);
  assert.equal(hugeError.retryAt, Number.MAX_SAFE_INTEGER);
  huge.dispose();
});

test('503 HTTP-date cooldown is shared and never shortened by a later response', async () => {
  const now = Date.parse('2026-10-27T00:00:00.000Z');
  let calls = 0;
  const loader = createTiandituLoader({ now: () => now, fetcher: async () => {
    calls++;
    return new Response(null, { status: 503, headers: { 'Retry-After': 'Tue, 27 Oct 2026 01:00:00 GMT' } });
  } });
  const error = await loader.load(tile(), new AbortController().signal).catch(value => value);
  assert.equal(error.retryAt, now + 3_600_000);
  const controller = new AbortController();
  const second = loader.load(tile({ host: 't5', x: 3 }), controller.signal);
  await until(() => loader.snapshot().queuedRequests === 1);
  assert.equal(loader.snapshot().remainingCooldownMs, 3_600_000);
  controller.abort();
  assert.equal(await second.catch(value => value.code), 'cancelled');
  assert.equal(calls, 1);
  loader.dispose();
});

test('missing or invalid Retry-After uses a 30-second shared cooldown without rejecting new demand', async () => {
  const now = Date.parse('2026-10-27T00:00:00.000Z');
  for (const [status, retryAfter] of [[429, undefined], [503, 'not-a-date'], [429, 'Mon, 26 Oct 2026 23:59:00 GMT']]) {
    let calls = 0;
    const loader = createTiandituLoader({ now: () => now, fetcher: async () => {
      calls++;
      return new Response(null, { status, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });
    } });
    const error = await loader.load(tile(), new AbortController().signal).catch(value => value);
    assert.equal(error.code, 'rate-limited');
    assert.equal(error.retryAt, now + 30_000);
    assert.equal(loader.snapshot().startIntervalMs, 1_000);
    const controller = new AbortController();
    const pending = loader.load(tile({ host: 't7', x: 2 }), controller.signal);
    await until(() => loader.snapshot().queuedRequests === 1);
    assert.equal(loader.snapshot().remainingCooldownMs, 30_000);
    assert.equal(loader.snapshot().errors, 1);
    controller.abort();
    assert.equal(await pending.catch(value => value.code), 'cancelled');
    assert.equal(calls, 1);
    loader.dispose();
  }
});

test('fallback cooldown grows 10 to 20 to 40 seconds when injected for a deterministic test', async () => {
  let now = 1_800_000_000_000;
  const loader = createTiandituLoader({ now: () => now, startIntervalMs: 1, cooldownFallbackMs: 10, fetcher: async () => new Response(null, { status: 429 }) });
  const first = await loader.load(tile(), new AbortController().signal).catch(error => error);
  assert.equal(first.retryAt, now + 10);
  now += 1_000;
  const second = await loader.load(tile({ x: 2 }), new AbortController().signal).catch(error => error);
  assert.equal(second.retryAt, now + 20);
  now += 1_000;
  const third = await loader.load(tile({ x: 3 }), new AbortController().signal).catch(error => error);
  assert.equal(third.retryAt, now + 40);
  loader.dispose();
});

test('pacing delays starts by at least 250ms by default and wakes queued work after cooldown', async () => {
  const startedAt = [];
  let calls = 0;
  const loader = createTiandituLoader({ fetcher: async () => {
    startedAt.push(Date.now());
    calls++;
    return calls === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': '1' } }) : imageResponse();
  } });
  assert.equal(loader.snapshot().startIntervalMs, 250);
  await withImageDecoder(async () => {
    const first = loader.load(tile(), new AbortController().signal).catch(error => error);
    const second = loader.load(tile({ x: 2 }), new AbortController().signal);
    await until(() => loader.snapshot().queuedRequests === 1);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls, 1);
    assert.ok(loader.snapshot().remainingCooldownMs > 0);
    await first;
    await second;
    assert.equal(calls, 2);
    assert.equal(startedAt.length, 2);
    assert.ok(startedAt[1] - startedAt[0] >= 950);
    assert.equal(loader.snapshot().startIntervalMs, 1_000);
  });
  loader.dispose();
});

test('429 adaptive pacing enforces one second between starts even with Retry-After zero', async () => {
  const startedAt = [];
  let calls = 0;
  const loader = createTiandituLoader({ startIntervalMs: 5, fetcher: async () => {
    startedAt.push(Date.now());
    calls++;
    return calls === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': '0' } }) : imageResponse();
  } });
  await withImageDecoder(async () => {
    const first = loader.load(tile(), new AbortController().signal).catch(error => error);
    const second = loader.load(tile({ x: 2 }), new AbortController().signal);
    await until(() => loader.snapshot().queuedRequests === 1);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls, 1);
    assert.equal(await first.then(error => error.code), 'rate-limited');
    await second;
    assert.equal(calls, 2);
    assert.ok(startedAt[1] - startedAt[0] >= 950);
    assert.equal(loader.snapshot().startIntervalMs, 1_000);
  });
  loader.dispose();
});

test('valid cached tiles persist across loader instances with hashed key-only cache identity', async () => {
  const cache = memoryCache();
  let firstCalls = 0;
  const first = createTiandituLoader({ cache, fetcher: async () => { firstCalls++; return imageResponse({ headers: { 'Cache-Control': 'max-age=3600' } }); } });
  const second = createTiandituLoader({ cache, fetcher: async () => { throw new Error('cache miss'); } });
  await withImageDecoder(async () => {
    await first.load(tile(), new AbortController().signal);
    await second.load(tile({ host: 't6' }), new AbortController().signal);
    assert.equal(firstCalls, 1);
    assert.equal(second.snapshot().cacheHits, 1);
    assert.equal(cache.values.size, 1);
    const [[key, record]] = cache.values;
    assert.match(key, /^tianditu-wmts-v1:[a-f0-9]{64}$/);
    assert.equal(key.includes('fixture-key'), false);
    assert.equal(record.ttlMs, 3_600_000);
  });
  first.dispose(); second.dispose();
});

test('64 cached tiles reopen through the bounded cache-reader queue without bypassing stored hits', async () => {
  const backing = memoryCache();
  const tiles = Array.from({ length: 64 }, (_, x) => tile({ z: 7, x, y: 3 }));
  const seed = createTiandituLoader({ startIntervalMs: 1, cache: backing, fetcher: async () => imageResponse({ headers: { 'Cache-Control': 'max-age=3600' } }) });
  await withImageDecoder(async () => await Promise.all(tiles.map(url => seed.load(url, new AbortController().signal))));
  seed.dispose();

  let networkRequests = 0;
  let activeReads = 0; let maximumReads = 0;
  const delayedCache = {
    get: async key => {
      activeReads++;
      maximumReads = Math.max(maximumReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, 25));
      try { return await backing.get(key); }
      finally { activeReads--; }
    },
    put: (...args) => backing.put(...args),
    forget: key => backing.forget(key),
  };
  const reopened = createTiandituLoader({ startIntervalMs: 1, cache: delayedCache, fetcher: async () => {
    networkRequests++;
    return imageResponse();
  } });
  await withImageDecoder(async () => await Promise.all(tiles.map(url => reopened.load(url, new AbortController().signal))));
  assert.equal(reopened.snapshot().cacheHits, 64);
  assert.equal(reopened.snapshot().networkRequests, 0);
  assert.equal(networkRequests, 0);
  assert.ok(maximumReads <= 8);
  assert.equal(reopened.snapshot().timings.cacheLookupMs.samples, 64);
  assert.ok(reopened.snapshot().timings.cachePermitWaitMs.totalMs > 0);
  assert.equal(reopened.snapshot().cacheBypassReasons.unavailable, undefined);
  reopened.dispose();
});

test('hung cache storage stays bounded at eight active reads and queued reads can be disposed', async () => {
  let activeReads = 0; let maximumReads = 0; let network = 0;
  const loader = createTiandituLoader({ startIntervalMs: 1, cache: {
    get: () => { activeReads++; maximumReads = Math.max(maximumReads, activeReads); return new Promise(() => {}); },
    put() {}, forget() {},
  }, fetcher: async () => { network++; return imageResponse(); } });
  const pending = Array.from({ length: 12 }, (_, x) => loader.load(tile({ z: 5, x, y: 2 }), new AbortController().signal));
  await until(() => loader.snapshot().cacheReadsActive === 8 && loader.snapshot().cacheReadsQueued === 4);
  assert.equal(maximumReads, 8);
  loader.dispose();
  await Promise.allSettled(pending);
  assert.equal(loader.snapshot().cacheReadsQueued, 0);
  assert.equal(network, 0);
});

test('invalid image bodies are rejected and never cached; cache directives bound TTL', async () => {
  const cache = memoryCache();
  const loader = createTiandituLoader({ cache, now: () => 1_800_000_000_000, fetcher: async () => imageResponse({ bytes: new TextEncoder().encode('not an image').buffer }) });
  await withImageDecoder(async () => {
    await assert.rejects(loader.load(tile(), new AbortController().signal), error => error.code === 'invalid-image');
    assert.equal(cache.values.size, 0);
  });
  loader.dispose();

  const ttlCache = memoryCache();
  const ttlLoader = createTiandituLoader({ cache: ttlCache, now: () => 1_800_000_000_000, fetcher: async () => imageResponse({ headers: { 'Cache-Control': 'max-age=600', Age: '120' } }) });
  await withImageDecoder(async () => {
    await ttlLoader.load(tile({ x: 2 }), new AbortController().signal);
    assert.equal([...ttlCache.values.values()][0].ttlMs, 480_000);
  });
  ttlLoader.dispose();
});

test('no-store and no-cache responses are never written to cache', async () => {
  for (const directive of ['no-store', 'no-cache', 'max-age=0']) {
    const cache = memoryCache();
    const loader = createTiandituLoader({ cache, fetcher: async () => imageResponse({ headers: { 'Cache-Control': directive } }) });
    await withImageDecoder(async () => await loader.load(tile(), new AbortController().signal));
    assert.equal(cache.values.size, 0, directive);
    loader.dispose();
  }
});

test('crypto failure falls back to canonical in-memory dedup and never accesses persistent cache', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest: async () => { throw new Error('disabled'); } } } });
  let gets = 0; let puts = 0; let calls = 0;
  const cache = { get: async () => { gets++; return undefined; }, put: () => { puts++; }, forget() {} };
  const gate = deferred();
  const loader = createTiandituLoader({ cache, fetcher: () => { calls++; return gate.promise; } });
  try {
    await withImageDecoder(async () => {
      const one = loader.load(tile({ host: 't0' }), new AbortController().signal);
      const two = loader.load(tile({ host: 't7' }), new AbortController().signal);
      await until(() => calls === 1);
      gate.resolve(imageResponse());
      await Promise.all([one, two]);
      assert.equal(calls, 1);
      assert.equal(gets, 0);
      assert.equal(puts, 0);
    });
  } finally {
    loader.dispose();
    if (previous) Object.defineProperty(globalThis, 'crypto', previous);
    else delete globalThis.crypto;
  }
});

test('dispose during a pending cache read rejects immediately without queuing a fetch', async () => {
  let getCalled = false; let fetchCalls = 0;
  const loader = createTiandituLoader({ cache: { get: () => { getCalled = true; return new Promise(() => {}); }, put() {}, forget() {} }, fetcher: async () => { fetchCalls++; return imageResponse(); } });
  const pending = loader.load(tile(), new AbortController().signal);
  await until(() => getCalled);
  loader.dispose();
  await assert.rejects(pending, error => error.code === 'disposed');
  assert.equal(fetchCalls, 0);
  assert.equal(loader.snapshot().queuedRequests, 0);
  assert.equal(loader.snapshot().activeRequests, 0);
});

test('cancelling cache waiters removes them and a granted read releases its permit when settled', async () => {
  const firstRead = deferred();
  const ninthRead = deferred();
  let gets = 0; let fetches = 0;
  const loader = createTiandituLoader({ startIntervalMs: 1, cache: {
    get: () => {
      gets++;
      if (gets === 1) return firstRead.promise;
      if (gets === 9) return ninthRead.promise;
      return new Promise(() => {});
    }, put() {}, forget() {},
  }, fetcher: async () => { fetches++; return imageResponse(); } });
  await withImageDecoder(async () => {
    const firstEight = Array.from({ length: 8 }, (_, x) => loader.load(tile({ z: 4, x }), new AbortController().signal));
    await until(() => gets === 8 && loader.snapshot().cacheReadsActive === 8);
    const controller = new AbortController();
    const ninth = loader.load(tile({ z: 4, x: 8 }), controller.signal);
    await until(() => loader.snapshot().cacheReadsQueued === 1);
    controller.abort();
    await assert.rejects(ninth, error => error.code === 'cancelled');
    assert.equal(loader.snapshot().cacheReadsQueued, 0);
    const tenthController = new AbortController();
    const tenth = loader.load(tile({ z: 4, x: 9 }), tenthController.signal);
    await until(() => loader.snapshot().cacheReadsQueued === 1);
    firstRead.resolve(validPng);
    await until(() => gets === 9);
    tenthController.abort();
    await assert.rejects(tenth, error => error.code === 'cancelled');
    ninthRead.resolve(undefined);
    await until(() => loader.snapshot().cacheReadsActive === 7);
    loader.dispose();
    await Promise.allSettled(firstEight);
    assert.equal(loader.snapshot().cacheReadsQueued, 0);
  });
  assert.equal(fetches, 0);
  loader.dispose();
});

test('dispose during an unresolved SHA-256 operation rejects instead of hanging', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest: () => new Promise(() => {}) } } });
  let fetchCalls = 0;
  const loader = createTiandituLoader({ fetcher: async () => { fetchCalls++; return imageResponse(); } });
  try {
    const pending = loader.load(tile(), new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 5));
    loader.dispose();
    await assert.rejects(pending, error => error.code === 'disposed');
    assert.equal(fetchCalls, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'crypto', previous);
    else delete globalThis.crypto;
  }
});

test('cached image validation responds to consumer cancellation', async () => {
  const cache = memoryCache();
  const source = createTiandituLoader({ cache, fetcher: async () => imageResponse({ headers: { 'Cache-Control': 'max-age=3600' } }) });
  await withImageDecoder(async () => await source.load(tile(), new AbortController().signal));
  source.dispose();

  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let decoding = false;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: () => { decoding = true; return new Promise(() => {}); } });
  const loader = createTiandituLoader({ cache, fetcher: async () => { throw new Error('cache should be used first'); } });
  const controller = new AbortController();
  try {
    const pending = loader.load(tile(), controller.signal);
    await until(() => decoding);
    controller.abort();
    await assert.rejects(pending, error => error.code === 'cancelled');
    assert.equal(loader.snapshot().cacheHits, 0);
  } finally {
    loader.dispose();
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else delete globalThis.createImageBitmap;
  }
});

test('pending and active request counts stay bounded when the queue is full', async () => {
  const gates = [];
  const loader = createTiandituLoader({ startIntervalMs: 1, fetcher: () => { const gate = deferred(); gates.push(gate); return gate.promise; } });
  const pending = Array.from({ length: 261 }, (_, x) => loader.load(tile({ z: 9, x, y: 1 }), new AbortController().signal));
  const settled = Promise.allSettled(pending);
  await until(() => loader.snapshot().activeRequests === 4 && loader.snapshot().queuedRequests === 256);
  assert.equal(loader.snapshot().networkRequests, 4);
  const snapshot = loader.snapshot();
  assert.equal(snapshot.activeRequests, 4);
  assert.equal(snapshot.queuedRequests, 256);
  assert.ok(snapshot.errors > 0);
  loader.dispose();
  await settled;
});

test('Expires and Age determine freshness and every cache TTL is capped at 24 hours', async () => {
  const now = Date.now();
  const expiresHeader = new Date(now + 2 * 60 * 60_000).toUTCString();
  const expiresCache = memoryCache();
  const expiresLoader = createTiandituLoader({ cache: expiresCache, now: () => now, fetcher: async () => imageResponse({ headers: {
    Expires: expiresHeader,
    Age: '60',
  } }) });
  const cappedCache = memoryCache();
  const cappedLoader = createTiandituLoader({ cache: cappedCache, fetcher: async () => imageResponse({ headers: { 'Cache-Control': 'max-age=999999999999' } }) });
  await withImageDecoder(async () => {
    await expiresLoader.load(tile(), new AbortController().signal);
    await cappedLoader.load(tile({ x: 2 }), new AbortController().signal);
  });
  assert.equal([...expiresCache.values.values()][0].ttlMs, Date.parse(expiresHeader) - now - 60_000);
  assert.equal([...cappedCache.values.values()][0].ttlMs, 24 * 60 * 60_000);
  expiresLoader.dispose(); cappedLoader.dispose();
});
