import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { identifyRouteFile, decodeRouteText } from '../modules/dataTransfer/fileFormat.ts';
import { parseFile } from '../modules/dataTransfer/fileImport.ts';
import { parseFiles } from '../modules/dataTransfer/batchImport.ts';

test('OVOBJ magic selects binary validation even under a misleading extension', async () => {
  // Synthetic header only; private user files never enter test fixtures.
  const bytes = new Uint8Array(858); bytes.set(strToU8('OviO'));
  for (const name of ['route.ovobj', 'route.gpx', 'route.json', 'route.kmz'])
    await assert.rejects(parseFile(new File([bytes], name)), /OVOBJ.*截断/);
  assert.equal(identifyRouteFile(strToU8('<gpx/>'), 'route.ovobj'), 'ovobj');
});

test('known unsupported formats, binary data and empty documents have actionable errors', async () => {
  for (const name of ['a.shp', 'a.dwg'])
    await assert.rejects(parseFile(new File([strToU8('binary')], name)), /尚未/);
  const fit = new Uint8Array(14); fit.set(strToU8('.FIT'), 8);
  await assert.rejects(parseFile(new File([fit], 'a.gpx')), /FIT/);
  await assert.rejects(parseFile(new File([], 'a.gpx')), /为空/);
  await assert.rejects(parseFile(new File([new Uint8Array([0,1,2])], 'a.gpx')), /未识别/);
  await assert.rejects(parseFile(new File(['PKbad'], 'a.kmz')), /压缩包/);
});

test('UTF-8 BOM and both UTF-16 BOMs decode without silently replacing broken bytes', () => {
  const xml = '<gpx>路线</gpx>';
  assert.equal(decodeRouteText(strToU8('\ufeff'+xml)), xml);
  const le = Buffer.from('\ufeff'+xml, 'utf16le');
  assert.equal(decodeRouteText(le), xml);
  assert.equal(decodeRouteText(Buffer.from(le).swap16()), xml);
  assert.throws(() => decodeRouteText(new Uint8Array([0xff,0x61,0x80])), /有效/);
});

test('JSON content selects backup validation; GeoJSON and malformed JSON do not masquerade as backups', async () => {
  const backup = { format:'guanyun-backup',version:1,tracks:[],annotations:[],favorites:[] };
  assert.deepEqual(await parseFile(new File([JSON.stringify(backup)], 'renamed.gpx')), backup);
  await assert.rejects(parseFile(new File(['{"type":"FeatureCollection","features":[]}'], 'a.json')), /没有可导入/);
  await assert.rejects(parseFile(new File(['{bad'], 'a.json')), /JSON 文件/);
});

test('ZIP recognition uses bytes; multi-document archives and expansion limits fail before XML', async () => {
  const zip = zipSync({ 'a.kml':strToU8('<kml/>'), 'b.kml':strToU8('<kml/>') });
  assert.equal(identifyRouteFile(zip, 'unknown.bin'), 'zip');
  await assert.rejects(parseFile(new File([zip], 'unknown.bin')), /一个 KML/);
  const bomb = zipSync({ 'doc.kml':new Uint8Array(8*1024*1024+1) });
  await assert.rejects(parseFile(new File([bomb], 'large.kmz')), /大小限制/);
});

test('one truncated OVOBJ prevents the entire batch reaching confirmation', async () => {
  const backup = new File([JSON.stringify({format:'guanyun-backup',version:1,tracks:[],annotations:[],favorites:[]})], 'a.json');
  const ovi = new File(['OviO'], 'b.ovobj');
  await assert.rejects(parseFiles([backup,ovi], parseFile), /b.ovobj.*OVOBJ.*本批未导入/s);
});
