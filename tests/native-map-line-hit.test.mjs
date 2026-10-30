import assert from 'node:assert/strict';
import test from 'node:test';
import { pickNearestVisibleLine } from '../modules/map/native/lineHitTest.ts';
import { interpretNativeTap } from '../modules/map/native/tapSemantics.ts';

const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
const tapPoint = (x, y) => ({ x, y });
const track = (id, y, hidden = false) => ({ id, hidden, segments: [[[0, y / 100], [1, y / 100]]] });
const tracks = (saved = [], visible = true) => ({ visible, saved, draft: [], style: { opacity: 1 } });
const route = (segments = [{ kind: 'road', coordinates: [[0, 0], [1, 0]] }], displayOpacity = 1) => ({
  route: { coordinates: segments[0]?.coordinates ?? [], segments, displayOpacity }, start: null, end: null,
});

test('fallback compares real CSS-pixel distance across planned route and saved tracks', () => {
  const hit = pickNearestVisibleLine(tapPoint(50, 1), tracks([track('far-track', 5)]), route(), project);
  assert.equal(hit.kind, 'route');
  assert.ok(Math.abs(hit.distance - 1) < 0.01);

  const nearestTrack = pickNearestVisibleLine(tapPoint(50, 4), tracks([track('first', 9), track('second', 2)]), undefined, project);
  assert.equal(nearestTrack?.kind, 'track');
  assert.equal(nearestTrack?.point.trackId, 'second');
  assert.ok(Math.abs(nearestTrack.distance - 2) < 0.01);
});

test('line fallback uses the web 12 CSS-pixel target radius without changing line width', () => {
  assert.ok(Math.abs(pickNearestVisibleLine(tapPoint(50, 12), tracks([track('edge', 0)]), undefined, project)?.distance - 12) < 0.01);
  assert.equal(pickNearestVisibleLine(tapPoint(50, 12.1), tracks([track('miss', 0)]), undefined, project), null);
});

test('hidden tracks, transparent routes, and segment breaks are not selectable', () => {
  assert.equal(pickNearestVisibleLine(tapPoint(50, 0), tracks([track('hidden', 0, true)]), undefined, project), null);
  assert.equal(pickNearestVisibleLine(tapPoint(50, 0), tracks(), route(undefined, 0), project), null);
  const broken = route([
    { kind: 'road', coordinates: [[0, 0], [0.2, 0]] },
    { kind: 'road', coordinates: [[0.8, 0], [1, 0]] },
  ]);
  assert.equal(pickNearestVisibleLine(tapPoint(50, 0), tracks(), broken, project), null);
  assert.equal(pickNearestVisibleLine(tapPoint(50, 0), tracks([track('hidden-all', 0)], false), undefined, project), null);
  assert.equal(pickNearestVisibleLine(tapPoint(50, 0), tracks([{ ...track('transparent', 0), style: { opacity: 0 } }]), undefined, project), null);
});

test('nearest fallback compares route and tracks together and keeps route gaps empty', () => {
  const hit = pickNearestVisibleLine(tapPoint(50, 3), tracks([track('near-track', 9)]), route(), project);
  assert.equal(hit.kind, 'route');
  assert.ok(Math.abs(hit.distance - 3) < 0.01);
  const gap = route([
    { kind: 'road', coordinates: [[0, 0], [0.2, 0]] },
    { kind: 'road', coordinates: [[0.8, 0], [1, 0]] },
  ]);
  assert.equal(pickNearestVisibleLine(tapPoint(50, 0), tracks(), gap, project), null);
});

test('a native GL miss still selects the closest visible line and planned route', () => {
  const base = {
    readOnly: false, drawingActive: false, clickBlocked: false, pickingActive: false,
    annotationPicking: false, measurementPicking: false, sectionEditing: false,
    sectionEnabled: false, sectionItems: [], annotations: [], photos: [],
    areaOverlay: { items: [], selected: null, draft: [] },
  };
  const trackOverlay = tracks([track('near', 2)]);
  const trackAction = interpretNativeTap({ point: tapPoint(50, 4), coordinate: [0.5, 0.04], ids: [] }, {
    ...base, trackOverlay,
  }, project);
  assert.equal(trackAction.type, 'trackLine');
  assert.equal(trackAction.point.trackId, 'near');
  assert.equal(trackAction.point.coordinate[1], 0.02);

  const routeAction = interpretNativeTap({ point: tapPoint(50, 1), coordinate: [0.5, 0.01], ids: [] }, {
    ...base, trackOverlay: tracks(), routeOverlay: route(),
  }, project);
  assert.deepEqual(routeAction, { type: 'route' });
});
