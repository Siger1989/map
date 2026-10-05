import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apkPreviewSeeds } from '../tools/apk-preview-seeds.mjs';

test('private seeds require explicit serve mode and real loopback requests', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'shantu-seed-preview-'));
  const file = join(folder, 'fixture.json');
  const bytes = Buffer.from(JSON.stringify({ version: 1, maps: [{ name: 'fixture' }] }));
  try {
    await writeFile(file, bytes);
    const run = async (overrides = {}, host = '127.0.0.1', enabled = true) => {
      let handler;
      const plugin = apkPreviewSeeds({ enabled, privatePath: file });
      assert.equal(plugin.apply, 'serve');
      plugin.configureServer({ config: { server: { host } }, httpServer: { address() { return {port:9174}; } }, middlewares: { use(fn) { handler = fn; } } });
      if (!handler) return { inactive: true };
      const req = { url: '/native/default-map-sources.json', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:9174' }, ...overrides };
      const result = { headers: {}, status: 200 };
      const res = { setHeader(key, value) { result.headers[key.toLowerCase()] = value; }, set statusCode(value) { result.status = value; }, end(body) { result.body = body; } };
      await handler(req, res, () => { result.next = true; });
      return result;
    };
    const success = await run();
    assert.deepEqual(success.body, bytes);
    assert.equal(success.headers['cache-control'], 'no-store');
    assert.equal(success.headers['x-content-type-options'], 'nosniff');
    assert.equal(success.headers['content-length'], String(bytes.length));
    assert.equal((await run({method:'HEAD'})).body, undefined);
    assert.deepEqual(await run({}, '127.0.0.1', false), {inactive:true});
    assert.equal((await run({url:'/native/default-map-sources.json/extra'})).next, true);
    assert.equal((await run({url:'/foo/../native/default-map-sources.json'})).next, true);
    assert.equal((await run({headers:{host:'user@localhost:9174'}})).status, 404);
    assert.equal((await run({headers:{host:'localhost:9175'}})).status, 404);
    assert.deepEqual((await run({socket:{remoteAddress:'::ffff:127.0.0.1'}})).body, bytes);
    assert.equal((await run({}, '0.0.0.0')).status, 404);
    assert.equal((await run({}, true)).status, 404);
    assert.equal((await run({socket:{remoteAddress:'192.168.1.3'}})).status, 404);
    assert.equal((await run({headers:{host:'example.com:9174'}})).status, 404);
    assert.equal((await run({headers:{host:'127.0.0.1:9174',origin:'https://example.com'}})).status, 404);
    assert.equal((await run({headers:{host:'127.0.0.1:9174','sec-fetch-site':'cross-site'}})).status, 404);
    assert.equal((await run({method:'POST'})).status, 405);
    assert.deepEqual((await run({socket:{remoteAddress:'::1'},headers:{host:'[::1]:9174'}})).body, bytes);
  } finally { await rm(folder, {recursive:true,force:true}); }
});
