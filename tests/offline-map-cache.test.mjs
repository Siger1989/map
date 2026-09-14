import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMapFetch } from '../modules/outdoor/tileCache.ts';
test('cached terrain is readable with all network access forbidden; missing offline tiles fail explicitly', async () => {
  const original = {
    window: globalThis.window,
    caches: globalThis.caches,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };
  let requests = 0;
  globalThis.window = {
    location: { origin: 'https://appassets.androidplatform.net' },
  };
  globalThis.localStorage = { getItem: () => 'true' };
  globalThis.caches = {
    open: async () => ({
      match: async (url) =>
        url.includes('/12/1/2.png')
          ? new Response('cached-terrain')
          : undefined,
    }),
  };
  globalThis.fetch = () => {
    requests++;
    throw Error('Network prohibited');
  };
  try {
    assert.equal(
      await (
        await cachedMapFetch(
          '/api/terrain/12/1/2.png',
          new AbortController().signal,
        )
      ).text(),
      'cached-terrain',
    );
    await assert.rejects(
      () =>
        cachedMapFetch('/api/terrain/12/2/3.png', new AbortController().signal),
      /未缓存/,
    );
    assert.equal(requests, 0);
  } finally {
    for (const [key, value] of Object.entries(original))
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
  }
});
