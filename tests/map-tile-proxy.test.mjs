import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPublicMapTile,
  isPublicAddress,
  proxyMapTileRequest,
} from '../tools/map-tile-proxy.mjs';

const image = { status: 200, mime: 'image/png', body: Buffer.from([137, 80, 78, 71]) };
const png = {
  status: 200,
  mime: 'image/png',
  body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
};

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

test('the fixed Terrarium URL may use only the managed RFC2544 HTTPS relay path', async () => {
  let pinned;
  const tileUrl = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png';
  const tile = await fetchPublicMapTile(tileUrl, {
    lookup: async () => [{ address: '198.18.0.111', family: 4 }],
    request: async (...args) => { pinned = args.slice(1, 4); return png; },
  });
  assert.deepEqual(pinned, ['elevation-tiles-prod.s3.amazonaws.com', '198.18.0.111', 4]);
  assert.deepEqual(tile.body, png.body);

  const rejected = [
    ['https://tiles.example.test/terrarium/12/3227/1670.png', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com.evil.test/terrarium/12/3227/1670.png', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/private/12/3227/1670.png', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/15/1/1.png', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/4096/1.png', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png?x=1', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png#x', [{ address: '198.18.0.111', family: 4 }]],
    ['https://user:pass@elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png', [{ address: '198.18.0.111', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png', [{ address: '198.18.0.111', family: 4 }, { address: '8.8.8.8', family: 4 }]],
    ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png', [{ address: '127.0.0.1', family: 4 }]],
  ];
  for (const [url, records] of rejected) {
    let requested = false;
    await assert.rejects(fetchPublicMapTile(url, {
      lookup: async () => records,
      request: async () => { requested = true; return png; },
    }), /not public|Unsupported/);
    assert.equal(requested, false, url);
  }
});

test('the managed Terrarium relay rejects redirects and non-PNG bodies', async () => {
  const url = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3227/1670.png';
  const lookup = async () => [{ address: '198.18.0.111', family: 4 }];
  await assert.rejects(fetchPublicMapTile(url, {
    lookup,
    request: async () => ({ status: 302, location: 'https://cdn.example.test/tile.png' }),
  }), /redirects are not allowed/);
  await assert.rejects(fetchPublicMapTile(url, {
    lookup,
    request: async () => ({ status: 200, mime: 'image/jpeg', body: Buffer.from('not a png') }),
  }), /PNG/);
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
