import assert from 'node:assert/strict';
import test from 'node:test';
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import { getTerrainPrintDem, TerrainPrintDemError } from '../modules/terrainPrint/dem.ts';
import { POST } from '../app/api/terrain-print/route.ts';

const file = 'https://data.nsidc.earthdatacloud.nasa.gov/nsidc-cumulus-prod-protected/HMA/HMA_DEM8m_MOS/1/2002/01/28/HMA_DEM8m_MOS_20170716_tile-592.tif';
const eastFile = file.replace('tile-592.tif', 'tile-593.tif');
const bounds = { west: 101.8788, south: 29.5952, east: 101.87895, north: 29.59534 };
const selection = { bounds, shape: 'rectangle' };
const catalog = (links = [file]) => Response.json({
  feed: {
    entry: links.map((href) => ({ links: [{ href }] })),
  },
});

function createTile(originLongitude = 85) {
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
    GeoDoubleParams: [25, 47, originLongitude, 36, 0, 0],
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
  assert.equal(grid.sampleSpacingMeters, 8);
  assert.equal(grid.elevations.length, 9);
  assert.ok(grid.elevations.every(Number.isFinite));
  assert.ok(grid.elevations.at(-1) > grid.elevations[0]);
  assert.ok(ranges >= 1);
});

test('a CRS mismatch gets exactly one independent header read before raster sampling', async () => {
  for (const scenario of ['remote recovery', 'cache recovery', 'persistent mismatch']) {
    const bad = createTile(87), good = createTile();
    const headerRanges = [];
    const options = {
      useTransportAuthorization: true,
      cachedTile: scenario === 'cache recovery' ? () => fromArrayBuffer(bad) : undefined,
      fetch: async (url, init) => {
        if (String(url).startsWith('https://cmr.earthdata.nasa.gov/')) return catalog();
        const range = new Headers(init.headers).get('Range');
        const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (Number(first) === 0) headerRanges.push(range);
        const source = scenario === 'persistent mismatch' ||
          (scenario === 'remote recovery' && headerRanges.length === 1) ? bad : good;
        const end = Math.min(Number(last), source.byteLength - 1);
        return new Response(source.slice(Number(first), end + 1), {
          status: 206, headers: { 'Content-Range': `bytes ${first}-${end}/${source.byteLength}` },
        });
      },
    };
    const grid = getTerrainPrintDem(selection, options);
    if (scenario === 'persistent mismatch') {
      await assert.rejects(grid, e => e.code === 'DEM_UNAVAILABLE' &&
        /tile-592.*ProjNatOriginLongGeoKey.*87.*85/.test(e.message));
    } else {
      assert.ok((await grid).elevations.every(Number.isFinite));
    }
    assert.equal(headerRanges.length, scenario === 'cache recovery' ? 1 : 2);
    assert.equal(new Set(headerRanges).size, headerRanges.length);
  }
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

test('Android gateway can authorize protected TIFF downloads without exposing a token to JavaScript', async () => {
  const tiff = createTile();
  const gateway = (status = 206) => async (url, options) => {
    assert.equal(new Headers(options?.headers).get('Authorization'), null);
    if (String(url).startsWith('https://cmr.earthdata.nasa.gov/')) return catalog();
    assert.equal(url, file);
    if (status !== 206) return new Response(null, { status });
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('Range'));
    const start = Number(first), end = Math.min(Number(last), tiff.byteLength - 1);
    return new Response(tiff.slice(start, end + 1), {
      status,
      headers: { 'Content-Range': `bytes ${start}-${end}/${tiff.byteLength}` },
    });
  };
  const getGrid = fetch => getTerrainPrintDem(selection, { useTransportAuthorization: true, fetch });
  assert.ok((await getGrid(gateway())).elevations.every(Number.isFinite));
  await assert.rejects(getGrid(gateway(428)), { code: 'AUTH_REQUIRED' });
  await assert.rejects(getGrid(gateway(401)), { code: 'AUTH_INVALID' });
});

test('rejects out-of-policy catalog URLs and ranges too big to model', async () => {
  await assert.rejects(
    getTerrainPrintDem(selection, { fetch: async () => catalog(['https://example.org/tile-592.tif']) }),
    (error) => error.code === 'DEM_UNAVAILABLE',
  );
  await assert.rejects(
    getTerrainPrintDem({ ...selection, bounds: { ...bounds, east: 103, north: 30 } }, {
      fetch: async () => assert.fail('oversize requests must not call the provider'),
    }),
    (error) => error.code === 'AREA_TOO_LARGE',
  );
});

function createTiledDemFixture(bounds) {
  const convert = proj4('EPSG:4326', '+proj=aea +lat_1=25 +lat_2=47 +lat_0=36 +lon_0=85 +x_0=0 +y_0=0 +datum=WGS84 +units=m');
  const corners = [[bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.west, bounds.south], [bounds.east, bounds.south]].map(point => convert.forward(point));
  const left = Math.floor(Math.min(...corners.map(([x]) => x)) / 8) * 8 - 24;
  const top = Math.ceil(Math.max(...corners.map(([, y]) => y)) / 8) * 8 + 24;
  const width = Math.ceil((Math.max(...corners.map(([x]) => x)) - left) / 8) + 4;
  const height = Math.ceil((top - Math.min(...corners.map(([, y]) => y))) / 8) + 4;
  const split = Math.floor(width / 2);
  const readWindows = [];

  function tile(offset, width, value) {
    return {
      close() {},
      getImage() {
        return {
          getGeoKeys: () => ({
            ProjectedCSTypeGeoKey: 32767,
            GeographicTypeGeoKey: 4326,
            ProjCoordTransGeoKey: 11,
            ProjLinearUnitsGeoKey: 9001,
            ProjNatOriginLatGeoKey: 36,
            ProjNatOriginLongGeoKey: 85,
            ProjStdParallel1GeoKey: 25,
            ProjStdParallel2GeoKey: 47,
            ProjFalseEastingGeoKey: 0,
            ProjFalseNorthingGeoKey: 0,
          }),
          getOrigin: () => [left + offset * 8, top],
          getResolution: () => [8, -8],
          getSamplesPerPixel: () => 1,
          getWidth: () => width, getHeight: () => height,
          getTileWidth: () => 256, getTileHeight: () => 256,
          getGDALNoData: () => -9999,
          readRasters: async ({ window }) => {
            const [x0, y0, x1, y1] = window;
            assert.ok(x0 >= 0 && x1 <= width && y0 >= 0 && y1 <= height);
            const pixels = (x1 - x0) * (y1 - y0);
            assert.ok(pixels <= 1_048_576, 'native source raster windows stay bounded');
            readWindows.push({ value, pixels });
            return new Float32Array(pixels).fill(value);
          },
        };
      },
    };
  }

  return {
    readWindows,
    async fetch() { return catalog([file, eastFile]); },
    async cachedTile(filename) {
      return filename.endsWith('tile-592.tif') ? tile(0, split, 1111) : tile(split, width - split, 2222);
    },
  };
}

test('larger rectangles automatically coarsen the output grid and preserve elevations across TIFFs', async () => {
  const wideBounds = { west: 101.83, south: 29.55, east: 101.94, north: 29.65 };
  const fixture = createTiledDemFixture(wideBounds);
  const grid = await getTerrainPrintDem({ shape: 'rectangle', bounds: wideBounds }, fixture);
  assert.ok(grid.eastWestMeters > 10_000 && grid.eastWestMeters < 11_000);
  assert.ok(grid.northSouthMeters > 11_000 && grid.northSouthMeters < 12_000);
  assert.ok(grid.width * grid.height <= 240_000);
  assert.ok(grid.sampleSpacingMeters > 8 && grid.sampleSpacingMeters < 25);
  assert.ok(grid.elevations.every(value => value === 1111 || value === 2222));
  assert.equal(grid.elevations[0], 1111);
  assert.equal(grid.elevations[grid.width - 1], 2222);
  assert.deepEqual(new Set(fixture.readWindows.map(item => item.value)), new Set([1111, 2222]));
  assert.ok(fixture.readWindows.length > 2, 'large source TIFFs are read in batches');
});

test('wide strips and circular square bounds respect grid side and padded mesh budgets', async () => {
  const stripBounds = { west: 101.73, south: 29.595, east: 102.03, north: 29.5954 };
  const strip = await getTerrainPrintDem({ shape: 'rectangle', bounds: stripBounds }, createTiledDemFixture(stripBounds));
  assert.ok(strip.eastWestMeters > 25_000 && strip.width <= 1600 && strip.sampleSpacingMeters > 8);
  assert.ok(strip.elevations.every(Number.isFinite));

  const center = (bounds.east + bounds.west) / 2;
  const latitude = 29.6;
  const halfDegrees = 0.03;
  const longitudeDelta = halfDegrees / Math.cos(latitude * Math.PI / 180);
  const circleBounds = { west: center - longitudeDelta, south: latitude - halfDegrees, east: center + longitudeDelta, north: latitude + halfDegrees };
  const round = await getTerrainPrintDem({ shape: 'circle', bounds: circleBounds }, createTiledDemFixture(circleBounds));
  assert.ok(round.sampleSpacingMeters > 8);
  assert.ok(Math.abs(round.eastWestMeters / round.northSouthMeters - 1) < 0.01);
  const paddedSide = (n) => Math.max(17, n + (n % 2 === 0 ? 1 : 0));
  assert.ok(paddedSide(round.width) * paddedSide(round.height) <= 250_000);
  assert.ok(round.elevations.every(Number.isFinite));
});

test('the provider still enforces the maximum catalogue footprint', async () => {
  await assert.rejects(
    getTerrainPrintDem(selection, { fetch: async () => catalog(Array(9).fill(file)) }),
    (error) => error.code === 'AREA_TOO_LARGE' && error.status === 422,
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

test('an independent native TIFF header must confirm the projection, dimensions and resolution', async () => {
  const good = createTile(), bad = createTile(87);
  const reader = await fromArrayBuffer(good);
  const image = await reader.getImage();
  const [originX, originY] = image.getOrigin();
  const [pixelWidth, pixelHeight] = image.getResolution();
  const header = { ...image.getGeoKeys(), width: image.getWidth(), height: image.getHeight(), originX, originY, pixelWidth, pixelHeight };
  await reader.close();

  async function sample(bytes, nativeHeader) {
    return getTerrainPrintDem(selection, {
      useTransportAuthorization: true, nativeHeader,
      fetch: async (url, init) => {
        if (String(url).startsWith('https://cmr.earthdata.nasa.gov/')) return catalog();
        const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('Range'));
        const start = Number(first), end = Math.min(Number(last), bytes.byteLength - 1);
        return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + bytes.byteLength } });
      },
    });
  }
  const expected = await sample(good, () => assert.fail('A matching CRS needs no native fallback'));
  let reads = 0;
  const recovered = await sample(bad, async (url, signal) => {
    assert.equal(url, file);
    assert.equal(signal.aborted, false);
    reads++;
    return header;
  });
  assert.equal(reads, 1);
  assert.deepEqual(recovered.elevations, expected.elevations);
  for (const fields of [{ width: header.width + 1 }, { pixelHeight: -9 }, { ProjNatOriginLongGeoKey: 87 }]) {
    await assert.rejects(sample(bad, async () => ({ ...header, ...fields })), { code: 'DEM_UNAVAILABLE' });
  }
});
