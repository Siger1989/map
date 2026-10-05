import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createPinnedRequester, fetchPublicMapTile } from '../tools/map-tile-proxy.mjs';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function withServer(handler, run) {
  const sockets = new Set();
  const stats = { connections: 0 };
  const server = http.createServer(handler);
  server.on('connection', (socket) => {
    stats.connections++;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(server.address().port, sockets, stats); }
  finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, 'close');
  }
}

function invoke(request, port, {
  host = 'tiles.example.test',
  address = '127.0.0.1',
  family = 4,
  protocol = 'http:',
  path = '/tile.png',
  signal,
  timeoutMs = 1_000,
} = {}) {
  const url = new URL(`${protocol}//${host}:${port}${path}`);
  return request(url, host, address, family, port, timeoutMs, 1024, signal);
}

test('pinned HTTP agent reuses an idle connection for the same validated destination', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port, _sockets, stats) => {
    const request = createPinnedRequester();
    await invoke(request, port);
    await invoke(request, port);
    assert.equal(stats.connections, 1);
  });
});

test('pinned pool keys isolate host, address, family, and port, then evict only idle entries', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port, _sockets, stats) => {
    const request = createPinnedRequester({
      maxEntries: 1,
      idleTimeoutMs: 5_000,
      connectTcp: ({ port: targetPort }) => net.connect({ host: '127.0.0.1', port: targetPort }),
    });
    await invoke(request, port, { host: 'one.example.test' });
    await invoke(request, port, { host: 'two.example.test' });
    await invoke(request, port, { host: 'one.example.test', address: '127.0.0.2' });
    await invoke(request, port, { host: 'one.example.test', family: 6 });
    await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    }, async (otherPort, _otherSockets, otherStats) => {
      await invoke(request, otherPort, { host: 'one.example.test' });
      assert.equal(otherStats.connections, 1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stats.connections, 4);
  });
});

test('HTTPS transport preserves the original hostname for TLS SNI and verification', async () => {
  let tlsOptions;
  const request = createPinnedRequester({
    connectTls: (options) => {
      tlsOptions = options;
      throw new Error('intentional TLS fixture stop');
    },
  });
  await assert.rejects(invoke(request, 443, { protocol: 'https:', host: 'tiles.example.test' }));
  assert.deepEqual(tlsOptions, {
    host: '127.0.0.1',
    family: 4,
    port: 443,
    servername: 'tiles.example.test',
    rejectUnauthorized: true,
  });
});

test('a server-closed idle socket is discarded and replaced on the next request', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port, sockets, stats) => {
    const request = createPinnedRequester();
    await invoke(request, port);
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await invoke(request, port);
    assert.deepEqual(result.body, png);
    assert.equal(stats.connections, 2);
  });
});

test('redirect headers destroy a hanging response body and release the pool lease', async () => {
  let redirectSocketClosed;
  const socketClosed = new Promise((resolve) => { redirectSocketClosed = resolve; });
  await withServer((req, res) => {
    if (req.url === '/redirect') {
      req.socket.once('close', redirectSocketClosed);
      res.writeHead(302, { Location: '/next' });
      res.flushHeaders();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port, _sockets, stats) => {
    const request = createPinnedRequester({ maxEntries: 1 });
    const startedAt = Date.now();
    const redirect = await invoke(request, port, { path: '/redirect', timeoutMs: 1_000 });
    assert.deepEqual({ status: redirect.status, location: redirect.location }, { status: 302, location: '/next' });
    assert.ok(Date.now() - startedAt < 300, 'redirect headers should resolve without waiting for its body');
    let closeTimeout;
    const closeTimeoutPromise = new Promise((_, reject) => {
      closeTimeout = setTimeout(() => reject(new Error('redirect socket stayed open')), 300);
    });
    try {
      await Promise.race([socketClosed, closeTimeoutPromise]);
    } finally { clearTimeout(closeTimeout); }
    const next = await invoke(request, port, { path: '/next' });
    assert.deepEqual(next.body, png);
    assert.equal(stats.connections, 2);
  });
});

test('an abort destroys its request socket and the shared agent serves a later request', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests++;
    if (requests === 1) return;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port) => {
    const request = createPinnedRequester();
    const controller = new AbortController();
    const pending = invoke(request, port, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort(new Error('test abort'));
    await assert.rejects(pending, /test abort/);
    const result = await invoke(request, port);
    assert.deepEqual(result.body, png);
    assert.equal(requests, 2);
  });
});

test('pool saturation uses a one-shot agent while preserving the active pooled request', async () => {
  let arrivals = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  await withServer(async (req, res) => {
    arrivals++;
    if (req.url === '/tile.png' && req.headers.host.startsWith('first.')) await firstGate;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port) => {
    const request = createPinnedRequester({ maxEntries: 1 });
    const first = invoke(request, port, { host: 'first.example.test' });
    while (arrivals === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const fallback = await invoke(request, port, { host: 'second.example.test' });
    assert.deepEqual(fallback.body, png);
    releaseFirst();
    assert.deepEqual((await first).body, png);
    assert.equal(arrivals, 2);
  });
});

test('one pooled destination opens at most four concurrent sockets', async () => {
  let arrivals = 0;
  let releaseRequests;
  const gate = new Promise((resolve) => { releaseRequests = resolve; });
  await withServer(async (_req, res) => {
    arrivals++;
    await gate;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port, _sockets, stats) => {
    const request = createPinnedRequester();
    const pending = Array.from({ length: 7 }, () => invoke(request, port));
    const waitUntilFourArrivals = Date.now() + 1_000;
    while (arrivals < 4 && Date.now() < waitUntilFourArrivals)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(arrivals, 4);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(arrivals, 4);
    releaseRequests();
    const responses = await Promise.all(pending);
    assert.equal(responses.length, 7);
    assert.equal(stats.connections, 4);
  });
});

test('a fifth request times out while four real sockets are busy, and the pool recovers', async () => {
  let arrivals = 0;
  const heldResponses = [];
  await withServer((_req, res) => {
    arrivals++;
    if (arrivals <= 4) {
      heldResponses.push(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (port, _sockets, stats) => {
    const request = createPinnedRequester();
    const active = Array.from({ length: 4 }, () => invoke(request, port, { timeoutMs: 5_000 }));
    const activeResults = Promise.all(active.map((promise) => promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )));
    const arrivalDeadline = Date.now() + 4_000;
    while (arrivals < 4 && Date.now() < arrivalDeadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(arrivals, 4);

    const fifthStart = Date.now();
    await assert.rejects(invoke(request, port, { timeoutMs: 25 }), /timed out/);
    assert.ok(Date.now() - fifthStart < 500, `queued timeout took ${Date.now() - fifthStart}ms`);
    assert.equal(arrivals, 4, 'the queued request must not reach the server');
    for (const response of heldResponses) {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(png);
    }
    const results = await activeResults;
    assert.equal(results.length, 4);
    assert.deepEqual(results.map(({ error }) => error?.message), [undefined, undefined, undefined, undefined]);
    assert.equal(arrivals, 4);

    const recovered = await invoke(request, port);
    assert.deepEqual(recovered.body, png);
    assert.equal(arrivals, 5);
    assert.equal(stats.connections, 4);
  });
});

test('the 12 second deadline includes DNS and agent waiting time', async () => {
  const start = Date.now();
  await assert.rejects(fetchPublicMapTile('https://tiles.example.test/a.png', {
    timeoutMs: 25,
    lookup: () => new Promise(() => {}),
    request: async () => { throw new Error('request must not start'); },
  }), /timed out/);
  assert.ok(Date.now() - start < 500);

  await assert.rejects(fetchPublicMapTile('https://tiles.example.test/a.png', {
    timeoutMs: 25,
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: () => new Promise(() => {}),
  }), /timed out/);
});

test('redirect hops share one deadline instead of resetting the timeout', async () => {
  const calls = [];
  const start = Date.now();
  await assert.rejects(fetchPublicMapTile('https://tiles.example.test/a.png', {
    timeoutMs: 250,
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (url, _hostname, _address, _family, _port, remainingMs) => {
      calls.push({ path: url.pathname, remainingMs });
      await new Promise((resolve) => setTimeout(resolve, 160));
      return calls.length === 1
        ? { status: 302, location: 'https://cdn.example.test/b.png' }
        : { status: 302, location: 'https://cdn.example.test/c.png' };
    },
  }), /timed out/);
  const elapsed = Date.now() - start;
  assert.deepEqual(calls.map(({ path }) => path), ['/a.png', '/b.png']);
  assert.ok(calls[1].remainingMs < calls[0].remainingMs - 100);
  assert.ok(elapsed < 400, `deadline took ${elapsed}ms`);
});
