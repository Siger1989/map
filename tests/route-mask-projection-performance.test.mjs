import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/routeIconPriorityGeometry.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { projectRouteFeature } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// Frozen projection loop from b38f83c, retained here as the output oracle.
function oldProjection(map, feature, viewport) {
  const finite = Number.isFinite;
  const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const clipSegment = (a, b, bounds) => {
    const dx = b[0] - a[0], dy = b[1] - a[1]; let lo = 0, hi = 1;
    for (const [p, q] of [[-dx, a[0] - bounds.left], [dx, bounds.right - a[0]],
      [-dy, a[1] - bounds.top], [dy, bounds.bottom - a[1]]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const t = q / p; if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return null;
    }
    return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
  };
  const clipPaths = (points, bounds) => {
    const output = []; let current = [];
    const flush = () => { if (current.length > 1) output.push(current); current = []; };
    for (let i = 1; i < points.length; i++) {
      const clipped = clipSegment(points[i - 1], points[i], bounds);
      if (!clipped) { flush(); continue; }
      const [a, b] = clipped, previous = current.at(-1);
      if (!previous || Math.hypot(previous[0] - a[0], previous[1] - a[1]) > 0.75) { flush(); current.push(a); }
      current.push(b);
    }
    flush(); return output;
  };
  const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return lines.flatMap(coordinates => {
    const runs = []; let run = [], samples = 0;
    const project = c => { const p = map.project(c); return finite(p.x) && finite(p.y) ? [p.x, p.y] : null; };
    const bounds = { left: viewport.left - 16, top: viewport.top - 16, right: viewport.right + 16, bottom: viewport.bottom + 16 };
    const flush = () => { if (run.length > 1) runs.push(run); run = []; };
    const intersects = ps => Math.max(...ps.map(p => p[0])) >= bounds.left && Math.min(...ps.map(p => p[0])) <= bounds.right &&
      Math.max(...ps.map(p => p[1])) >= bounds.top && Math.min(...ps.map(p => p[1])) <= bounds.bottom;
    for (let i = 1; i < coordinates.length && samples < 12000; i++) {
      const a = coordinates[i - 1], b = coordinates[i], pa = project(a), pb = project(b);
      if (!pa || !pb) { flush(); continue; }
      const pm = project(interpolate(a, b, 0.5));
      if (!pm || !intersects([pa, pm, pb])) { flush(); continue; }
      const span = Math.hypot(pm[0] - pa[0], pm[1] - pa[1]) + Math.hypot(pb[0] - pm[0], pb[1] - pm[1]);
      const steps = Math.max(2, Math.min(64, Math.ceil(span / 8)));
      if (samples + steps > 12000) { flush(); break; }
      for (let step = 0; step <= steps; step++) {
        const p = step === 0 ? pa : step === steps ? pb : project(interpolate(a, b, step / steps));
        if (p && (!run.length || Math.hypot(run.at(-1)[0] - p[0], run.at(-1)[1] - p[1]) > 0.1)) run.push(p);
        samples++;
      }
    }
    flush(); return runs.flatMap(points => clipPaths(points, bounds));
  });
}

const viewport = { left: 0, top: 0, right: 390, bottom: 857 };
function countedMap(project) {
  let calls = 0;
  return { map: { project: c => { calls++; return project(c); } }, calls: () => calls };
}
const identityProjection = c => ({ x: c[0], y: c[1] });

test('projection reuse exactly preserves b38f83c output across breaks, parity, clipping, and multiline inputs', () => {
  const cases = [
    { type: 'LineString', coordinates: [[30, 40], [40, 50], [70, 45], [100, 90], [420, 860], [200, 300]] },
    { type: 'LineString', coordinates: [[5, 10], [35, 10], [65, 10], [95, 10], [125, 10]] }, // even steps
    { type: 'LineString', coordinates: [[4, 4], [21, 4], [44, 4], [61, 21]] }, // odd steps
    { type: 'LineString', coordinates: [[20, 30], [40, 40], [60, 50], [80, 60]] }, // narrow viewport clipping
    { type: 'MultiLineString', coordinates: [
      [[20, 100], [60, 120], [100, 140]], [[300, 300], [340, 320], [380, 340]],
      [[10, 500], [Number.NaN, 510], [30, 520], [60, 530]],
    ] },
  ];
  const projectWithBreaks = c => c[0] === 40 || c[0] === 65 ? { x: NaN, y: NaN } : identityProjection(c);
  for (const geometry of cases) {
    for (const projection of [identityProjection, projectWithBreaks]) {
      const feature = { type: 'Feature', properties: {}, geometry };
      for (const bounds of [viewport, { left: 20, top: 20, right: 80, bottom: 80 }]) {
        assert.deepEqual(projectRouteFeature({ project: projection }, feature, bounds),
          oldProjection({ project: projection }, feature, bounds));
      }
    }
  }
});

test('10k-point dense route reduces project calls and reports Node elapsed time', () => {
  const coordinates = Array.from({ length: 10_000 }, (_, i) => [30 + (i % 340) * 0.15, 100 + Math.sin(i / 17) * 0.08]);
  const feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
  const oldCounter = countedMap(identityProjection), newCounter = countedMap(identityProjection);
  const oldStart = performance.now(); const before = oldProjection(oldCounter.map, feature, viewport); const oldMs = performance.now() - oldStart;
  const newStart = performance.now(); const after = projectRouteFeature(newCounter.map, feature, viewport); const newMs = performance.now() - newStart;
  assert.deepEqual(after, before);
  assert.ok(newCounter.calls() < oldCounter.calls());
  console.log(`[route projection benchmark] 10k points: project calls ${oldCounter.calls()} -> ${newCounter.calls()}, Node elapsed ${oldMs.toFixed(2)}ms -> ${newMs.toFixed(2)}ms; output segments=${after.length}`);
});

test('offscreen scans remain bounded by input length and do not discard a later visible segment', () => {
  const coordinates = Array.from({ length: 20_000 }, (_, i) => i < 19_999 ? [10000 + i, 10000] : [30, 40]);
  coordinates.push([40, 50]);
  const feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
  const tracked = countedMap(identityProjection);
  const result = projectRouteFeature(tracked.map, feature, viewport);
  assert.deepEqual(result, oldProjection({ project: identityProjection }, feature, viewport));
  assert.ok(result.length > 0, 'the visible tail survives a long offscreen prefix');
  assert.ok(tracked.calls() <= coordinates.length * 2.1,
    'offscreen traversal stays linear with endpoint reuse and does not expand into dense sampling');
});
