import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeBoundary,
  moveAreaPoint,
  areaMetrics,
  parseAreas,
  AREA_STORAGE,
} from '../modules/areas/data.ts';
import {
  coordinateKey,
  normalizeRegion,
} from '../modules/collections/regions.ts';
import {
  catalogEntries,
  groupCatalog,
  regionFor,
} from '../modules/collections/catalog.ts';
import { collectionTransfer } from '../modules/collections/export.ts';
import { mergeData, collectData } from '../modules/outdoor/exchange.ts';
import { SECTION_OBJECTS_KEY } from '../modules/section/sectionObjects.ts';
import { PROFILE_NOTES_KEY } from '../modules/section/profileNotes.ts';
import { REGION_STORAGE } from '../modules/collections/regions.ts';
const area = () => ({
  id: 'zone',
  name: '调查区域',
  note: '',
  color: '#66cfa2',
  visible: true,
  boundary: closeBoundary([
    [104, 31],
    [104.01, 31],
    [104.01, 31.01],
    [104, 31.01],
  ]),
  createdAt: 1,
});
test('area closes without mutating the input and stays closed when moving the first vertex', () => {
  const a = area(),
    before = structuredClone(a),
    moved = moveAreaPoint(a, 0, [103.999, 30.999]);
  assert.deepEqual(a, before);
  assert.deepEqual(moved.boundary[0], moved.boundary.at(-1));
  assert.ok(
    areaMetrics(a.boundary).area > 1e6 && areaMetrics(a.boundary).area < 1.1e6,
  );
  assert.deepEqual(parseAreas(JSON.stringify([a])), [a]);
  assert.throws(() =>
    closeBoundary([
      [104, 31],
      [104.1, 31],
      [104.2, 31],
    ]),
  );
  assert.throws(() =>
    closeBoundary([
      [104, 31],
      [104.1, 31.1],
      [104, 31.1],
      [104.1, 31],
    ]),
  );
  assert.throws(() => moveAreaPoint(a, 99, [104, 31]));
});
test('area handles dateline without world-sized area; overlapping edges are rejected', () => {
  const a = closeBoundary([
    [179.99, 0],
    [-179.99, 0],
    [-179.99, 0.01],
    [179.99, 0.01],
  ]);
  assert.ok(areaMetrics(a).area < 3e6);
  assert.throws(() =>
    closeBoundary([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0],
    ]),
  );
});
test('administrative grouping uses structured fields, isolates countries and invalidates moved coordinates', () => {
  assert.deepEqual(
    normalizeRegion({
      features: [
        {
          properties: {
            name: '街道',
            country: '中国',
            state: '四川省',
            city: '成都市',
          },
        },
      ],
    }),
    { country: '中国', province: '四川省', city: '成都市' },
  );
  assert.equal(
    normalizeRegion({ features: [{ properties: { name: '街道' } }] }).city,
    '',
  );
  const [entry] = catalogEntries([], [], [], [], [area()]);
  const regions = {
    [entry.key]: {
      country: '中国',
      province: '四川省',
      city: '成都市',
      source: 'manual',
      coordinateKey: coordinateKey(entry.coordinates),
      checkedAt: 1,
    },
  };
  assert.equal(groupCatalog([entry], regions)[0].cities[0][0], '成都市');
  assert.equal(
    regionFor({ ...entry, coordinates: [105, 31] }, regions),
    undefined,
  );
});
test('batch transfer preserves only selected geometry, custom attributes and region metadata through conflict IDs', () => {
  const a = area(),
    [entry] = catalogEntries([], [], [], [], [a]);
  const regions = {
    [entry.key]: {
      country: '中国',
      province: '四川省',
      city: '成都市',
      source: 'manual',
      coordinateKey: coordinateKey(entry.coordinates),
      checkedAt: 1,
    },
  };
  const memory = new Map(),
    storage = {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    };
  const transfer = collectionTransfer([entry], regions, storage);
  memory.set(AREA_STORAGE, JSON.stringify([{ ...a, name: '原有区域' }]));
  mergeData(transfer, storage);
  const result = collectData(storage),
    imported = result.areas.find((v) => v.name === a.name);
  assert.equal(result.areas.length, 2);
  assert.notEqual(imported.id, a.id);
  assert.equal(result.regions[`area:${imported.id}`].city, '成都市');
  assert.deepEqual(imported.boundary, a.boundary);
});

test('section conflict remaps saved measurements to their imported owner and failed batch writes restore all keys', () => {
  const settings = {
    enabled: true,
    color: '#9de8c4',
    altitude: 100,
    objectId: 'section-a',
    plane: {
      center: [104, 31],
      width: 1000,
      height: 1000,
      heading: 0,
      tilt: 0,
    },
  };
  const section = { id: 'section-a', name: '分享剖面', settings };
  const record = {
    settings,
    savedAt: 1,
    notes: [
      {
        id: 'point-a',
        name: '测点',
        note: '中文备注',
        fields: [{ name: '岩性', value: '砂岩', unit: '' }],
        point: {
          u: 0,
          v: 0,
          altitude: 100,
          distance: 0,
          coordinates: [104, 31],
          local: [0, 0, 0],
        },
        curveName: '真实地形',
        source: 'terrain',
        sampledAt: 1,
      },
    ],
  };
  const memory = new Map([
    [SECTION_OBJECTS_KEY, JSON.stringify([{ ...section, name: '原有剖面' }])],
    [
      PROFILE_NOTES_KEY,
      JSON.stringify([
        { ...record, notes: [{ ...record.notes[0], name: '原有测点' }] },
      ]),
    ],
  ]);
  let fail = false;
  const storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => {
      if (fail && k === AREA_STORAGE) {
        fail = false;
        throw new Error('quota');
      }
      memory.set(k, v);
    },
    removeItem: (k) => memory.delete(k),
  };
  const incoming = {
    format: 'guanyun-backup',
    version: 1,
    tracks: [],
    annotations: [],
    favorites: [],
    sections: [section],
    sectionNotes: [record],
    areas: [area()],
    regions: {
      'section:section-a': {
        country: '中国',
        province: '四川省',
        city: '成都市',
        source: 'manual',
        coordinateKey: coordinateKey([104, 31]),
        checkedAt: 1,
      },
    },
  };
  const original = new Map(memory);
  fail = true;
  assert.throws(() => mergeData(incoming, storage), /存储不足/);
  assert.deepEqual(memory, original);
  assert.equal(storage.getItem(REGION_STORAGE), null);
  const merged = mergeData(incoming, storage);
  const added = merged.sections.find((s) => s.name === section.name);
  assert.notEqual(added.id, section.id);
  assert.equal(added.settings.objectId, added.id);
  assert.equal(
    merged.sectionNotes.find((r) => r.settings.objectId === added.id).notes[0]
      .name,
    '测点',
  );
  assert.equal(
    merged.sectionNotes.find((r) => r.settings.objectId === section.id).notes[0]
      .name,
    '原有测点',
  );
  assert.equal(merged.regions[`section:${added.id}`].city, '成都市');
  assert.deepEqual(incoming.sectionNotes[0], record);
});
