import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPublicMapTile,
  isPublicAddress,
  proxyMapTileRequest,
} from '../tools/map-tile-proxy.mjs';

const image = { status: 200, mime: 'image/png', body: Buffer.from([137, 80, 78, 71]) };

test('map tile proxy pins validated public DNS results and returns bounded image response', async () => {
  let pinned;
  const result = await fetchPublicMapTile('https://tiles.example.test/8/12/34.png', {
    lookup: async () => [{ address: '203.0.113.10', family: 4 }],
    request: async (...args) => { pinned = args.slice(1, 4); return image; },
  }).catch((error) => error);
  // Documentation-range addresses are deliberately rejected.
  assert.match(result.message, /not public/);
  assert.equal(pinned, undefined);

  const tile = await fetchPublicMapTile('https://tiles.example.test/8/12/34.png', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (...args) => { pinned = args.slice(1, 4); return image; },
  });
  assert.deepEqual(pinned, ['tiles.example.test', '8.8.8.8', 4]);
  assert.deepEqual(tile.body, image.body);
});

test('map tile proxy rejects private, mixed, and special-purpose DNS answers', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.2.1', '192.168.1.2', '::1', 'fc00::1', '2001:db8::1'])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(fetchPublicMapTile('https://tiles.example.test/a.png', {
    lookup: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
    request: async () => { throw new Error('must not connect'); },
  }), /not public/);
});

test('map tile redirects re-resolve and re-pin each public host', async () => {
  const hosts = [];
  const pins = [];
  const result = await fetchPublicMapTile('https://tiles.example.test/a.png', {
    lookup: async (host) => {
      hosts.push(host);
      return [{ address: host === 'tiles.example.test' ? '8.8.8.8' : '1.1.1.1', family: 4 }];
    },
    request: async (_url, host, address) => {
      pins.push([host, address]);
      return host === 'tiles.example.test'
        ? { status: 302, location: 'https://cdn.example.test/a.png' }
        : image;
    },
  });
  assert.deepEqual(hosts, ['tiles.example.test', 'cdn.example.test']);
  assert.deepEqual(pins, [['tiles.example.test', '8.8.8.8'], ['cdn.example.test', '1.1.1.1']]);
  assert.deepEqual(result.body, image.body);
});

test('map tile proxy rejects credentials, unsupported ports, and non-HTTP URLs before DNS', async () => {
  const lookup = async () => { throw new Error('DNS must not run'); };
  for (const url of [
    'https://user:secret@tiles.example.test/a.png',
    'ftp://tiles.example.test/a.png',
    'https://tiles.example.test:444/a.png',
  ]) {
    await assert.rejects(fetchPublicMapTile(url, { lookup }), /Unsupported|Invalid/);
  }
});

test('proxy failures return a generic response without echoing the input URL', async () => {
  const secretUrl = 'http://user:private-token@127.0.0.1:8080/private.png';
  const response = await proxyMapTileRequest(new Request(
    `https://app.example/api/map-tile?url=${encodeURIComponent(secretUrl)}`,
  ));
  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'Map tile unavailable');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
