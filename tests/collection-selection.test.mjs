import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogEntries } from '../modules/collections/catalog.ts';
import { selectInBox } from '../modules/collections/boxSelection.ts';
import {
  withoutEntries,
  removeEntries,
} from '../modules/collections/remove.ts';
import {
  newAnnotation,
  parseAnnotations,
  canAddAnnotation,
  ANNOTATION_STORAGE,
} from '../modules/annotations/data.ts';
import { TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import {
  annotationSheet,
  annotationSpreadsheet,
} from '../modules/annotations/spreadsheet.ts';
import { unzipSync, strFromU8 } from 'fflate';
const pin = (id, coordinates = [10, 10]) => ({
  ...newAnnotation('pin', coordinates, 500, id),
  name: '中文地点 ' + id,
});
const track = {
  id: 'track',
  name: '原始实走',
  source: 'recorded',
  createdAt: 1,
  segments: [
    [
      [0, 10],
      [20, 10],
    ],
    [
      [40, 10],
      [50, 10],
    ],
  ],
  samples: [
    [
      { time: 1000, altitude: 500 },
      { time: 2000, altitude: 501 },
    ],
    [
      { time: 3000, altitude: 502 },
      { time: 4000, altitude: 503 },
    ],
  ],
};
const transfer = () => ({
  format: 'guanyun-backup',
  version: 1,
  annotations: [
    pin('a'),
    { ...pin('linked'), trackAnchor: { trackId: 'track', distance: 200 } },
  ],
  tracks: [track],
  favorites: [],
});
test('rectangle selects entire crossing track and visible markers, never bridges GPS gaps', () => {
  const data = transfer(),
    original = JSON.stringify(data),
    entries = catalogEntries(
      [],
      data.tracks,
      [...data.annotations, { ...pin('hidden'), visible: false }],
      [],
    );
  const project = ([x, y]) => ({ x, y });
  assert.deepEqual(
    selectInBox(entries, { left: 9, right: 11, top: 9, bottom: 11 }, project),
    ['annotation:a', 'annotation:linked', 'track:track'],
  );
  assert.deepEqual(
    selectInBox(entries, { left: 25, right: 30, top: 9, bottom: 11 }, project),
    [],
  );
  assert.equal(JSON.stringify(data), original);
});
test('deletion removes only selected objects, cleans owner relation without removing independent pins', () => {
  const data = transfer(),
    next = withoutEntries(data, ['annotation:a', 'track:track']);
  assert.equal(next.tracks.length, 0);
  assert.equal(next.annotations.length, 1);
  assert.equal(next.annotations[0].trackAnchor, undefined);
  assert.ok(data.annotations[1].trackAnchor);
});
test('failed batch deletion restores every already-written original', () => {
  const m = new Map([
      [TRACK_STORAGE, JSON.stringify([track])],
      [ANNOTATION_STORAGE, JSON.stringify(transfer().annotations)],
    ]),
    before = [...m];
  let fail = true;
  const storage = {
    getItem: (k) => m.get(k) ?? null,
    removeItem: (k) => m.delete(k),
    setItem: (k, v) => {
      if (k === ANNOTATION_STORAGE && fail) {
        fail = false;
        throw Error('quota');
      }
      m.set(k, v);
    },
  };
  assert.throws(() => removeEntries(['track:track'], storage), /删除未完成/);
  assert.deepEqual([...m], before);
});
test('hundreds of pins roundtrip without consuming 3D model slots', () => {
  const pins = Array.from({ length: 500 }, (_, i) => pin(String(i)));
  assert.equal(parseAnnotations(JSON.stringify(pins)).length, 500);
  assert.equal(canAddAnnotation(pins, 'box'), true);
  const models = Array.from({ length: 80 }, (_, i) =>
    newAnnotation('box', [0, 0], 0, String(i)),
  );
  assert.equal(canAddAnnotation(models, 'box'), false);
  assert.equal(canAddAnnotation(models, 'pin'), true);
});
test('XLSX starts with names and coordinates; all empty declared attributes retain aligned columns', () => {
  const a = {
      ...pin('a'),
      attributes: [
        { name: '岩性', value: '砂岩' },
        { name: '编号', value: '00123' },
        { name: '空类目', value: '' },
      ],
    },
    b = { ...pin('b'), attributes: [{ name: '备注字段', value: '=1+1' }] };
  const sheet = annotationSheet([a, b]);
  assert.deepEqual(sheet.rows[0].slice(0, 4), [
    '地名',
    '经度（WGS84）',
    '纬度（WGS84）',
    '地面海拔（m）',
  ]);
  for (const label of [
    '属性：岩性',
    '属性：编号',
    '属性：空类目',
    '属性：备注字段',
  ])
    assert.ok(sheet.rows[0].includes(label));
  assert.equal(sheet.rows[2][sheet.rows[0].indexOf('属性：岩性')], '');
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf('属性：空类目')], '');
  const files = unzipSync(annotationSpreadsheet([a, b])),
    strings = strFromU8(files['xl/sharedStrings.xml']),
    xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(strings, /中文地点 a/);
  assert.match(strings, /00123/);
  assert.match(strings, /=1\+1/);
  assert.match(xml, /<c r="A1" s="1" t="s">/);
  assert.match(xml, /topLeftCell="A1"/);
  assert.doesNotMatch(xml, /<f[ >]/);
});
