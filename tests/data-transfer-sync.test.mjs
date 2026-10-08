import test from 'node:test';
import assert from 'node:assert/strict';
import { collectData, mergeData, syncData, summarizeSync } from '../modules/dataTransfer/storage.ts';
import { defaultLayout, COLLECTION_STORAGE } from '../modules/collections/data.ts';
import { REGION_STORAGE } from '../modules/collections/regions.ts';

const blank = () => ({ format: 'guanyun-backup', version: 1, tracks: [], annotations: [], favorites: [] });
const track = (id, name, extra = {}) => ({ id, name, createdAt: 1, source: 'manual', segments: [[[103,31],[103.1,31]]], ...extra });
const marker = (id, name, trackId) => ({ id, kind: 'pin', name, note: '', trackAnchor: { trackId, distance: 12 }, color: '#ffffff', coordinates: [103,31], groundElevation: null, placement: 'surface', offset: 0, width: 1, length: 1, height: 1, heading: 0, pitch: 0, roll: 0, opacity: 0.5, visible: true });
const section = (id, name, altitude = 100) => ({ id, name, settings: { objectId: id, enabled: true, altitude, color: '#72b7ff', plane: { center: [103,31], width: 100, height: 50, heading: 0, tilt: 0 } } });
const profileNote = (id, name) => ({ id, name, note: '', fields: [], point: { u: 0, v: 0, altitude: 10, distance: 1, coordinates: [103,31], local: [0,0,0] }, curveName: '地形', source: 'terrain', sampledAt: 1 });
const memory = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key), map };
};

test('sync overwrites same IDs, retains receiver-only records, and preserves stable references', () => {
  const store = memory();
  mergeData({ ...blank(), tracks: [track('shared', '旧内容', { sourceTrackIds: ['origin'] }), track('origin', '来源'), track('local-only', '本机独有')], annotations: [marker('pin', '旧标记', 'origin'), marker('pin-local', '本机标记', 'origin')] }, store);
  const incoming = { ...blank(), tracks: [track('shared', '发送端内容', { sourceTrackIds: ['origin'] }), track('origin', '来源'), track('new', '新增')], annotations: [marker('pin', '发送端标记', 'origin')] };
  const summary = summarizeSync(collectData(store), incoming);
  assert.equal(summary.overwritten.tracks, 1);
  assert.equal(summary.added.tracks, 1);
  assert.equal(summary.overwritten.annotations, 1);
  const result = syncData(incoming, store);
  assert.deepEqual(result.tracks.map((item) => item.id), ['shared', 'origin', 'local-only', 'new']);
  assert.equal(result.tracks.find((item) => item.id === 'shared').name, '发送端内容');
  assert.deepEqual(result.tracks.find((item) => item.id === 'shared').sourceTrackIds, ['origin']);
  assert.equal(result.annotations.find((item) => item.id === 'pin').name, '发送端标记');
  assert.deepEqual(result.annotations.find((item) => item.id === 'pin').trackAnchor, { trackId: 'origin', distance: 12 });
  assert.ok(result.annotations.some((item) => item.id === 'pin-local'));
  syncData(incoming, store);
  assert.deepEqual(collectData(store).tracks, result.tracks);
});

test('two-way sync keeps records unique to each device', () => {
  const desktop = memory(), phone = memory();
  mergeData({ ...blank(), tracks: [track('shared', '桌面版'), track('desktop-only', '桌面独有')] }, desktop);
  mergeData({ ...blank(), tracks: [track('shared', '手机版'), track('phone-only', '手机独有')] }, phone);
  syncData(collectData(desktop), phone);
  syncData(collectData(phone), desktop);
  assert.deepEqual(new Set(collectData(desktop).tracks.map((item) => item.id)), new Set(['shared', 'desktop-only', 'phone-only']));
  assert.deepEqual(new Set(collectData(phone).tracks.map((item) => item.id)), new Set(['shared', 'desktop-only', 'phone-only']));
});

test('optional fields merge by ID and update matching folder/group and region keys', () => {
  const store = memory(), layout = defaultLayout();
  layout.groups.push({ id: 'trip', name: '旧分组', color: '#72b7ff' });
  layout.assignments = { 'track:shared': 'trip', 'track:local-only': 'manual' };
  layout.order = ['track:shared', 'track:local-only'];
  store.setItem(COLLECTION_STORAGE, JSON.stringify(layout));
  store.setItem(REGION_STORAGE, JSON.stringify({
    'track:shared': { coordinateKey: '103.000000,31.000000', country: '旧', province: '', city: '', source: 'manual', checkedAt: 1 },
    'track:local-only': { coordinateKey: '103.000000,31.000000', country: '保留', province: '', city: '', source: 'manual', checkedAt: 1 },
  }));
  mergeData({ ...blank(), tracks: [track('shared', '旧'), track('local-only', '本机')], sections: [section('sec', '旧剖面')], sectionNotes: [{ settings: section('sec', '旧剖面').settings, savedAt: 1, notes: [profileNote('same-note','旧测点'),profileNote('local-note','本机测点')] }] }, store);
  const nextLayout = structuredClone(layout);
  nextLayout.groups.find((group) => group.id === 'trip').name = '发送端分组';
  nextLayout.assignments['track:shared'] = 'synced';
  nextLayout.groups.push({ id: 'synced', name: '目标组', color: '#89dfb3' });
  const incoming = {
    ...blank(), tracks: [track('shared', '新'), track('sender-only', '新增')],
    sections: [section('sec', '发送端剖面', 200)],
    sectionNotes: [{ settings: section('sec', '发送端剖面', 200).settings, savedAt: 2, notes: [profileNote('same-note','发送端测点'),profileNote('new-note','新测点')] }],
    collections: { ...nextLayout, order: ['track:sender-only', 'track:shared'] },
    regions: { 'track:shared': { coordinateKey: '104.000000,32.000000', country: '新', province: '', city: '', source: 'manual', checkedAt: 2 } },
  };
  const summary = summarizeSync(collectData(store), incoming);
  assert.equal(summary.overwritten.regions, 1);
  assert.equal(summary.overwritten.sectionNotes, 1);
  assert.equal(summary.added.sectionNotes, 1);
  const result = syncData(incoming, store);
  assert.equal(result.collections.groups.find((group) => group.id === 'trip').name, '发送端分组');
  assert.equal(result.collections.assignments['track:shared'], 'synced');
  assert.equal(result.collections.assignments['track:local-only'], 'manual');
  assert.ok(result.collections.order.includes('track:local-only'));
  assert.equal(result.regions['track:shared'].country, '新');
  assert.equal(result.regions['track:local-only'].country, '保留');
  assert.equal(result.sections.find((item) => item.id === 'sec').name, '发送端剖面');
  assert.equal(result.sectionNotes.find((item) => item.settings.objectId === 'sec').savedAt, 2);
  assert.equal(result.sectionNotes.find((item) => item.settings.objectId === 'sec').notes.find((note) => note.id === 'same-note').name, '发送端测点');
  assert.ok(result.sectionNotes.find((item) => item.settings.objectId === 'sec').notes.some((note) => note.id === 'local-note'));
  syncData({ ...blank(), tracks: [] }, store);
  assert.ok(collectData(store).tracks.some((item) => item.id === 'sender-only'));
});

test('invalid data and quota failures leave every written key unchanged', () => {
  const store = memory();
  mergeData({ ...blank(), tracks: [track('old', 'before')] }, store);
  const before = [...store.map.entries()].sort();
  assert.throws(() => syncData({ ...blank(), tracks: [track('new', 'bad', { segments: [[[999,31],[103,31]]] })] }, store));
  assert.deepEqual([...store.map.entries()].sort(), before);
  let calls = 0;
  const failing = { ...store, setItem: (key, value) => { if (++calls === 2) throw Error('quota'); store.setItem(key, value); } };
  assert.throws(() => syncData({ ...blank(), tracks: [track('new', 'incoming')] }, failing), /存储不足/);
  assert.deepEqual([...store.map.entries()].sort(), before);
});

test('sync still enforces collection limits and legacy merge keeps its conflict-copy behavior', () => {
  const store = memory();
  const full = Array.from({ length: 100 }, (_, index) => track(`t${index}`, `T${index}`));
  mergeData({ ...blank(), tracks: full }, store);
  assert.throws(() => syncData({ ...blank(), tracks: [track('extra', 'too many')] }, store));
  const another = memory();
  mergeData({ ...blank(), tracks: [track('same', 'local')] }, another);
  mergeData({ ...blank(), tracks: [track('same', 'sender')] }, another);
  assert.equal(collectData(another).tracks.length, 2);
});
