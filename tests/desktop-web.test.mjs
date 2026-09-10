import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { request, createServer } from 'node:http';
test('portable web server serves public files and existing terrain APIs without exposing local files or other hosts', async (t) => {
  const compiled = await build({
    entryPoints: ['desktop-web/server.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    alias: { '@': process.cwd() },
  });
  const { createDesktopServer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const dir = await mkdtemp(resolve(tmpdir(), 'shantu-web-test-'));
  const root = resolve(dir, 'web');
  await mkdir(root);
  await writeFile(resolve(root, 'index.html'), '<title>山兔</title>');
  await writeFile(resolve(dir, 'private.txt'), 'private-fixture');
  const server = createDesktopServer(root);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /山兔/);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  const terrain = await fetch(base + '/api/terrain/0/0/0.png', {
    redirect: 'manual',
  });
  assert.equal(terrain.status, 302);
  assert.match(
    terrain.headers.get('location'),
    /^https:\/\/elevation-tiles-prod/,
  );
  assert.equal((await fetch(base + '/api/terrain/99/0/0.png')).status, 400);
  assert.equal((await fetch(base + '/api/missing')).status, 404);
  assert.equal((await fetch(base + '/..%5cprivate.txt')).status, 400);
  assert.equal((await fetch(base + '/private.txt')).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  const foreign = await new Promise((accept, reject) => {
    const req = request(
      base,
      { headers: { Host: 'unrelated.example' } },
      (r) => {
        r.resume();
        accept(r.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreign, 403);
});

test('starting twice reuses the same origin; unrelated services and older versions are left running', async (t) => {
  const compiled = await build({
    entryPoints: ['desktop-web/server.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    alias: { '@': process.cwd() },
  });
  const { startDesktopServer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const first = await startDesktopServer(process.cwd(), 0);
  t.after(() => new Promise((r) => first.server.close(r)));
  const again = await startDesktopServer(
    process.cwd(),
    first.server.address().port,
  );
  assert.equal(again.reused, true);
  assert.equal(again.server, null);
  assert.equal(again.url, first.url);
  assert.equal(first.server.listening, true);
  const status = await fetch(first.url + '__shantu__/status');
  assert.equal((await status.json()).app, 'shantu-desktop-web');
  let app = 'another-program';
  const other = createServer((_, res) =>
    res.end(JSON.stringify({ app, version: '0.0.1' })),
  );
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => other.close(r)));
  await assert.rejects(
    startDesktopServer(process.cwd(), other.address().port),
    /被其他程序或旧版山兔占用/,
  );
  assert.equal(other.listening, true);
  app = 'shantu-desktop-web';
  await assert.rejects(
    startDesktopServer(process.cwd(), other.address().port),
    /请先关闭旧版启动窗口/,
  );
  assert.equal(other.listening, true);
});
