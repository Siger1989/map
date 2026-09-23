import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { newAnnotation, ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
import { annotationSpreadsheet, annotationSheet } from '../modules/annotations/spreadsheet.ts';
import { spreadsheetBytes } from '../modules/files/spreadsheet.ts';
import { markerSpreadsheetRows, planMarkerSpreadsheet } from '../modules/annotations/spreadsheetImport.ts';
import { saveWorkbench } from '../modules/collections/workbenchStore.ts';
import { collectData } from '../modules/outdoor/exchange.ts';

const pin = (id, coordinates = [103.5, 30.7]) => ({
  ...newAnnotation('pin', coordinates, null, id),
  name: '山顶', note: '旧备注', color: '#127a44',
  attributes: [{ name: '岩 性', value: '砂岩' }, { name: '留存', value: '保留' }],
});
const data = annotations => ({ format: 'guanyun-backup', version: 1, annotations, tracks: [], favorites: [] });
const rowsOf = (headers, ...items) => [{ number: 1, cells: headers }, ...items.map((cells, i) => ({ number: i + 2, cells }))];

test('exported marker worksheet has coordinates first, keeps text and roundtrips without changes', () => {
  const original = pin('a');
  original.attributes.push({ name: '编号', value: '00123' });
  original.name = '山&峰';
  const rows = markerSpreadsheetRows(annotationSpreadsheet([original]));
  assert.deepEqual(rows[0].cells.slice(0, 4), ['经度（WGS84）', '纬度（WGS84）', '名称', '备注']);
  assert.equal(rows[1].cells[2], '山&峰');
  assert.equal(rows[0].cells[4], '属性：岩 性');
  assert.equal(rows[1].cells[6], '00123');
  const plan = planMarkerSpreadsheet(rows, data([original]));
  assert.deepEqual([plan.added, plan.updated, plan.unchanged, plan.issues.length], [0, 0, 1, 0]);
});

test('ID updates a moved point; blank cells preserve attributes and photos are outside this transaction', () => {
  const original = pin('a');
  const rows = rowsOf(
    ['经度（WGS84）', '纬度（WGS84）', '名称', '备注', '属性：岩 性', '属性：新条目', 'ID（自动）'],
    ['103.6', '30.8', '新名称', '', '', '玄武岩', 'a'],
  );
  const raw = new Map([[ANNOTATION_STORAGE, JSON.stringify([original])]]);
  const storage = { getItem: key => raw.get(key) ?? null, setItem: (key, value) => raw.set(key, value), removeItem: key => raw.delete(key) };
  const before = collectData(storage);
  const plan = planMarkerSpreadsheet(rows, before);
  assert.equal(plan.updated, 1);
  assert.equal(plan.issues.length, 0);
  const next = plan.after.annotations[0];
  assert.deepEqual(next.coordinates, [103.6, 30.8]);
  assert.equal(next.note, '旧备注');
  assert.deepEqual(next.attributes, [
    { name: '岩 性', value: '砂岩' },
    { name: '新条目', value: '玄武岩' },
    { name: '留存', value: '保留' },
  ]);
  assert.equal(original.coordinates[0], 103.5);
  assert.equal(JSON.parse(storage.getItem(ANNOTATION_STORAGE))[0].name, '山顶', 'preview never writes');
  saveWorkbench(before, plan.after, storage);
  assert.equal(JSON.parse(storage.getItem(ANNOTATION_STORAGE))[0].name, '新名称');
});

test('manual sheet matches one existing coordinate and creates another pin without an ID', () => {
  const original = pin('a');
  const rows = rowsOf(
    ['经度（WGS84）', '纬度（WGS84）', '名称', '属性：岩性'],
    ['103.5', '30.7', '原点', '页岩'],
    ['103.501', '30.701', '新点', '灰岩'],
  );
  const plan = planMarkerSpreadsheet(rows, data([original]));
  assert.deepEqual([plan.added, plan.updated, plan.issues.length], [1, 1, 0]);
  assert.equal(plan.after.annotations[0].id, 'a');
  assert.deepEqual(plan.after.annotations[1].coordinates, [103.501, 30.701]);
  assert.equal(plan.after.annotations[1].attributes[0].value, '灰岩');
});

test('custom item order follows spreadsheet columns, including duplicate item names', () => {
  const original = pin('a');
  original.attributes = [
    { name: '岩性', value: '砂岩' },
    { name: '编号', value: '00123' },
    { name: '岩性', value: '页岩' },
  ];
  const rows = rowsOf(
    ['经度（WGS84）', '纬度（WGS84）', '名称', '属性：编号', '属性：岩性', '属性：岩性（2）', 'ID'],
    ['103.5', '30.7', '山顶', '', '', '', 'a'],
  );
  const plan = planMarkerSpreadsheet(rows, data([original]));
  assert.equal(plan.updated, 1);
  assert.deepEqual(plan.after.annotations[0].attributes, [
    { name: '编号', value: '00123' },
    { name: '岩性', value: '砂岩' },
    { name: '岩性', value: '页岩' },
  ]);
});

test('ambiguous coordinates, invalid WGS84, duplicate rows and model creation are rejected per row', () => {
  const original = pin('a');
  const duplicate = pin('b');
  const rows = rowsOf(
    ['经度（WGS84）', '纬度（WGS84）', '名称', '类型'],
    ['103.5', '30.7', '歧义', '地点标记'],
    ['30°', '103.5', '无效', '地点标记'],
    ['103.6', '30.8', '新模型', '长方体'],
  );
  const plan = planMarkerSpreadsheet(rows, data([original, duplicate]));
  assert.equal(plan.issues.length, 3);
  assert.equal(plan.added, 0);
  assert.deepEqual(plan.after.annotations, [original, duplicate]);
  const repeats = planMarkerSpreadsheet(rowsOf(
    ['经度（WGS84）', '纬度（WGS84）', '名称', 'ID'],
    ['103.5', '30.7', '一', 'a'], ['103.6', '30.8', '二', 'a'],
  ), data([original]));
  assert.equal(repeats.issues.length, 1);
});

test('collection workbook skips its directory and reads marker worksheet; formula cells fail safely', () => {
  const workbook = spreadsheetBytes([
    { name: '收藏目录', rows: [['地名', '经度（WGS84）', '纬度（WGS84）'], ['路线', 103, 30]] },
    annotationSheet([pin('a')]),
  ]);
  assert.equal(markerSpreadsheetRows(workbook)[1].cells[2], '山顶');
  const files = unzipSync(workbook);
  const book = 'xl/workbook.xml';
  files[book] = strToU8(strFromU8(files[book]).replace('收藏目录', '&#25910;&#34255;&#30446;&#24405;').replace('标记与属性', '&#26631;&#35760;&#19982;&#23646;&#24615;'));
  assert.equal(markerSpreadsheetRows(zipSync(files))[1].cells[2], '山顶', 'numeric XML character references preserve sheet choice');
  const path = 'xl/worksheets/sheet2.xml';
  files[path] = strToU8(strFromU8(files[path]).replace(/<c r="A2"[^>]*>.*?<\/c>/, '<c r="A2"><f>1+1</f><v>2</v></c>'));
  assert.throws(() => markerSpreadsheetRows(zipSync(files)), /含公式/);
});
