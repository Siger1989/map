import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretNativeTap, NativeTapGestureGate } from '../modules/map/native/tapSemantics.ts';

function setup(overrides = {}) {
  const state = {
    readOnly: false, drawingActive: false, clickBlocked: false, queryOnPick: true,
    pickingActive: false, annotationPicking: false, measurementPicking: false,
    sectionEditing: false, sectionEnabled: false, sectionItems: [], annotations: [], photos: [],
    photoGroups: [], areaOverlay: { items: [], selected: null, draft: [] },
    trackOverlay: { visible: true, editing: false, saved: [], draft: [] },
    ...overrides,
  };
  const project = ([longitude, latitude]) => ({ x: longitude * 100, y: latitude * 100 });
  const tap = (ids, coordinate = [0, 0], point = coordinate ? { x: coordinate[0] * 100, y: coordinate[1] * 100 } : { x: 0, y: 0 }) => ({ point, coordinate, ids });
  return { state, project, tap };
}

const annotation = { id: 'pin-a', kind: 'pin', visible: true };
const track = { id: 'track-a', hidden: false, segments: [[[-1, 0], [1, 0]]], nodes: [] };
const trackOverlay = { visible: true, editing: false, saved: [track], draft: [] };
const bridge = (value) => `shantu-bridge:${JSON.stringify(value)}`;

test('read-only, drawing, and drag/long-press blocked taps produce no callbacks', () => {
  for (const state of [{ readOnly: true }, { drawingActive: true }, { clickBlocked: true }]) {
    const h = setup(state);
    assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:pin-a']), h.state, h.project), { type: 'none' });
  }
});

test('annotation picking selects the hit annotation before any map or route action', () => {
  const h = setup({ annotationPicking: true, annotations: [annotation] });
  assert.deepEqual(interpretNativeTap(h.tap(['__planned-route', 'shantu-object:pin-a']), h.state, h.project), { type: 'annotation', id: 'pin-a' });
  assert.deepEqual(interpretNativeTap(h.tap([bridge({ kind: 'route' })]), h.state, h.project), { type: 'route' }, 'a missed annotation pick still resolves route semantics');
});

test('one-pixel GPU annotation IDs outrank expanded-target candidates and saved array order', () => {
  const h = setup({ annotations: [annotation, { ...annotation, id: 'pin-b' }] });
  assert.deepEqual(interpretNativeTap({ ...h.tap(['shantu-object:pin-a', 'shantu-object:pin-b']), exactIds: ['shantu-object:pin-b'] }, h.state, h.project), {
    type: 'annotation', id: 'pin-b',
  });
});

test('expanded 44px target selects only an unambiguous marker candidate', () => {
  const h = setup({ annotations: [annotation, { ...annotation, id: 'pin-b' }] });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:pin-b'], [0, 0]), h.state, h.project), { type: 'annotation', id: 'pin-b' });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:pin-b', 'shantu-object:pin-a'], [0, 0]), h.state, h.project), {
    type: 'mapPick', coordinate: [0, 0], queryPoint: true,
  }, 'ambiguous rectangle hits must not keep selecting the first saved annotation');
});

test('native tap completion gate rejects cancelled and previous-gesture IDs', () => {
  const gate = new NativeTapGestureGate();
  gate.observe(41); // ACTION_DOWN, then ACTION_UP for this same tap.
  assert.equal(gate.accepts(41), true);
  gate.cancel(41); // ACTION_POINTER_DOWN / ACTION_CANCEL arrived before the async pick reply.
  assert.equal(gate.accepts(41), false);
  gate.observe(43); // A new ACTION_DOWN has started; delayed IDs from 41 are stale.
  assert.equal(gate.accepts(41), false);
  assert.equal(gate.accepts(43), true);
  gate.observe(41); // A delayed older DOWN must not roll the active gesture back.
  assert.equal(gate.accepts(41), false);
  assert.equal(gate.accepts(43), true);
});

test('object picks work without terrain and a blank miss clears selection without inventing a coordinate', () => {
  const h = setup({ annotations: [annotation] });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:pin-a'], null), h.state, h.project), { type: 'annotation', id: 'pin-a' });
  assert.deepEqual(interpretNativeTap(h.tap([], null), h.state, h.project), { type: 'clearSelection' });
  const dualBrowse = setup({ annotationPicking: true });
  assert.deepEqual(interpretNativeTap(dualBrowse.tap([], null), dualBrowse.state, dualBrowse.project), { type: 'clearSelection' }, 'dual-map browse enables marker hit priority but blank space still clears selection');
  const placement = setup({ annotationPicking: true, pickingActive: true });
  assert.deepEqual(interpretNativeTap(placement.tap([], null), placement.state, placement.project), { type: 'none' }, 'active marker placement must retain its workflow');
  const editing = setup({ trackOverlay: { ...trackOverlay, editing: true } });
  assert.deepEqual(interpretNativeTap(editing.tap([], null), editing.state, editing.project), { type: 'none' });
});

test('measurement picking prefers a native track node and suppresses point query', () => {
  const h = setup({ measurementPicking: true, trackOverlay });
  assert.deepEqual(interpretNativeTap(h.tap([bridge({ kind: 'trackNode', trackId: 'track-a', coordinate: [0.25, 0.5] })]), h.state, h.project), {
    type: 'mapPick', coordinate: [0.25, 0.5], queryPoint: false,
  });
});

test('measurement picking refines a native track hit to the original rendered line point', () => {
  const h = setup({ measurementPicking: true, trackOverlay });
  const action = interpretNativeTap(h.tap([bridge({ kind: 'track', trackId: 'track-a' })], [0.5, 0.2], { x: 50, y: 3 }), h.state, h.project);
  assert.equal(action.type, 'mapPick');
  assert.ok(Math.abs(action.coordinate[0] - 0.5) < 0.001);
  assert.equal(action.coordinate[1], 0);
  assert.equal(action.queryPoint, false);
});

test('measurement picking uses selected area edit vertices before the raw tap location', () => {
  const area = { id: 'area-a', visible: true, boundary: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] };
  const h = setup({ measurementPicking: true, areaOverlay: { items: [area], selected: 'area-a', draft: [] } });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:area-a'], [0.1, 0]), h.state, h.project), {
    type: 'mapPick', coordinate: [0, 0], queryPoint: false,
  });
});

test('section mode resolves saved and active section picks before ordinary track selection', () => {
  const h = setup({ sectionEnabled: true, sectionItems: [{ id: 'section-a', settings: { enabled: true } }], trackOverlay });
  assert.deepEqual(interpretNativeTap(h.tap(['track:track-a:0', 'shantu-section:section-a']), h.state, h.project), { type: 'section', id: 'section-a' });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-section:__active']), h.state, h.project), { type: 'section' });
});

test('section editing prioritizes marker selection; general picking suppresses object selection', () => {
  const h = setup({ sectionEnabled: true, sectionEditing: true, annotations: [annotation], trackOverlay });
  assert.deepEqual(interpretNativeTap(h.tap([bridge({ kind: 'track', trackId: 'track-a' }), 'shantu-object:pin-a']), h.state, h.project), { type: 'annotation', id: 'pin-a' });
  h.state.sectionEditing = false; h.state.pickingActive = true;
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:pin-a']), h.state, h.project), { type: 'mapPick', coordinate: [0, 0], queryPoint: true });
});

test('track editing prioritizes nodes, then line points, then route, and otherwise map coordinate', () => {
  const h = setup({ trackOverlay: { ...trackOverlay, editing: true } });
  assert.deepEqual(interpretNativeTap(h.tap([bridge({ kind: 'trackNode', trackId: 'track-a', coordinate: [0, 0] })]), h.state, h.project), {
    type: 'trackNode', node: { trackId: 'track-a', coordinate: [0, 0] },
  });
  assert.equal(interpretNativeTap(h.tap([bridge({ kind: 'track', trackId: 'track-a' })], [0.5, 0], { x: 50, y: 0 }), h.state, h.project).type, 'trackLine');
  assert.deepEqual(interpretNativeTap(h.tap(['__planned-route']), h.state, h.project), { type: 'route' });
  assert.deepEqual(interpretNativeTap(h.tap([], [2, 3]), h.state, h.project), { type: 'mapPick', coordinate: [2, 3], queryPoint: true });
});

test('browse selection prioritizes annotations, routes, track geometry, areas, and photo groups', () => {
  const photo = { id: 'photo-a', kind: 'point', coordinates: [2, 3] };
  const area = { id: 'area-a', visible: true, boundary: [[0, 0], [1, 0], [1, 1], [0, 0]] };
  const h = setup({ annotations: [annotation], photos: [photo], photoGroups: [{ photo, groupIds: ['photo-a', 'photo-b'] }], areaOverlay: { items: [area], selected: null, draft: [] }, trackOverlay });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:pin-a', '__planned-route']), h.state, h.project), { type: 'annotation', id: 'pin-a' });
  assert.deepEqual(interpretNativeTap(h.tap(['__planned-route', 'track:track-a:0']), h.state, h.project), { type: 'route' });
  assert.equal(interpretNativeTap(h.tap([bridge({ kind: 'track', trackId: 'track-a' })], [0.5, 0], { x: 50, y: 0 }), h.state, h.project).type, 'trackLine');
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:area-a']), h.state, h.project), { type: 'area', id: 'area-a' });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-photo:photo-a']), h.state, h.project), { type: 'photo', ids: ['photo-a', 'photo-b'] });
});

test('geology and other noninteractive native IDs do not block a nearby line fallback', () => {
  const h = setup({ trackOverlay });
  const geology = interpretNativeTap(h.tap(['geology:unit-7'], [0.5, 0], { x: 50, y: 2 }), h.state, h.project);
  assert.equal(geology.type, 'trackLine');
  assert.equal(geology.point.trackId, 'track-a');
  const nativeBackdrop = interpretNativeTap(h.tap(['native-terrain:surface'], [0.5, 0], { x: 50, y: 2 }), h.state, h.project);
  assert.equal(nativeBackdrop.type, 'trackLine');

  const competing = setup({
    trackOverlay: { visible: true, editing: false, saved: [{ ...track, segments: [[[-1, 0.05], [1, 0.05]]] }], draft: [] },
    routeOverlay: { route: { coordinates: [[-1, 0], [1, 0]], segments: [{ kind: 'road', coordinates: [[-1, 0], [1, 0]] }] }, start: null, end: null },
  });
  assert.deepEqual(interpretNativeTap(competing.tap(['geology:unit-7'], [0.5, 0.02], { x: 50, y: 2 }), competing.state, competing.project), { type: 'route' });
});

test('geometric fallback requires a nearby native ground hit and preserves exact area picks', () => {
  const area = { id: 'area-a', visible: true, boundary: [[0, 0], [1, 0], [1, 1], [0, 0]] };
  const h = setup({ trackOverlay, areaOverlay: { items: [area], selected: null, draft: [] } });
  assert.deepEqual(interpretNativeTap(h.tap(['geology:unit-7'], null, { x: 50, y: 0 }), h.state, h.project), { type: 'clearSelection' });
  assert.deepEqual(interpretNativeTap(h.tap(['shantu-object:area-a'], [0.5, 0], { x: 50, y: 0 }), h.state, h.project), { type: 'area', id: 'area-a' });
  const farGround = interpretNativeTap(h.tap(['geology:unit-7'], [0.5, 0.2], { x: 50, y: 2 }), h.state, h.project);
  assert.deepEqual(farGround, { type: 'mapPick', coordinate: [0.5, 0.2], queryPoint: true });
});

test('transparent tracks cannot be selected by a native semantic ID', () => {
  const invisible = { ...track, style: { opacity: 0 } };
  const h = setup({ trackOverlay: { visible: true, editing: false, saved: [invisible], draft: [] } });
  assert.deepEqual(interpretNativeTap(h.tap([bridge({ kind: 'track', trackId: 'track-a' })]), h.state, h.project), { type: 'mapPick', coordinate: [0, 0], queryPoint: true });
});

test('a transparent draft style does not disable a saved track with its own visible style', () => {
  const h = setup({ trackOverlay: { ...trackOverlay, style: { opacity: 0 }, saved: [{ ...track, style: { opacity: 1 } }] } });
  const action = interpretNativeTap(h.tap([bridge({ kind: 'track', trackId: 'track-a' })]), h.state, h.project);
  assert.equal(action.type, 'trackLine');
  assert.equal(action.point.trackId, 'track-a');
});
