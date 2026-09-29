import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMapTile } from '../modules/mapSources/tileTransport.ts';

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
