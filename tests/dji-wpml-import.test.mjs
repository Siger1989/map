import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { strToU8, zipSync } from 'fflate';
import { parseFile } from '../modules/dataTransfer/fileImport.ts';

globalThis.DOMParser = DOMParser;
const wpml = (indexes = [1, 0, 2]) => `<?xml version="1.0"?>
  <kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
    <Document><Folder><wpml:waylineId>0</wpml:waylineId>
      ${indexes.map(index => `<Placemark><Point><coordinates>${103 + index * .001},30</coordinates></Point><wpml:index>${index}</wpml:index><wpml:executeHeight>100</wpml:executeHeight></Placemark>`).join('')}
    </Folder></Document></kml>`;
const archive = (text) => new File([zipSync({
  'wpmz/template.kml': strToU8('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>'),
  'wpmz/waylines.wpml': strToU8(text),
})], 'route.kmz');

test('DJI KMZ imports ordered waypoints from waylines.wpml, not empty template.kml', async () => {
  const data = await parseFile(archive(wpml()));
  assert.equal(data.tracks.length, 1);
  assert.equal(data.annotations.length, 0);
  assert.equal(data.tracks[0].importFormat, 'DJI WPML');
  assert.deepEqual(data.tracks[0].segments[0], [[103, 30], [103.001, 30], [103.002, 30]]);
  assert.match(data.importWarnings[0], /飞行高度、动作指令不导入/);
  const uavExport = await parseFile(archive(wpml().replace('www.dji.com', 'www.uav.com')));
  assert.equal(uavExport.tracks[0].segments[0].length, 3);
});

test('DJI KMZ rejects missing and duplicate waypoint indices without merging partial data', async () => {
  await assert.rejects(parseFile(archive(wpml([0, 2]))), /连续编号/);
  await assert.rejects(parseFile(archive(wpml([0, 0]))), /连续编号/);
});
