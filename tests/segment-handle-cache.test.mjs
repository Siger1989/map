import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { nodeHandles } from '../modules/tracks/editing.ts';

const bundle = await build({
  entryPoints: ['modules/tracks/SegmentHandleCache.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { SegmentHandleCache } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function makeProject(counter, scale = 1000, offset = 0) {
  return point => {
    counter.count++;
    return { x: point[0] * scale + offset, y: point[1] * scale - offset };
  };
}

test('matches nodeHandles for random segments, duplicates, explicit nodes, and selection modes', () => {
  let seed = 0x5eed1234;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const cache = new SegmentHandleCache();
  const counter = { count: 0 };
  const project = makeProject(counter, 1e6);
  for (let run = 0; run < 250; run++) {
    const segments = Array.from({ length: Math.floor(random() * 5) }, () => {
      const points = [];
      for (let i = 0, n = Math.floor(random() * 24); i < n; i++) {
        if (points.length && random() < 0.16) {
          const prior = points[Math.floor(random() * points.length)];
          points.push(random() < 0.5 ? prior : [...prior]);
        } else points.push([Math.floor(random() * 40) / 1e6, Math.floor(random() * 40) / 1e6]);
      }
      return points;
    });
    const all = segments.flat();
    const explicit = Array.from({ length: Math.floor(random() * 12) }, () =>
      all.length && random() < 0.8 ? [...all[Math.floor(random() * all.length)]] : [9 + random(), 9 + random()]);
    for (const expanded of [false, true]) {
      const expected = nodeHandles(segments, explicit, expanded, point => ({ x: point[0] * 1e6, y: point[1] * 1e6 }));
      const actual = cache.get(`random-${run}`, segments, explicit, expanded, 0, project);
      assert.deepEqual(actual, expected, `run ${run}, expanded ${expanded}`);
    }
  }
});

test('append reprojects only the changed segment while preserving output order', () => {
  const cache = new SegmentHandleCache(), counter = { count: 0 };
  const project = makeProject(counter);
  const main = Array.from({ length: 5800 }, (_, i) => [i / 1000, 0]);
  const start = main[2900];
  const firstBranch = [start, [2.901, 0.01]];
  const explicit = [main[0], main.at(-1), firstBranch[1]];
  const before = [main, firstBranch];
  const expectedBefore = nodeHandles(before, explicit, true, p => ({ x: p[0] * 1000, y: p[1] * 1000 }));
  assert.deepEqual(cache.get('route', before, explicit, true, 7, project), expectedBefore);
  assert.equal(counter.count, 5800, 'one projection per first vertex/interior vertex on both segments');

  const nextBranch = [...firstBranch, [2.902, 0.02]];
  const after = [main, nextBranch];
  const nextExplicit = [...explicit, nextBranch.at(-1)];
  const projectedBeforeAppend = counter.count;
  const expectedAfter = nodeHandles(after, nextExplicit, true, p => ({ x: p[0] * 1000, y: p[1] * 1000 }));
  assert.deepEqual(cache.get('route', after, nextExplicit, true, 7, project), expectedAfter);
  assert.equal(counter.count - projectedBeforeAppend, 2, 'only the two vertices in the changed branch are projected');
});

test('epoch, moving, explicit changes, branch visibility, new segments, and undo invalidate safely', () => {
  const cache = new SegmentHandleCache(), counter = { count: 0 };
  const project = makeProject(counter, 1000);
  const a = Array.from({ length: 80 }, (_, i) => [i / 100, 0]);
  const b = [[0.4, 0], [0.4, 0.1]];
  const explicit = [[0, 0], [0.79, 0], [0.4, 0.1]];
  let segments = [a, b];
  const expected = (selected, epoch, points = explicit) => nodeHandles(segments, points, selected,
    point => ({ x: point[0] * 1000 + epoch, y: point[1] * 1000 - epoch }));
  assert.deepEqual(cache.get('route', segments, explicit, true, 1, project), expected(true, 1));
  const initial = counter.count;
  assert.deepEqual(cache.get('route', segments, explicit, true, 1, project), expected(true, 1));
  assert.equal(counter.count, initial, 'same immutable snapshot and camera reuses all work');
  assert.deepEqual(cache.get('route', segments, explicit, true, 2, project), expected(true, 2));
  assert.equal(counter.count - initial, 80, 'new projection epoch resamples every interior point');

  const changedExplicit = [[0, 0], [0.4, 0], [100, 100]];
  assert.deepEqual(cache.get('route', segments, changedExplicit, true, 2, project), expected(true, 2, changedExplicit));
  const afterSelection = counter.count;
  assert.deepEqual(cache.get('route', segments, changedExplicit, false, 2, project),
    nodeHandles(segments, changedExplicit, false, p => ({ x: p[0] * 1000, y: p[1] * 1000 })));
  assert.equal(counter.count, afterSelection, 'turning off expanded handles needs no projection');

  const afterToggle = counter.count;
  assert.deepEqual(cache.get('route', segments, changedExplicit, true, 2, project), expected(true, 2, changedExplicit));
  assert.equal(counter.count - afterToggle, 0, 'selection toggle reuses samples while geometry and camera stay fixed');

  const withNewBranch = [a, b, [[0.4, 0], [0.6, 0.1]]];
  segments = withNewBranch;
  assert.deepEqual(cache.get('route', segments, changedExplicit, true, 2, project), expected(true, 2, changedExplicit));
  const afterBranch = counter.count;
  assert.deepEqual(cache.get('route', [a, b], changedExplicit, true, 2, project),
    nodeHandles([a, b], changedExplicit, true, p => ({ x: p[0] * 1000 + 2, y: p[1] * 1000 - 2 })));
  assert.equal(counter.count - afterBranch, 0, 'undo reuses still-current unchanged segment samples');

  const beforeMove = counter.count;
  segments = [a, b];
  const movedProject = makeProject(counter, 1000, 10000);
  assert.deepEqual(cache.get('route', [a, b], changedExplicit, true, 3, movedProject, true),
    nodeHandles([a, b], changedExplicit, true, p => ({ x: p[0] * 1000 + 10000, y: p[1] * 1000 - 10000 })));
  assert.ok(counter.count > beforeMove, 'moving never reuses cached screen positions');
  const afterMove = counter.count;
  assert.deepEqual(cache.get('route', [a, b], changedExplicit, true, 3, project), expected(true, 3, changedExplicit));
  assert.ok(counter.count > afterMove, 'moving evicts the route sample before the next stationary read');
});

test('viewport path prefilters by geography, samples visible nodes, and exposes adjacent boundary controls', () => {
  const cache = new SegmentHandleCache(), counter = { count: 0 };
  const segment = Array.from({ length: 1001 }, (_, i) => [i / 1000, 0]);
  const explicit = [segment[0], segment.at(-1)];
  const project = point => { counter.count++; return { x: (point[0] - .5) * 1000 + 60, y: 50 }; };
  const small = { west: .44, east: .56, south: -.1, north: .1, width: 120, height: 100, revision: 1 };
  const narrow = cache.get('viewport', [segment], explicit, true, 1, project, false, small);
  assert.ok(narrow.length < 20 && narrow.length > 2, `expected sparse visible controls, got ${narrow.length}`);
  assert.ok(counter.count < 250, `geographic filter should avoid projecting the full segment, got ${counter.count}`);
  assert.ok(narrow.every(p => viewportScreen(p).x >= -24 && viewportScreen(p).x <= 144));
  const boundaries = cache.boundaryControls('viewport');
  assert.equal(boundaries.length, 2);
  assert.ok(boundaries.every(p => !narrow.includes(p)));

  const wide = { ...small, west: .2, east: .8, width: 600, revision: 2 };
  const wider = cache.get('viewport', [segment], explicit, true, 2, project, false, wide);
  assert.ok(wider.length > narrow.length, 'zooming out to a larger visible area adds editable controls');
  assert.ok(cache.boundaryControls('viewport').length <= 2);

  const fallback = cache.get('viewport', [segment], explicit, true, 3, project, false, null);
  assert.deepEqual(fallback, nodeHandles([segment], explicit, true, project));
});

test('viewport prefilters large explicit-node sets and keeps shared junctions plus each screen reentry boundary', () => {
  const cache = new SegmentHandleCache(), counter = { count: 0 };
  const segment = Array.from({ length: 10001 }, (_, i) => [i / 10000, 0]);
  const explicit = segment.slice();
  const viewport = { west: .49, east: .51, south: -.1, north: .1, width: 100, height: 100, revision: 1 };
  const project = p => { counter.count++; return { x: (p[0] - .5) * 10000 + 50, y: 50 }; };
  const handles = cache.get('many', [segment], explicit, true, 1, project, false, viewport);
  assert.ok(counter.count < 300, `only nearby candidates should be projected, got ${counter.count}`);
  assert.ok(handles.length < 20, `explicit nodes should use screen spacing, got ${handles.length}`);
  counter.count = 0;
  cache.get('many', [segment], explicit, true, 2, project, true, { ...viewport, revision: 2 });
  assert.ok(counter.count < 300, `moving viewport reads must keep geographic prefiltering, got ${counter.count}`);

  const route = Array.from({ length: 31 }, (_, i) => [i / 100, .01]);
  const junction = route[5];
  const branch = [junction, [.06, .02]];
  const splitViewport = { west: 0, east: .31, south: 0, north: .03, width: 100, height: 100, revision: 2 };
  const splitProject = p => {
    const i = Math.round(p[0] * 100);
    const x = i <= 9 || i >= 21 ? 50 : 200;
    return { x, y: 50 };
  };
  const splitHandles = cache.get('split', [route, branch], [], true, 2, splitProject, false, splitViewport);
  assert.ok(splitHandles.some(p => p === junction), 'shared junction remains directly editable');
  const edges = cache.boundaryControls('split');
  for (const point of [route[10], route[20]])
    assert.ok(edges.some(p => p === point), `expected boundary control at ${point[0]}, got ${edges.map(p => p[0]).join(',')}`);
  assert.ok(edges.length <= 4, `boundaries should be per visible run, got ${edges.length}`);
});

test('immutable drag commits keep sampled vertex indices until the camera epoch changes', () => {
  const cache = new SegmentHandleCache();
  const original = Array.from({ length: 101 }, (_, i) => [i * .00048, 0]);
  const moved = original.map(([lng]) => [(lng - .024) * 4 + .12, 0]);
  const movedAgain = moved.map(([lng]) => [(lng - .12) * 1.05 + .12, 0]);
  const explicit = [];
  const viewport = { west: -.5, east: .5, south: -.1, north: .1, width: 400, height: 100, revision: 1 };
  const project = p => ({ x: p[0] * 1000 + 200, y: 50 });
  const before = cache.get('drag', [original], explicit, true, 7, project, false, viewport, 14.04);
  assert.equal(before.length, 3, 'initial compact route exposes three spaced handles');

  const during = cache.get('drag', [moved], explicit, true, 7, project, false, viewport, 14.04);
  assert.equal(during.length, before.length, 'stretching committed geometry does not reveal more handles at the same zoom');
  const secondDrag = cache.get('drag', [movedAgain], explicit, true, 7, project, false, viewport, 14.04);
  assert.equal(secondDrag.length, before.length, 'a second immutable drag also keeps the original controls');
  const released = cache.get('drag', [movedAgain], explicit, true, 7, project, false, viewport, 14.04);
  assert.deepEqual(released, secondDrag, 'same-geometry rebuild uses the remapped controls');

  const zoomed = cache.get('drag', [movedAgain], explicit, true, 8, project, false, { ...viewport, revision: 2 }, 14.1);
  assert.ok(zoomed.length > released.length, 'a camera epoch change resamples and reveals additional handles');
});

test('pan keeps a stretched edit span suppressed while exposing newly visible untouched route vertices', () => {
  const cache = new SegmentHandleCache();
  const original = Array.from({ length: 301 }, (_, i) => [i * .001, 0]);
  const explicit = [];
  const initialViewport = { west: -.01, east: .11, south: -.1, north: .1, width: 120, height: 100, revision: 1 };
  const initialProject = p => ({ x: (p[0] + .01) * 1000, y: 50 });
  const before = cache.get('pan-lock', [original], explicit, true, 1, initialProject, false, initialViewport, 14.04);
  const beforeIndices = new Set(before.map(point => original.indexOf(point)));
  const moved = original.map(([lng], i) => i === 48 ? [lng + .0173, 0] : [lng, 0]);
  const dragProject = p => ({ x: (p[0] + .01) * 1000, y: 50 });
  const afterDrag = cache.get('pan-lock', [moved], explicit, true, 1, dragProject, false, initialViewport, 14.04);
  const afterDragIndices = new Set(afterDrag.map(point => moved.indexOf(point)));
  assert.deepEqual([...afterDragIndices].sort((a,b)=>a-b), [...beforeIndices].sort((a,b)=>a-b), 'commit retains the original visible index set');

  const panViewport = { west: .1, east: .22, south: -.1, north: .1, width: 120, height: 100, revision: 2 };
  const panProject = p => ({ x: (p[0] - .1) * 1000, y: 50 });
  const afterPan = cache.get('pan-lock', [moved], explicit, true, 2, panProject, true, panViewport, 14.04);
  const panIndices = new Set(afterPan.map(point => moved.indexOf(point)));
  for (let i = 25; i < 72; i++) if (![24,48,72].includes(i)) assert.ok(!panIndices.has(i), `edited span must stay suppressed at ${i}`);
  assert.ok([...panIndices].some(i => i >= 120 && i <= 220), 'the newly panned-to region still gets sampled handles');

  const zoomViewport = { ...initialViewport, width: 400, revision: 3 };
  const zoomProject = p => ({ x: (p[0] + .01) * 4000, y: 50 });
  const afterZoom = cache.get('pan-lock', [moved], explicit, true, 3, zoomProject, false, zoomViewport, 14.1);
  assert.ok(afterZoom.some(point => { const i = moved.indexOf(point); return i > 48 && i < 72; }), 'new zoom detail unlocks the edited interval');
});

test('same-detail pan preserves edited-span locks when a drag creates a new overlap topology', () => {
  const cache = new SegmentHandleCache();
  const original = Array.from({ length: 301 }, (_, i) => [i * .001, 0]);
  const firstViewport = { west: -.01, east: .11, south: -.1, north: .1, width: 120, height: 100, revision: 1 };
  const firstProject = p => ({ x: (p[0] + .01) * 1000, y: 50 });
  const controls = cache.get('overlap-lock', [original], [], true, 1, firstProject, false, firstViewport, 14.04);
  const moved = original.map((point, index) => index === 48 ? original[248] : point);
  const afterCommit = cache.get('overlap-lock', [moved], [], true, 1, firstProject, false, firstViewport, 14.04);
  assert.ok(afterCommit.length <= controls.length, 'the moved handle may leave the viewport but should not reveal denser controls');
  for (const point of controls) if (point !== original[48])
    assert.ok(afterCommit.includes(point), 'unmoved visible controls remain accepted');

  const panViewport = { west: .025, east: .145, south: -.1, north: .1, width: 120, height: 100, revision: 2 };
  const panProject = p => ({ x: (p[0] - .025) * 1000, y: 50 });
  const afterPan = cache.get('overlap-lock', [moved], [], true, 2, panProject, true, panViewport, 14.04);
  const panIndices = new Set(afterPan.map(point => moved.indexOf(point)));
  for (let i = 25; i < 72; i++) if (![48].includes(i))
    assert.ok(!panIndices.has(i), `overlap topology must not unlock the prior edited span at vertex ${i}`);
  const overlapViewport = { west: .2, east: .32, south: -.1, north: .1, width: 120, height: 100, revision: 3 };
  const overlapProject = p => ({ x: (p[0] - .2) * 1000, y: 50 });
  const overSharedPoint = cache.get('overlap-lock', [moved], [], true, 3, overlapProject, false, overlapViewport, 14.04);
  assert.ok(overSharedPoint.some(point => point[0] === original[248][0]), 'the newly shared coordinate remains a topology control when visible');
});

test('same-detail expansion collapse and re-entry retain edit locks without forcing collapsed controls', () => {
  const cache = new SegmentHandleCache();
  const original = Array.from({ length: 301 }, (_, i) => [i * .001, 0]);
  const firstViewport = { west: -.01, east: .11, south: -.1, north: .1, width: 120, height: 100, revision: 1 };
  const firstProject = p => ({ x: (p[0] + .01) * 1000, y: 50 });
  const baseline = cache.get('collapse-lock', [original], [], true, 1, firstProject, false, firstViewport, 14.04);
  const moved = original.map(([lng, lat], index) => index === 48 ? [lng + .018, lat + .01] : [lng, lat]);
  const committed = cache.get('collapse-lock', [moved], [], true, 1, firstProject, false, firstViewport, 14.04);
  assert.equal(committed.length, baseline.length);

  const collapsed = cache.get('collapse-lock', [moved], [], false, 1, firstProject, false, firstViewport, 14.04);
  assert.ok(collapsed.length < committed.length, 'collapsed mode does not force all locked controls into the result');
  const reentered = cache.get('collapse-lock', [moved], [], true, 1, firstProject, false, firstViewport, 14.04);
  assert.equal(reentered.length, committed.length, 're-entering at the same detail restores the prior accepted control set');

  const panViewport = { west: .025, east: .145, south: -.1, north: .1, width: 120, height: 100, revision: 2 };
  const panProject = p => ({ x: (p[0] - .025) * 1000, y: 50 });
  const afterPan = cache.get('collapse-lock', [moved], [], true, 2, panProject, true, panViewport, 14.04);
  const panIndices = new Set(afterPan.map(point => moved.indexOf(point)));
  for (let i = 25; i < 72; i++) if (![48].includes(i))
    assert.ok(!panIndices.has(i), `collapse/re-entry must keep the edited span suppressed at vertex ${i}`);
});

function viewportScreen(point) { return { x: (point[0] - .5) * 1000 + 60, y: 50 }; }
