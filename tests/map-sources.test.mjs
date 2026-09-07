import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { writeArrayBuffer } from 'geotiff';
import {
  onlineDraft,
  parseMapConfig,
  resolveMapInput,
} from '../modules/mapSources/online.ts';
import {
  mbtilesInfo,
  mbtile,
  openMbtiles,
} from '../modules/mapSources/mbtiles.ts';
import { decodeGeoTiff } from '../modules/mapSources/geotiff.ts';

test('online templates normalize WMTS and retain TMS/TileJSON limits', () => {
  const xyz = parseMapConfig('https://tiles.example.org/{z}/{x}/{y}.png')[0];
  assert.equal(xyz.scheme, 'xyz');
  const wmts = parseMapConfig(
    'https://tiles.example.org/wmts?service=WMTS&TileMatrixSet=GoogleMapsCompatible&TileMatrix={TileMatrix}&TileCol={TileCol}&TileRow={TileRow}',
  )[0];
  assert.equal(wmts.format, 'WMTS');
  assert.match(wmts.tiles[0], /TileRow=\{y\}/);
  const tj = parseMapConfig(
    JSON.stringify({
      tilejson: '3.0.0',
      tiles: ['tiles/{z}/{x}/{y}.png'],
      scheme: 'tms',
      minzoom: 3,
      maxzoom: 16,
      bounds: [100, 20, 110, 35],
    }),
    'https://tiles.example.org/maps/config.json',
  )[0];
  assert.equal(tj.scheme, 'tms');
  assert.equal(
    tj.tiles[0],
    'https://tiles.example.org/maps/tiles/{z}/{x}/{y}.png',
  );
  assert.equal(tj.minzoom, 3);
  assert.equal(tj.format, 'TileJSON');
});
test('WMS requires explicit Mercator bbox; unknown tokens/projections rejected', () => {
  const wms =
    'https://maps.example.org/wms?SERVICE=WMS&REQUEST=GetMap&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&LAYERS=a&WIDTH=256&HEIGHT=256';
  assert.equal(parseMapConfig(wms)[0].format, 'WMS');
  assert.throws(
    () => parseMapConfig(wms.replace('3857&BBOX', '4326&BBOX')),
    /EPSG:3857/,
  );
  for (const url of [
    'http://tiles.example.org/{z}/{x}/{y}',
    'https://u:p@tiles.example.org/{z}/{x}/{y}',
    'javascript:alert(1)',
  ])
    assert.throws(() => onlineDraft({ url }));
  assert.throws(
    () => onlineDraft({ url: 'https://{s}.example.org/{z}/{x}/{y}' }),
    /占位符/,
  );
  assert.throws(
    () =>
      onlineDraft({
        url: 'https://tiles.example.org/{z}/{x}/{y}',
        crs: 'GCJ-02',
      }),
    /GCJ/,
  );
  assert.throws(
    () =>
      onlineDraft({
        url: 'https://tiles.example.org/{z}/{x}/{y}',
        minzoom: 10,
        maxzoom: 5,
      }),
    /最大/,
  );
});
test('configs refuse proprietary, scripted XML, vector and oversized inputs', () => {
  const xml =
    '<customMapSource><name>测试</name><minZoom>2</minZoom><maxZoom>15</maxZoom><url>https://tiles.example.org/{$z}/{$x}/{$y}.png</url></customMapSource>';
  assert.equal(parseMapConfig(xml)[0].minzoom, 2);
  assert.throws(
    () =>
      parseMapConfig(
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///local">]><x>&e;</x>',
      ),
    /XML/,
  );
  assert.throws(() => parseMapConfig('ovitalmap://encrypted'), /专有/);
  assert.throws(() => parseMapConfig('x'.repeat(1024 * 1024 + 1)), /1 MB/);
  assert.throws(
    () =>
      onlineDraft({
        tiles: ['https://tiles.example.org/{z}/{x}/{y}'],
        vector_tiles: [],
      }),
    /矢量/,
  );
  assert.throws(
    () =>
      parseMapConfig(JSON.stringify(Array.from({ length: 21 }, () => ({})))),
    /20/,
  );
});
test('URL config reads are bounded and resolve relative tiles', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ tiles: ['./{z}/{x}/{y}.png'] }));
    assert.equal(
      (
        await resolveMapInput(
          'https://maps.example.org/c.json',
          new AbortController().signal,
        )
      )[0].tiles[0],
      'https://maps.example.org/{z}/{x}/{y}.png',
    );
    globalThis.fetch = async () => new Response('x'.repeat(1024 * 1024 + 1));
    await assert.rejects(
      () =>
        resolveMapInput(
          'https://maps.example.org/c.json',
          new AbortController().signal,
        ),
      /1 MB/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
const SQL = await initSqlJs();
const tile = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
function fixture() {
  const db = new SQL.Database();
  db.run(
    'CREATE TABLE metadata(name TEXT,value TEXT); CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB); CREATE UNIQUE INDEX tile_index ON tiles(zoom_level,tile_column,tile_row)',
  );
  db.run("INSERT INTO metadata VALUES('name','合成地图'),('format','png')");
  db.run('INSERT INTO tiles VALUES(?,?,?,?)', [2, 3, 2, tile]);
  return db;
}
test('MBTiles actual SQL: TMS row inversion, inferred bounds, missing tiles and round trip', () => {
  const db = fixture();
  try {
    const info = mbtilesInfo(db, 'file');
    assert.equal(info.draft.name, '合成地图');
    assert.equal(info.draft.minzoom, 2);
    assert.equal(info.draft.bounds[0], 90);
    assert.equal(info.draft.bounds[2], 180);
    assert.equal(info.draft.bounds[1], 0);
    assert.ok(info.draft.bounds[3] > 66);
    assert.deepEqual(mbtile(db, 2, 3, 1), tile);
    assert.equal(mbtile(db, 2, 3, 2), undefined);
    assert.throws(() => mbtile(db, 2, 5, 0), /编号/);
    const restored = openMbtiles(SQL, db.export().buffer);
    assert.deepEqual(mbtile(restored, 2, 3, 1), tile);
    restored.close();
  } finally {
    db.close();
  }
});
test('MBTiles rejects invalid schema, vector tiles and invalid coordinates', () => {
  const db = fixture();
  try {
    db.run("UPDATE metadata SET value='pbf' WHERE name='format'");
    assert.throws(() => mbtilesInfo(db, 'file'), /矢量/);
    db.run("UPDATE metadata SET value='png' WHERE name='format'");
    db.run('UPDATE tiles SET tile_row=99');
    assert.throws(() => mbtilesInfo(db, 'file'), /编号/);
  } finally {
    db.close();
  }
  assert.throws(() => openMbtiles(SQL, new ArrayBuffer(20)), /SQLite/);
});
function tiff(metadata = {}) {
  const width = 8,
    height = 8,
    pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = x < 4 ? 255 : 0;
      pixels[i + 1] = y < 4 ? 255 : 0;
      pixels[i + 2] = 50;
    }
  return writeArrayBuffer(pixels, {
    width,
    height,
    BitsPerSample: [8, 8, 8],
    SamplesPerPixel: 3,
    PhotometricInterpretation: 2,
    ModelPixelScale: [0.1, 0.1, 0],
    ModelTiepoint: [0, 0, 0, 103, 31, 0],
    GeographicTypeGeoKey: 4326,
    GTModelTypeGeoKey: 2,
    GTRasterTypeGeoKey: 1,
    ...metadata,
  });
}
test('GeoTIFF is georeferenced and reprojected to a bounded Mercator image', async () => {
  const result = await decodeGeoTiff(tiff(), 'test');
  assert.equal(result.draft.format, 'GeoTIFF');
  assert.ok(
    Math.abs(result.draft.bounds[0] - 103) < 0.0001 &&
      Math.abs(result.draft.bounds[3] - 31) < 0.0001,
  );
  assert.equal(Math.max(result.width, result.height), 2048);
  const center =
    (Math.floor(result.height * 0.25) * result.width +
      Math.floor(result.width * 0.25)) *
    4;
  assert.deepEqual(
    [...result.pixels.slice(center, center + 4)],
    [255, 255, 50, 255],
  );
});
test('GeoTIFF accepts WGS84 UTM, rejects unknown CRS and point rasters', async () => {
  const utm = await decodeGeoTiff(
    tiff({
      ProjectedCSTypeGeoKey: 32648,
      GTModelTypeGeoKey: 1,
      ModelTiepoint: [0, 0, 0, 500000, 3400000, 0],
      ModelPixelScale: [10, 10, 0],
    }),
    'utm',
  );
  assert.ok(Math.abs(utm.draft.bounds[0] - 105) < 0.01);
  await assert.rejects(
    () => decodeGeoTiff(tiff({ ProjectedCSTypeGeoKey: 4490 }), 'bad'),
    /坐标系/,
  );
  await assert.rejects(
    () => decodeGeoTiff(tiff({ GTRasterTypeGeoKey: 2 }), 'point'),
    /PixelIsPoint/,
  );
});
