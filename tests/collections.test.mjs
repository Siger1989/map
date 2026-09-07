import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_STORAGE,
  defaultLayout,
  parseLayout,
  validateLayout,
  entriesFor,
  groupFor,
  orderedEntries,
  moveEntry,
  dropEntry,
  reorderGroup,
  deleteGroup,
} from '../modules/collections/data.ts';
import { collectData, mergeData } from '../modules/outdoor/exchange.ts';
const points = [
  [103, 31],
  [103.01, 31],
];
const track = (id, source) => ({
  id,
  name: id,
  source,
  createdAt: 100,
  segments: [points],
});
const route = (id, mode = 'bicycle') => ({
  id,
  name: id,
  savedAt: 100,
  start: { name: 'A', coordinates: points[0] },
  end: { name: 'B', coordinates: points[1] },
  route: {
    mode,
    coordinates: points,
    distance: 1000,
    duration: 200,
    createdAt: 99,
    snapped: points,
    steps: [],
  },
});
const empty = () => ({
  format: 'guanyun-backup',
  version: 1,
  tracks: [],
  favorites: [],
  annotations: [],
});
const memory = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};

test('old route/track records classify without rewriting their coordinates or provenance', () => {
  const tracks = [
    track('gps', 'recorded'),
    track('gpx', 'gpx'),
    track('kml', 'kml'),
    track('pen', 'manual'),
    track('old'),
  ];
  tracks.push({
    ...track('time'),
    samples: [
      [
        { time: 100, altitude: 10 },
        { time: 200, altitude: 20 },
      ],
    ],
  });
  const original = structuredClone(tracks);
  const entries = entriesFor(
    [route('same', 'auto'), route('b', 'bicycle'), route('p', 'pedestrian')],
    tracks,
  );
  assert.deepEqual(
    entries.map((e) => groupFor(defaultLayout(), e).id),
    [
      'auto',
      'bicycle',
      'pedestrian',
      'recorded',
      'imported',
      'imported',
      'manual',
      'manual',
      'imported',
    ],
  );
  assert.deepEqual(tracks, original);
  assert.notEqual(
    entriesFor([route('same')], [track('same')])[0].key,
    entriesFor([route('same')], [track('same')])[1].key,
  );
});
test('cross-group moves, bidirectional sorting, group reorder and deletion preserve all records', () => {
  const entries = entriesFor(
    [route('a'), route('b'), route('c')],
    [track('t')],
  );
  const original = structuredClone(entries);
  let layout = defaultLayout();
  layout.groups.push({ id: 'trip', name: '川藏', color: '#72b7ff' });
  layout = dropEntry(layout, entries, 'route:a', 'route:b');
  assert.deepEqual(
    orderedEntries(layout, entries)
      .map((e) => e.key)
      .slice(0, 3),
    ['route:b', 'route:a', 'route:c'],
  );
  layout = dropEntry(layout, entries, 'route:c', 'route:b');
  assert.deepEqual(
    orderedEntries(layout, entries)
      .map((e) => e.key)
      .slice(0, 3),
    ['route:c', 'route:b', 'route:a'],
  );
  layout = moveEntry(layout, entries, 'track:t', 'trip');
  assert.equal(groupFor(layout, entries[3]).id, 'trip');
  layout = reorderGroup(layout, 'trip', 'auto');
  assert.equal(layout.groups[0].id, 'trip');
  layout = deleteGroup(layout, 'trip');
  assert.equal(groupFor(layout, entries[3]).id, 'unfiled');
  layout = deleteGroup(layout, 'bicycle');
  assert.equal(groupFor(layout, entries[0]).id, 'unfiled');
  assert.equal(orderedEntries(layout, entries).length, 4);
  assert.deepEqual(entries, original);
  assert.deepEqual(parseLayout(JSON.stringify(layout)), layout);
});
test('reject invalid layout and ignore stale item IDs during a sort', () => {
  for (const patch of [
    { version: 2 },
    { groups: [{ id: 'x', name: ' ', color: '#fff' }] },
    { order: ['bad'] },
    { order: ['track:a', 'track:a'] },
  ]) {
    assert.throws(() => validateLayout({ ...defaultLayout(), ...patch }));
  }
  assert.throws(() =>
    parseLayout(
      '{"version":1,"groups":[],"assignments":{"__proto__":"manual"},"order":[]}',
    ),
  );
  const layout = { ...defaultLayout(), order: ['route:deleted', 'route:a'] };
  const entries = entriesFor([route('a'), route('b')], []);
  assert.equal(orderedEntries(layout, entries).length, 2);
  assert.deepEqual(moveEntry(layout, entries, 'unknown', 'auto'), layout);
  assert.deepEqual(moveEntry(layout, entries, 'route:a', 'missing'), layout);
});
test('JSON backup carries custom colors/order, old backups still import and new ID conflicts remap groups', () => {
  const source = memory();
  mergeData(
    { ...empty(), favorites: [route('a')], tracks: [track('t', 'recorded')] },
    source,
  );
  const layout = defaultLayout();
  layout.groups.push({ id: 'trip', name: '旅行', color: '#f59dbd' });
  layout.assignments = { 'route:a': 'trip', 'track:t': 'trip' };
  layout.order = ['track:t', 'route:a'];
  source.setItem(COLLECTION_STORAGE, JSON.stringify(layout));
  const backup = collectData(source),
    target = memory();
  mergeData(backup, target);
  const restored = collectData(target);
  assert.equal(restored.collections.groups.at(-1).color, '#f59dbd');
  assert.deepEqual(restored.collections.order, layout.order);
  mergeData(backup, target);
  assert.equal(collectData(target).favorites.length, 1);
  assert.equal(collectData(target).collections.groups.length, 7);
  const conflict = {
    ...backup,
    favorites: [{ ...route('a'), name: 'different' }],
    collections: structuredClone(layout),
  };
  conflict.collections.groups.at(-1).name = '别的旅行';
  mergeData(conflict, target);
  const merged = collectData(target),
    imported = merged.favorites.find((f) => f.name === 'different');
  assert.notEqual(imported.id, 'a');
  assert.equal(merged.collections.assignments['route:a'], 'trip');
  const mapped = merged.collections.groups.find((g) => g.name === '别的旅行');
  assert.notEqual(mapped.id, 'trip');
  assert.equal(
    merged.collections.assignments[`route:${imported.id}`],
    mapped.id,
  );
});
test('all backup writes roll back if collection persistence fails', () => {
  const storage = memory();
  mergeData({ ...empty(), tracks: [track('before')] }, storage);
  const before = JSON.stringify(collectData(storage));
  let failed = false;
  const failing = {
    ...storage,
    setItem: (k, v) => {
      if (k === COLLECTION_STORAGE && !failed) {
        failed = true;
        throw Error('quota');
      }
      storage.setItem(k, v);
    },
  };
  assert.throws(() =>
    mergeData(
      { ...empty(), tracks: [track('after')], collections: defaultLayout() },
      failing,
    ),
  );
  assert.equal(JSON.stringify(collectData(storage)), before);
  assert.equal(storage.getItem(COLLECTION_STORAGE), null);
});
