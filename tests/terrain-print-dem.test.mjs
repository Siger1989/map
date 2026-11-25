import assert from 'node:assert/strict';
import test from 'node:test';
import { writeArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import { getTerrainPrintDem, TerrainPrintDemError } from '../modules/terrainPrint/dem.ts';
import { POST } from '../app/api/terrain-print/route.ts';

const file = 'https://data.nsidc.earthdatacloud.nasa.gov/nsidc-cumulus-prod-protected/HMA/HMA_DEM8m_MOS/1/2002/01/28/HMA_DEM8m_MOS_20170716_tile-592.tif';
const bounds = { west: 101.8788, south: 29.5952, east: 101.87895, north: 29.59534 };
const selection = { bounds, shape: 'rectangle' };
const catalog = (links = [file]) => Response.json({
  feed: {
    entry: links.map((href) => ({ links: [{ href }] })),
  },
});

function createTile() {
  const convert = proj4('EPSG:4326', '+proj=aea +lat_1=25 +lat_2=47 +lat_0=36 +lon_0=85 +x_0=0 +y_0=0 +datum=WGS84 +units=m');
  const [x, y] = convert.forward([bounds.west, bounds.north]);
  const data = Float32Array.from({ length: 4096 }, (_, index) => 3000 + Math.floor(index / 64) * 100 + index % 64);
  return writeArrayBuffer(data, {
    width: 64,
    height: 64,
    ModelPixelScale: [8, 8, 0],
    ModelTiepoint: [0, 0, 0, x - 80, y + 80, 0],
    GDAL_NODATA: '-9999',
    GeographicTypeGeoKey: 4326,
    GeoKeyDirectory: [
      1, 1, 0, 12,
      1024, 0, 1, 1,
      1025, 0, 1, 1,
      2048, 0, 1, 4326,
      3072, 0, 1, 32767,
      3075, 0, 1, 11,
      3076, 0, 1, 9001,
      3078, 34736, 1, 0,
      3079, 34736, 1, 1,
      3080, 34736, 1, 2,
      3081, 34736, 1, 3,
      3082, 34736, 1, 4,
      3083, 34736, 1, 5,
    ],
    GeoDoubleParams: [25, 47, 85, 36, 0, 0],
  });
}

test('a bounded selection queries NASA, range-reads a real TIFF and builds a north-first 8m grid', async () => {
  const tiff = createTile();
  let ranges = 0;
  const grid = await getTerrainPrintDem({ ...selection, token: 'test-only-token' }, {
    fetch: async (url, options) => {
      if (String(url).startsWith('https://cmr.earthdata.nasa.gov/')) {
        assert.equal(new URL(url).searchParams.get('bounding_box'), Object.values(bounds).join(','));
        assert.equal(new Headers(options.headers).get('Authorization'), null);
        return catalog();
      }
      assert.equal(url, file);
      assert.equal(options.redirect, 'manual');
      const headers = new Headers(options.headers);
      assert.equal(headers.get('Authorization'), 'Bearer test-only-token');
      const [, startRaw, endRaw] = headers.get('Range').match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(startRaw);
      const end = Math.min(Number(endRaw), tiff.byteLength - 1);
      ranges++;
      return new Response(tiff.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${tiff.byteLength}` },
      });
    },
  });
  assert.equal(grid.width, 3);
  assert.equal(grid.height, 3);
  assert.equal(grid.elevations.length, 9);
  assert.ok(grid.elevations.every(Number.isFinite));
  assert.ok(grid.elevations.at(-1) > grid.elevations[0]);
  assert.ok(ranges >= 1);
});

test('missing coverage, missing login and remote auth redirect have distinct errors', async () => {
  const rejectCode = (code) => (error) => error instanceof TerrainPrintDemError && error.code === code;
  await assert.rejects(getTerrainPrintDem(selection, { fetch: async () => catalog([]) }), rejectCode('NO_COVERAGE'));
  await assert.rejects(getTerrainPrintDem(selection, { fetch: async () => catalog() }), rejectCode('AUTH_REQUIRED'));
  await assert.rejects(getTerrainPrintDem({ ...selection, token: 'invalid-test-token' }, {
    fetch: async (url) => String(url).startsWith('https://cmr.earthdata.nasa.gov/')
      ? catalog()
      : Response.redirect('https://urs.earthdata.nasa.gov/oauth/authorize'),
  }), rejectCode('AUTH_INVALID'));
});

test('rejects out-of-policy catalog URLs and ranges too big to model', async () => {
  await assert.rejects(
    getTerrainPrintDem(selection, { fetch: async () => catalog(['https://example.org/tile-592.tif']) }),
    (error) => error.code === 'DEM_UNAVAILABLE',
  );
  await assert.rejects(
    getTerrainPrintDem({ ...selection, bounds: { ...bounds, east: 102, north: 30 } }, {
      fetch: async () => assert.fail('oversize requests must not call the provider'),
    }),
    (error) => error.code === 'AREA_TOO_LARGE',
  );
});

test('POST reports malformed or oversize input and sets no-store', async () => {
  for (const [body, status] of [['invalid json', 400], [' '.repeat(8193), 413]]) {
    const response = await POST(new Request('http://localhost/api/terrain-print', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).code, 'INVALID_SELECTION');
  }
});
