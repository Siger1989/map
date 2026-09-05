import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function bundle(path) {
  const output = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { parseCapabilities } = await bundle('modules/geology/geocloud/capabilities.ts');
const { projectionPlan, tileInMatrix } = await bundle('modules/geology/geocloud/projection.ts');
const { geocloudResponse } = await bundle('modules/geology/geocloud/server.ts');

// Synthetic protocol fixtures only; these do not establish live 200k coverage.
const caps = ({ crs = 'urn:ogc:def:crs:EPSG::4326', origin = '90 -180', title = '全国1:20万地质图', legend = '', limit = '' } = {}) => `
<Capabilities xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Contents><Layer><ows:Identifier>geology</ows:Identifier><ows:Title>${title}</ows:Title>
    <Format>image/png</Format><Style isDefault="true"><ows:Identifier>original</ows:Identifier>${legend}</Style>
    <TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet>${limit}</TileMatrixSetLink>
  </Layer><TileMatrixSet><ows:Identifier>grid</ows:Identifier><ows:SupportedCRS>${crs}</ows:SupportedCRS>
    <TileMatrix><ows:Identifier>level-not-xyz</ows:Identifier><ScaleDenominator>${0.0439453125 * 111319.49079327358 / 0.00028}</ScaleDenominator>
      <TopLeftCorner>${origin}</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>32</MatrixWidth><MatrixHeight>16</MatrixHeight>
    </TileMatrix></TileMatrixSet></Contents>
</Capabilities>`;

test('capabilities preserve native grid IDs and handle EPSG axis order', () => {
  const data = parseCapabilities(caps());
  assert.equal(data.title, '全国1:20万地质图');
  assert.equal(data.style, 'original');
  assert.equal(data.matrixSet, 'grid');
  assert.equal(data.matrices[0].id, 'level-not-xyz');
  assert.deepEqual(data.matrices[0].origin, [-180, 90]);
  assert.deepEqual(parseCapabilities(caps({ origin: '-180 90' })).matrices[0].origin, [-180, 90]);
  assert.equal(data.projection, 'geographic');
});

test('do not label coarse, wrong-theme, unknown-CRS or malformed data as 200k', () => {
  assert.throws(() => parseCapabilities(caps({ title: '全国1:50万地质图' })), /未确认/);
  assert.throws(() => parseCapabilities(caps({ title: '全国1:2000000地质图' })), /未确认/);
  assert.throws(() => parseCapabilities(caps({ title: '全国1:20万、1:25万地质图' })), /未确认/);
  assert.throws(() => parseCapabilities(caps({ title: '全国1:20万水文地质图' })), /未确认/);
  assert.throws(() => parseCapabilities(caps({ crs: 'EPSG:9999' })), /坐标系/);
  assert.throws(() => parseCapabilities('<!DOCTYPE x><Capabilities/>'), /元数据/);
  assert.throws(() => parseCapabilities('Token失效，请重新登录'), /元数据/);
  assert.throws(() => parseCapabilities(caps(), 'missing-layer'), /所配置/);
});

test('reprojection maps a known Chengdu coordinate into the correct geographic pixel', () => {
  const metadata = parseCapabilities(caps());
  const lng = 104.066, lat = 30.659, z = 9, n = 2 ** z;
  const targetX = (lng + 180) / 360 * n;
  const targetY = (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * n;
  const plan = projectionPlan(metadata, z, Math.floor(targetX), Math.floor(targetY));
  const px = Math.floor((targetX % 1) * 256), py = Math.floor((targetY % 1) * 256);
  const actualLng = -180 + (plan.xs[px] + 0.5) * plan.matrix.resolution;
  const actualLat = 90 - (plan.ys[py] + 0.5) * plan.matrix.resolution;
  assert.ok(Math.abs(actualLng - lng) < plan.matrix.resolution);
  assert.ok(Math.abs(actualLat - lat) < plan.matrix.resolution);
  assert.ok(plan.tiles.length <= 16);
  assert.equal(plan.matrix.id, 'level-not-xyz');
  assert.throws(() => projectionPlan(metadata, 5, 32, 0), /无效/);
});

test('Mercator grids keep pixel continuity across neighbouring output tiles', () => {
  const half = 20037508.342789244;
  const data = { projection: 'mercator', matrices: [{ id: 'level-7', resolution: 2 * half / 8 / 256,
    origin: [-half, half], tileWidth: 256, tileHeight: 256, width: 8, height: 8 }] };
  const a = projectionPlan(data, 3, 6, 3), b = projectionPlan(data, 3, 7, 3);
  assert.deepEqual(a.tiles, [{ col: 6, row: 3 }]);
  assert.equal(a.xs[0], 6 * 256);
  assert.equal(b.xs[0] - a.xs[255], 1);
  assert.deepEqual(a.ys, b.ys);
});

test('WMTS matrix limits prevent out-of-coverage upstream requests', () => {
  const limit = '<TileMatrixSetLimits><TileMatrixLimits><TileMatrix>level-not-xyz</TileMatrix><MinTileRow>2</MinTileRow><MaxTileRow>3</MaxTileRow><MinTileCol>4</MinTileCol><MaxTileCol>5</MaxTileCol></TileMatrixLimits></TileMatrixSetLimits>';
  const metadata = parseCapabilities(caps({ limit }));
  assert.equal(tileInMatrix(metadata.matrices[0], 4, 2), true);
  assert.equal(tileInMatrix(metadata.matrices[0], 3, 2), false);
  assert.deepEqual(projectionPlan(metadata, 9, 404, 210).tiles, []);
});

test('proxy keeps keys server-side and recognizes HTTP-200 authorization errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GEOCLOUD_TOKEN;
  try {
    delete process.env.GEOCLOUD_TOKEN;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('Token失效，请重新登录'); };
    const missing = await geocloudResponse(new Request('http://localhost/api/geology/geocloud?request=capabilities'));
    assert.equal(missing.status, 503);
    assert.equal(calls, 0);
    process.env.GEOCLOUD_TOKEN = 'fixture-only-expired';
    const expired = await geocloudResponse(new Request('http://localhost/api/geology/geocloud?request=capabilities'));
    assert.equal(expired.status, 401);
    assert.ok(!(await expired.text()).includes('fixture-only-expired'));

    process.env.GEOCLOUD_TOKEN = 'fixture-only-valid';
    let tileParams;
    globalThis.fetch = async (request, options) => {
      const url = new URL(request);
      assert.equal(url.origin, 'https://geocloud.cgs.gov.cn');
      assert.equal(options.redirect, 'error');
      assert.equal(url.searchParams.get('tk'), 'fixture-only-valid');
      if (url.searchParams.get('REQUEST') === 'GetCapabilities') return new Response(caps({
        legend: '<LegendURL xlink:href="https://geocloud.cgs.gov.cn/legend.png?tk=fixture-only-valid"/>',
      }));
      tileParams = url.searchParams;
      // Header fixture suffices for proxy validation; raster decoding is separate.
      return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    };
    const metadata = await geocloudResponse(new Request('http://localhost/api/geology/geocloud?request=capabilities'));
    assert.equal(metadata.status, 200);
    const json = await metadata.text();
    assert.ok(!json.includes('fixture-only-valid'));
    assert.ok(!json.includes('legendUrl'));
    assert.equal(JSON.parse(json).hasLegend, true);
    const tile = await geocloudResponse(new Request('http://localhost/api/geology/geocloud?request=tile&matrix=level-not-xyz&col=24&row=5'));
    assert.equal(tile.status, 200);
    assert.equal(tileParams.get('TILEMATRIXSET'), 'grid');
    assert.equal(tileParams.get('TILEMATRIX'), 'level-not-xyz');
    assert.equal(tile.headers.get('Cache-Control'), 'no-store');
    const invalid = await geocloudResponse(new Request('http://localhost/api/geology/geocloud?request=tile&matrix=level-not-xyz&col=32&row=5'));
    assert.equal(invalid.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GEOCLOUD_TOKEN; else process.env.GEOCLOUD_TOKEN = originalToken;
  }
});
