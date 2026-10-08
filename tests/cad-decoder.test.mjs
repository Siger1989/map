import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeCad } from '../modules/cad/decoder.ts';

const asBuffer = (source) => new TextEncoder().encode(source).buffer;
const dxf = (body) => `0\nSECTION\n2\nENTITIES\n${body}\n0\nENDSEC\n0\nEOF\n`;

test('decodes the upstream real DWG fixture through the local WASM runtime', async () => {
  const bytes = await readFile(new URL('./fixtures/cad/sample_2000.dwg', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await decodeCad(buffer, 'sample_2000.dwg');
  assert.equal(result.format, 'dwg');
  assert.ok(result.features.length > 0);
  assert.ok(result.features.some((feature) => feature.entityType === 'LINE'));
  assert.ok(result.layers.length > 0);
});

test('decodes common ASCII DXF entities and keeps raw CAD coordinates', async () => {
  const result = await decodeCad(asBuffer(dxf([
    '0\nLINE\n5\nA1\n8\nRoad\n10\n100\n20\n200\n30\n3\n11\n110\n21\n220\n31\n4',
    '0\nPOINT\n5\nA2\n8\nSurvey\n10\n5\n20\n6\n30\n7',
    '0\nTEXT\n5\nA3\n8\nNotes\n10\n8\n20\n9\n30\n0\n40\n2.5\n1\nBorehole',
    '0\nATTRIB\n5\nA4\n8\nNotes\n10\n9\n20\n10\n30\n0\n1\nSample ID'
  ].join('\n'))), 'sample.dxf');
  assert.equal(result.format, 'dxf');
  assert.deepEqual(result.features[0].geometry.coordinates, [[100, 200, 3], [110, 220, 4]]);
  assert.equal(result.features[1].geometry.type, 'Point');
  assert.equal(result.features[2].text, 'Borehole');
  assert.deepEqual(result.features.map((feature) => feature.id), ['A1', 'A2', 'A3', 'A4']);
  assert.equal(result.features[3].text, 'Sample ID');
});

test('preserves a complete long WKT CRS before nested authority EPSG tokens', async () => {
  const wkt = `PROJCS["Local grid",GEOGCS["Datum",DATUM["Example datum",SPHEROID["Example ellipsoid",6378137,298.257223563],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",111],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","32649"]]`;
  assert.ok(wkt.length > 256);
  const source = `0\nSECTION\n2\nHEADER\n9\n$CRS_WKT\n1\n${wkt}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`;
  const result = await decodeCad(asBuffer(source), 'wkt-crs.dxf');
  assert.equal(result.crsHint, wkt);
  assert.ok(!result.crsHint.startsWith('EPSG:'));
});

test('ignores an overlong WKT CRS without truncating and prompts for manual selection', async () => {
  const wkt = `PROJCS["${'x'.repeat(8200)}",AUTHORITY["EPSG","32649"]]`;
  const source = `0\nSECTION\n2\nHEADER\n9\n$CRS_WKT\n1\n${wkt}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`;
  const result = await decodeCad(asBuffer(source), 'long-wkt.dxf');
  assert.equal(result.crsHint, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes('超过 8192 字符') && warning.includes('手动选择')));
});

test('applies block base, scale, rotation and translation and samples curve geometry', async () => {
  const source = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC
0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nSYMBOL\n10\n1\n20\n2\n30\n0
0\nLINE\n5\nB1\n8\n0\n10\n2\n20\n2\n30\n0\n11\n3\n21\n2\n31\n0
0\nCIRCLE\n5\nBC1\n8\n0\n10\n1\n20\n2\n30\n0\n40\n5
0\nENDBLK\n0\nENDSEC
0\nSECTION\n2\nENTITIES
0\nINSERT\n5\nI1\n8\nBlocks\n2\nSYMBOL\n10\n10\n20\n20\n30\n0\n41\n2\n42\n1\n43\n1\n50\n90
0\nCIRCLE\n5\nC1\n8\nRound\n10\n1\n20\n2\n40\n5
0\nENDSEC\n0\nEOF\n`;
  const result = await decodeCad(asBuffer(source), 'blocks.dxf');
  assert.equal(result.units, 'meters');
  assert.equal(result.unitScale, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [[10, 22, 0], [10, 24, 0]]);
  assert.equal(result.features[1].geometry.type, 'Polygon');
  const transformedCircle = result.features[1].geometry.coordinates[0];
  assert.ok(transformedCircle.length > 30);
  assert.ok(Math.max(...transformedCircle.map((point) => point[0])) - Math.min(...transformedCircle.map((point) => point[0])) > 9.9);
  assert.ok(Math.max(...transformedCircle.map((point) => point[1])) - Math.min(...transformedCircle.map((point) => point[1])) > 19.9);
  assert.equal(result.features[2].geometry.type, 'Polygon');
  assert.ok(result.warnings.some((warning) => warning.includes('CIRCLE') && warning.includes('离散近似')));
});

test('rejects files over the input cap and reports unsupported OCS instead of shifting it', async () => {
  await assert.rejects(() => decodeCad(new ArrayBuffer(20 * 1024 * 1024 + 1), 'large.dxf'), /20 MB/);
  const result = await decodeCad(asBuffer(dxf('0\nCIRCLE\n5\nC1\n8\n0\n10\n1\n20\n2\n40\n4\n210\n0\n220\n1\n230\n0')), 'ocs.dxf');
  assert.equal(result.features.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('非默认 OCS')));
});

test('enforces the entity-count cap', async () => {
  const entities = Array.from({ length: 20_001 }, (_, index) => `0\nPOINT\n10\n${index}\n20\n0`).join('\n');
  await assert.rejects(() => decodeCad(asBuffer(dxf(entities)), 'too-many.dxf'), /20000/);
});
