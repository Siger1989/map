import test from 'node:test';
import assert from 'node:assert/strict';
import { metresBetween } from '../modules/navigation/types.ts';
import { appendVertex } from '../modules/tracks/draft.ts';
import { drawingRecord, storeDrawingRecord } from '../modules/tracks/archive.ts';
import { parseSavedTracks, TRACK_STORAGE, MAX_TRACK_POINTS } from '../modules/tracks/drawing.ts';
import {
  pickTrackContinuation,
  prepareTrackContinuation,
  trackContinuationDetails,
} from '../modules/tracks/prepareTrackContinuation.ts';

const line = [[103, 30], [103.01, 30]];
const manual = {
  id: 'manual-1', name: '山脊线', segments: [line], createdAt: 100,
  source: 'manual', nodes: [[103, 30], [103.01, 30]],
};
const project = ([lng, lat]) => ({ x: (lng - 103) * 1000, y: (lat - 30) * 1000 });

test('empty new track is a clean draft with no selected archive identity', () => {
  assert.deepEqual(prepareTrackContinuation(null), {
    draft: { segments: [], kinds: [], history: [], pointLine: null },
    editingId: null, copyName: null, anchor: null,
  });
});

test('manual endpoint continuation preserves identity and starts at the prior endpoint', () => {
  const prepared = prepareTrackContinuation(manual);
  assert.equal(prepared.editingId, manual.id);
  assert.equal(prepared.copyName, null);
  assert.deepEqual(prepared.anchor, [103.01, 30]);
  assert.notStrictEqual(prepared.draft.segments[0], manual.segments[0]);
});

test('visible line tap snaps to the actual projected line and starts an independent branch', () => {
  const hit = pickTrackContinuation([manual], { x: 5, y: 8 }, project, { draftEmpty: true });
  assert.ok(hit);
  assert.ok(Math.abs(hit.coordinate[0] - 103.005) < 1e-6);
  assert.equal(hit.coordinate[1], 30);
  assert.ok(Math.abs(hit.offset - 8) < 0.01);
  assert.ok(Math.abs(hit.distance - metresBetween(line[0], hit.coordinate)) < 0.02);

  const prepared = prepareTrackContinuation(hit.track, hit.coordinate);
  assert.equal(prepared.editingId, manual.id);
  assert.equal(prepared.draft.pointLine, 1);
  assert.deepEqual(prepared.draft.segments[0], [line[0], hit.coordinate, line[1]]);
  assert.deepEqual(prepared.draft.segments[1], [hit.coordinate]);
  const continued = appendVertex(prepared.draft, [103.005, 30.002]);
  assert.deepEqual(continued.segments[1], [hit.coordinate, [103.005, 30.002]]);
});

test('mid-line continuation splits only the draft clone and saves connected geometry, colors, and notes', () => {
  const source = {
    ...manual,
    segments: [[[103, 30], [103.01, 30], [103.02, 30]]],
    nodes: [[103, 30], [103.02, 30]],
    edgeColors: [['#aa0000', '#0000aa']],
    edgeNotes: [['旧段备注', '后段备注']],
    pointDetails: { '103,30': { note: '起点备注' } },
    style: { color: '#aa0000', width: 3 },
  };
  const before = structuredClone(source), junction = [103.005, 30];
  const prepared = prepareTrackContinuation(source, {
    coordinate: junction,
    distance: metresBetween(source.segments[0][0], junction),
  });
  assert.deepEqual(source, before, 'the saved archive remains untouched');
  assert.deepEqual(prepared.draft.segments[0], [source.segments[0][0], junction, ...source.segments[0].slice(1)]);
  assert.deepEqual(prepared.draft.segments[1], [junction]);
  assert.ok(prepared.draft.nodes?.some(point => point[0] === junction[0] && point[1] === junction[1]));
  assert.deepEqual(prepared.draft.edgeColors, [['#aa0000', '#aa0000', '#0000aa'], []]);

  const continued = appendVertex(prepared.draft, [103.005, 30.002]);
  const atJunction = point => point[0] === junction[0] && point[1] === junction[1];
  assert.ok(continued.segments[0].some(atJunction));
  assert.ok(continued.segments[1].some(atJunction));
  const base = drawingRecord({
    segments: continued.segments,
    edgeColors: continued.edgeColors,
    nodes: continued.segments.flat(),
    style: source.style,
    prior: source,
    id: 'unused', name: '', createdAt: 10, now: 20,
  });
  const savedTrack = {
    ...base,
    ...trackContinuationDetails(continued.segments, prepared.detailsSource),
  };
  const values = new Map();
  storeDrawingRecord(savedTrack, {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  const roundTrip = parseSavedTracks(values.get(TRACK_STORAGE))[0];
  assert.deepEqual(roundTrip.edgeNotes, [['旧段备注', '旧段备注', '后段备注'], [null]]);
  assert.deepEqual(roundTrip.edgeColors, [['#aa0000', '#aa0000', '#0000aa'], [null]]);
  assert.equal(roundTrip.pointDetails['103,30'].note, '起点备注');
  assert.deepEqual(source, before, 'saving the continued copy does not rewrite its source object');
});

test('recorded and sampled routes make untimed hand-drawn copies and leave source unchanged', () => {
  for (const track of [
    { ...manual, source: 'recorded', samples: [[{ time: 1000, altitude: 45 }, { time: 2000, altitude: 46 }]] },
    { ...manual, samples: [[{ time: 1000, altitude: 45 }, { time: 2000, altitude: 46 }]] },
    { ...manual, simulation: true },
  ]) {
    const before = structuredClone(track);
    const prepared = prepareTrackContinuation(track, [103.005, 30]);
    assert.equal(prepared.editingId, null);
    assert.equal(prepared.copyName, '山脊线 · 手绘副本');
    assert.equal('samples' in prepared.draft, false);
    assert.equal(prepared.detailsSource.simulation, undefined);
    assert.equal(prepared.detailsSource.source, 'manual');
    assert.deepEqual(track, before);
  }
});

test('far or hidden routes do not capture a tap, and an existing draft takes precedence', () => {
  assert.equal(pickTrackContinuation([manual], { x: 5, y: 20 }, project, { draftEmpty: true }), null);
  assert.equal(pickTrackContinuation([{ ...manual, hidden: true }], { x: 5, y: 0 }, project, { draftEmpty: true }), null);
  assert.equal(pickTrackContinuation([manual], { x: 5, y: 0 }, project, { draftEmpty: false }), null);
});

test('continuation rejects segment and point limits before preparing an unsavable branch', () => {
  const manySegments = { ...manual, segments: Array.from({ length: 100 }, () => line) };
  assert.throws(() => prepareTrackContinuation(manySegments, [103.005, 30]), /100段/);
  const manyPoints = {
    ...manual,
    segments: [[...Array.from({ length: MAX_TRACK_POINTS }, (_, index) => [103 + index * 1e-8, 30])]],
  };
  assert.throws(() => prepareTrackContinuation(manyPoints), /6000点/);
});
