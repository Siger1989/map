import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {
  startRouteEdit,
  moveEditNode,
  undoRouteEdit,
} from '../modules/tracks/routeEdit.ts';
import { storeJoinedRouteEdit } from '../modules/tracks/joinedEditStore.ts';
import { TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import {
  ANNOTATION_STORAGE,
  newAnnotation,
} from '../modules/annotations/data.ts';
import { collectData } from '../modules/outdoor/exchange.ts';
import {
  groupColorSections,
  routeColorSections,
} from '../modules/tracks/colorSections.ts';
const a = [104, 30],
  b = [104.001, 30],
  c = [104.002, 30],
  d = [104.003, 30];
const route = (id, color, line) => ({
  id,
  name: id,
  source: 'manual',
  createdAt: 1,
  segments: [line],
  style: { color, width: 2 },
  colorConditions: { [color]: id + '路况' },
});
const first = route('first', '#ff0000', [a, b]),
  second = route('second', '#00ff00', [c, d]);
function archive(tracks, annotations = []) {
  const data = new Map([
    [TRACK_STORAGE, JSON.stringify(tracks)],
    [ANNOTATION_STORAGE, JSON.stringify(annotations)],
  ]);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}
test('snapped endpoint becomes a continuous editable route; undo and unsnapped movement do not remove archives', () => {
  const disk = archive([first, second]);
  const session = moveEditNode(startRouteEdit(first), b, c, second);
  assert.deepEqual(session.track.segments, [[a, c, d]]);
  assert.deepEqual(session.track.edgeColors, [['#ff0000', '#00ff00']]);
  assert.equal(session.sources.length, 2);
  assert.equal(collectData(disk).tracks.length, 2);
  const undo = undoRouteEdit(session);
  assert.deepEqual(undo.track.segments, first.segments);
  assert.equal(undo.sources.length, 1);
  assert.equal(moveEditNode(startRouteEdit(first), b, c).sources.length, 1);
  const pin = {
    ...newAnnotation('pin', d, 100, 'pin1'),
    trackAnchor: { trackId: 'second', distance: 1 },
  };
  disk.setItem(ANNOTATION_STORAGE, JSON.stringify([pin]));
  const result = storeJoinedRouteEdit(session, disk, 'unused', 2);
  assert.equal(result.records.length, 1);
  assert.equal(result.track.id, 'first');
  assert.ok(result.track.sourceTrackIds.includes('second'));
  assert.equal(result.track.colorConditions['#00ff00'], 'second路况');
  const saved = collectData(disk);
  assert.equal(saved.annotations[0].trackAnchor.trackId, 'first');
  assert.deepEqual(saved.annotations[0].coordinates, d);
  assert.ok(saved.annotations[0].trackAnchor.distance > 200);
});
test('interior junction keeps three real branches and a third snapped archive participates in undo', () => {
  const target = route('target', '#00ff00', [c, d, [104.004, 30]]);
  const session = moveEditNode(startRouteEdit(first), b, d, target);
  assert.equal(session.track.segments.length, 3);
  const third = route('third', '#0000ff', [
    [104.005, 30],
    [104.006, 30],
  ]);
  const joined = moveEditNode(
    session,
    [104.004, 30],
    third.segments[0][0],
    third,
  );
  assert.equal(joined.sources.length, 3);
  assert.deepEqual(undoRouteEdit(joined).track, session.track);
  assert.equal(undoRouteEdit(joined).sources.length, 2);
});
test('100 saved routes can merge without creating an extra archive; same-colour notes survive', () => {
  const target = {
    ...second,
    style: first.style,
    colorConditions: { '#ff0000': '碎石' },
  };
  const disk = archive([
    first,
    target,
    ...Array.from({ length: 98 }, (_, i) =>
      route('extra' + i, '#0000ff', [a, b]),
    ),
  ]);
  const result = storeJoinedRouteEdit(
    moveEditNode(startRouteEdit(first), b, c, target),
    disk,
    'unused',
    2,
  );
  assert.equal(result.records.length, 99);
  assert.equal(groupColorSections(routeColorSections(result.track)).length, 1);
  assert.equal(result.track.colorConditions['#ff0000'], 'first路况；碎石');
});
test('stale target and storage failure leave geometry, source archives and marker bindings intact', () => {
  const session = moveEditNode(startRouteEdit(first), b, c, second);
  for (const target of [
    { ...second, hidden: true },
    { ...second, name: 'changed' },
  ]) {
    const disk = archive([first, target]),
      snapshot = [...disk.data];
    assert.throws(
      () => storeJoinedRouteEdit(session, disk, 'unused', 2),
      /更新/,
    );
    assert.deepEqual([...disk.data], snapshot);
  }
  const pin = {
    ...newAnnotation('pin', d, 100, 'pin1'),
    trackAnchor: { trackId: 'second', distance: 1 },
  };
  const disk = archive([first, second], [pin]),
    snapshot = [...disk.data];
  let fail = true;
  const write = disk.setItem;
  disk.setItem = (k, v) => {
    if (k === ANNOTATION_STORAGE && fail) {
      fail = false;
      throw Error('quota');
    }
    return write(k, v);
  };
  assert.throws(
    () => storeJoinedRouteEdit(session, disk, 'unused', 2),
    /未保存/,
  );
  assert.deepEqual([...disk.data], snapshot);
});
test('protected/hidden/stale snap targets fail without changing the edit', () => {
  for (const target of [
    { ...second, hidden: true },
    { ...second, source: 'recorded' },
    { ...second, samples: [] },
    { ...second, segments: [[a, b]] },
  ]) {
    const session = startRouteEdit(first);
    assert.throws(() => moveEditNode(session, b, c, target));
    assert.deepEqual(session.track.segments, first.segments);
  }
});
test('one colour is one summary even across gaps, returns and casing; lengths exclude gaps', () => {
  const track = {
    ...first,
    segments: [
      [a, b, c, d],
      [
        [105, 31],
        [105.001, 31],
      ],
    ],
    edgeColors: [['#ff0000', '#00ff00', '#FF0000'], ['#ff0000']],
  };
  const sections = routeColorSections(track),
    groups = groupColorSections(sections);
  assert.equal(sections.length, 4);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].sections.length, 3);
  assert.ok(
    Math.abs(groups.reduce((n, g) => n + g.length, 0) - sections.at(-1).end) <
      1e-8,
  );
  assert.ok(groups[0].length < 400);
});
test('rendered snap targets exist in edit mode and filtering ignores the closer moving source', async () => {
  const compiled = await build({
    entryPoints: ['modules/tracks/TrackLayer.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { TrackLayer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const layers = new Map(),
    sources = new Map();
  let data,
    hits = [];
  const map = {
    getSource: (id) => sources.get(id),
    addSource: (id) =>
      sources.set(id, {
        setData: (next) => {
          if (id === 'manual-tracks') data = next;
        },
      }),
    getLayer: (id) => layers.get(id),
    getStyle: () => ({ layers: [...layers.values()] }),
    addLayer: (l) => layers.set(l.id, l),
    moveLayer() {},
    project: (p) => ({ x: (p[0] - 104) * 100000, y: (p[1] - 30) * 100000 }),
    queryRenderedFeatures: () => hits,
  };
  const layer = new TrackLayer(map);
  const state = {
    saved: [first, second],
    draft: [],
    nodes: [],
    visible: true,
    style: first.style,
    selectedId: first.id,
    editing: true,
    snapTargets: true,
  };
  layer.sync(state);
  const nodes = data.features.filter((f) => f.geometry.type === 'Point');
  assert.ok(nodes.some((f) => f.properties.trackId === 'second'));
  hits = [
    { properties: { trackId: 'first', lng: 104.00204, lat: 30 } },
    { properties: { trackId: 'second', lng: 104.002, lat: 30 } },
  ];
  assert.equal(
    layer.pickNode({ x: 205, y: 0 }, (n) => n.trackId !== 'first', 14).trackId,
    'second',
  );
  assert.equal(
    layer.pickNode({ x: 220, y: 0 }, (n) => n.trackId !== 'first', 14),
    null,
  );
  layer.sync({ ...state, snapTargets: false });
  assert.equal(
    data.features
      .filter((f) => f.geometry.type === 'Point')
      .some((f) => f.properties.trackId === 'second'),
    false,
  );
});
