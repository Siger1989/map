import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import layoutEditor from '../tools/layout-editor/plugin.mjs';
import { emptyLayout } from '../tools/layout-editor/model.mjs';

test('layout storage saves Chinese labels, rejects foreign origins and preserves valid drafts on bad input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shantu-layout-test-'));
  const draftPath = join(directory, 'draft.json');
  let middleware;
  const plugin = layoutEditor({ draftPath });
  assert.equal(plugin.apply, 'serve');
  plugin.configureServer({
    middlewares: {
      use: (fn) => {
        middleware = fn;
      },
    },
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`,
    url = `${origin}/__layout/draft`;
  try {
    assert.deepEqual(await (await fetch(url)).json(), emptyLayout());
    const value = {
      ...emptyLayout(),
      entries: [
        {
          selector: '.position-dock > button',
          label: '定位入口',
          dx: 20,
          dy: -10,
          width: 48,
          height: 48,
          scale: 0.9,
          fontSize: null,
          hidden: false,
        },
      ],
    };
    const headers = {
      origin,
      'x-shantu-layout': '1',
      'content-type': 'application/json',
    };
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, origin: 'https://foreign.invalid' },
          body: JSON.stringify(value),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(value),
        })
      ).status,
      200,
    );
    assert.deepEqual(JSON.parse(await readFile(draftPath, 'utf8')), value);
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: '{bad' })).status,
      400,
    );
    assert.deepEqual(await (await fetch(url)).json(), value);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await unlink(draftPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(directory);
  }
});
