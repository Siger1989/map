import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeData } from '../modules/outdoor/exchange.ts';
import { TRACK_STORAGE, parseSavedTracks } from '../modules/tracks/drawing.ts';
import { newAnnotation, ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
const storage = records => {
  const values = new Map([[TRACK_STORAGE, JSON.stringify(records)]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const source = { id: 'source', name: '来源路线', createdAt: 1, hidden: true, segments: [[[103, 30], [103.002, 30]]] };
const combined = { id: 'combined', name: '组合路线', createdAt: 2, sourceTrackIds: ['source'], segments: source.segments };
test('backup import remaps combined source relationships and marker ownership together on ID collision', () => {
  const local = { ...source, name: '本机不同路线' }, store = storage([local]);
  const marker = { ...newAnnotation('pin', [103,30], null, 'marker'), trackAnchor: { trackId: 'source', distance: 0 } };
  mergeData({ format:'guanyun-backup',version:1,tracks:[source,combined],favorites:[],annotations:[marker] }, store);
  const records = parseSavedTracks(store.getItem(TRACK_STORAGE)), remote = records.find(t => t.name === source.name);
  assert.notEqual(remote.id, source.id);
  assert.deepEqual(records.find(t => t.id === 'combined').sourceTrackIds,[remote.id]);
  assert.equal(records.find(t => t.id === source.id).name, local.name);
  assert.equal(JSON.parse(store.getItem(ANNOTATION_STORAGE))[0].trackAnchor.trackId,remote.id);
});
test('standalone combined import cannot bind a missing source to an unrelated local route', () => {
  const store = storage([{ ...source, name:'无关本机路线' }]);
  mergeData({ format:'guanyun-backup',version:1,tracks:[combined],favorites:[],annotations:[] },store);
  const records = parseSavedTracks(store.getItem(TRACK_STORAGE));
  assert.deepEqual(records.find(t => t.id === 'combined').sourceTrackIds,[]);
  assert.equal(records.find(t => t.id === 'source').name,'无关本机路线');
});
