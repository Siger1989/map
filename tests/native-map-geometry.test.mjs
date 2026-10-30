import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDemCache, ecefToWgs84, invertMatrix4, projectWgs84, unprojectWgs84, wgs84ToEcef } from '../modules/map/native/geometry.ts';

test('WGS84 ECEF conversions preserve known axes and roundtrip coordinates', () => {
  assert.deepEqual(wgs84ToEcef(0, 0, 0), [6378137, 0, 0]);
  const source = [71.2345, 32.1234, 1834.25];
  const xyz = wgs84ToEcef(source[0], source[1], source[2]);
  const result = ecefToWgs84(...xyz);
  assert.ok(Math.abs(result.longitude - source[0]) < 1e-9);
  assert.ok(Math.abs(result.latitude - source[1]) < 1e-9);
  assert.ok(Math.abs(result.altitudeMeters - source[2]) < 1e-4);
});

test('column-major matrix inverse is reversible and singular matrices block', () => {
  const matrix = [2,0,0,0, 0,3,0,0, 0,0,4,0, 5,-2,7,1];
  const inverse = invertMatrix4(matrix);
  assert.ok(inverse);
  const identity = multiply(matrix, inverse);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(identity[i] - (i % 5 === 0 ? 1 : 0)) < 1e-12);
  assert.equal(invertMatrix4(Array(16).fill(0)), null);
});

test('flat projection uses ellipsoid altitude without inventing factual elevation', () => {
  const dem = new NativeDemCache();
  const frame = frameFor([
    1 / 6378137, 0, 0, 0,
    0, 1 / 6378137, 0, 0,
    0, 0, 1 / 6378137, 0,
    -1, 0, 0, 1,
  ]);
  frame.terrainEnabled = false;
  frame.demRevision = 4;
  const legacyFrame = { ...frame };
  delete legacyFrame.terrainEnabled;
  assert.deepEqual(projectWgs84([0, 0], legacyFrame, dem), { status: 'blocked', reason: 'dem-cache-stale' });
  const flat = projectWgs84([0, 0], frame, dem);
  assert.equal(flat.status, 'ready');
  assert.ok(Math.abs(flat.value.x - 50) < 1e-6);
  assert.ok(Math.abs(flat.value.y - 25) < 1e-6);
  assert.equal(flat.value.elevationMeters, null);
  const poleInverse = [1,0,0,0, 0,1,0,0, 0,0,-2 * 6_356_752.314245,0, 0,0,0,1];
  const unprojectFrame = { ...frame, viewProjection: invertMatrix4(poleInverse), inverseViewProjection: poleInverse,
    viewport: { x: 0, y: 0, width: 100, height: 100 }, cssScale: 1 };
  const ground = unprojectWgs84({ x: 50, y: 50 }, unprojectFrame, dem);
  assert.equal(ground.status, 'ready');
  assert.equal(ground.value.elevationMeters, null);
  assert.ok(Math.abs(Math.abs(ground.value.coordinate[1]) - 90) < 1e-6);
  const explicit = projectWgs84([0, 0], frame, dem, 1000);
  assert.equal(explicit.status, 'ready');
  assert.equal(explicit.value.elevationMeters, null);
});

test('2D screen position is unchanged by DEM presence and 3D still blocks without current DEM', () => {
  const withoutDem = new NativeDemCache();
  const frame = frameFor([
    1 / 6378137, 0, 0, 0,
    0, 1 / 6378137, 0, 0,
    0, 0, 1 / 6378137, 0,
    -1, 0, 0, 1,
  ]);
  frame.terrainEnabled = false;
  frame.demRevision = 0;
  const flatWithoutDem = projectWgs84([0, 0], frame, withoutDem);
  assert.equal(flatWithoutDem.status, 'ready');
  const withDem = new NativeDemCache();
  withDem.replace(1, [{ id: 'equator', west: -1, south: -1, east: 1, north: 1, width: 2, height: 2, heights: [500, 500, 500, 500] }]);
  const flatWithDem = projectWgs84([0, 0], frame, withDem);
  assert.equal(flatWithDem.status, 'ready');
  assert.equal(flatWithDem.value.x, flatWithoutDem.value.x);
  assert.equal(flatWithDem.value.y, flatWithoutDem.value.y);
  assert.equal(flatWithDem.value.elevationMeters, 500);

  frame.terrainEnabled = true;
  frame.demRevision = 2;
  assert.deepEqual(projectWgs84([0, 0], frame, withoutDem), { status: 'blocked', reason: 'dem-cache-stale' });
  assert.deepEqual(unprojectWgs84({ x: 50, y: 25 }, frame, withoutDem), { status: 'blocked', reason: 'dem-cache-stale' });
});

test('explicit altitude can position a point while missing ground elevation remains null', () => {
  const dem = new NativeDemCache();
  const frame = frameFor([
    1 / 6378137, 0, 0, 0,
    0, 1 / 6378137, 0, 0,
    0, 0, 1 / 6378137, 0,
    -1, 0, 0, 1,
  ]);
  frame.terrainEnabled = true;
  dem.clear(0);
  assert.deepEqual(projectWgs84([0, 0], frame, dem), { status: 'blocked', reason: 'dem-sample-unavailable' });
  const result = projectWgs84([0, 0], frame, dem, 0);
  assert.equal(result.status, 'ready');
  assert.ok(Math.abs(result.value.x - 50) < 1e-6);
  assert.ok(Math.abs(result.value.y - 25) < 1e-6);
  assert.equal(result.value.elevationMeters, null);
});

test('DEM cache samples only covered finite terrain and rejects stale updates/no-data', () => {
  const cache = new NativeDemCache();
  const tile = { id: 'dem-1', west: 0, south: 0, east: 1, north: 1, width: 2, height: 2, heights: [100, 200, 300, 400] };
  assert.equal(cache.replace(1, [tile]), true);
  assert.equal(cache.sample(0.5, 0.5), 250);
  assert.equal(cache.sample(2, 2), null);
  assert.equal(cache.replace(0, [tile]), false);
  assert.equal(cache.replace(2, [{ ...tile, heights: [100, null, 300, 400] }]), true);
  assert.equal(cache.sample(0.5, 0.5), null);
});

test('unprojection reports blocked when native DEM cache is missing/stale', () => {
  const dem = new NativeDemCache();
  const frame = {
    sequence: 1,
    camera: { center: [0, 0], zoom: 8, pitch: 0, bearing: 0 },
    viewProjection: identity(), inverseViewProjection: identity(),
    viewport: { x: 400, y: 100, width: 100, height: 100 },
    cssScale: 1, clipDepth: 'minusOneToOne', demRevision: 4, capturedAt: 1,
  };
  assert.deepEqual(unprojectWgs84({ x: 50, y: 50 }, frame, dem), { status: 'blocked', reason: 'dem-cache-stale' });
});

test('unprojection intersects the ECEF ellipsoid only where matching DEM data exists', () => {
  const dem = new NativeDemCache();
  assert.equal(dem.replace(1, [{ id: 'north-pole', west: -1, south: 89, east: 1, north: 90, width: 2, height: 2, heights: [0, 0, 0, 0] }]), true);
  const inverseViewProjection = [1,0,0,0, 0,1,0,0, 0,0,-2 * 6_356_752.314245,0, 0,0,0,1];
  const frame = {
    sequence: 1,
    camera: { center: [0, 90], zoom: 8, pitch: 0, bearing: 0 },
    viewProjection: invertMatrix4(inverseViewProjection), inverseViewProjection,
    viewport: { x: 0, y: 0, width: 100, height: 100 },
    cssScale: 1, clipDepth: 'minusOneToOne', demRevision: 1, capturedAt: 1,
  };
  const result = unprojectWgs84({ x: 50, y: 50 }, frame, dem);
  assert.equal(result.status, 'ready');
  assert.ok(Math.abs(result.value.coordinate[1] - 90) < 1e-6);
  assert.ok(Math.abs(result.value.elevationMeters) < 1e-6);
});

test('terrain exaggeration changes rendered projection but preserves factual ground elevation', () => {
  const dem = new NativeDemCache();
  dem.replace(1, [{ id: 'summit', west: -1, south: 89, east: 1, north: 90, width: 2, height: 2, heights: [1000, 1000, 1000, 1000] }]);
  const radius = 6_356_752.314245;
  const inverseViewProjection = [1,0,0,0, 0,1,0,0, 0,0,-2 * radius,0, 0,0,0,1];
  const frame = { sequence: 1, camera: { center: [0, 90], zoom: 8, pitch: 0, bearing: 0 },
    viewProjection: invertMatrix4(inverseViewProjection), inverseViewProjection,
    viewport: { x: 400, y: 100, width: 100, height: 100 }, cssScale: 1,
    clipDepth: 'minusOneToOne', demRevision: 1, capturedAt: 1, verticalExaggeration: 3 };
  const projected = projectWgs84([0, 90], frame, dem);
  assert.equal(projected.status, 'ready');
  assert.equal(projected.value.elevationMeters, 1000);
  const ground = unprojectWgs84({ x: 50, y: 50 }, frame, dem);
  assert.equal(ground.status, 'ready');
  assert.equal(ground.value.elevationMeters, 1000);
  assert.ok(Math.abs(ground.value.coordinate[1] - 90) < 1e-6);
});

test('terrain unprojection falls back to a bounded bracket on a steep synthetic DEM', () => {
  const dem = syntheticSteepSlopeDem();
  const frame = steepNativeFrame();
  const target = [102.9, 31];
  const projected = projectWgs84(target, frame, dem);
  assert.equal(projected.status, 'ready');

  const ground = unprojectWgs84({ x: projected.value.x, y: projected.value.y }, frame, dem);
  assert.equal(ground.status, 'ready');
  const longitudeErrorMeters = Math.abs(ground.value.coordinate[0] - target[0]) * 111_320 * Math.cos(target[1] * Math.PI / 180);
  const latitudeErrorMeters = Math.abs(ground.value.coordinate[1] - target[1]) * 111_320;
  assert.ok(Math.hypot(longitudeErrorMeters, latitudeErrorMeters) < 2);
  assert.ok(Math.abs(ground.value.elevationMeters - dem.sample(...target)) < 1);

  const reprojected = projectWgs84(ground.value.coordinate, frame, dem);
  assert.equal(reprojected.status, 'ready');
  assert.ok(Math.hypot(reprojected.value.x - projected.value.x, reprojected.value.y - projected.value.y) < 0.05);
});

test('terrain bracket fallback does not bridge a no-data hole in front of a later DEM surface', () => {
  const dem = syntheticSteepSlopeDem({ noDataRows: [16, 17, 18] });
  const frame = steepNativeFrame();
  const projected = projectWgs84([102.9, 31], frame, dem);
  assert.equal(projected.status, 'ready');

  assert.deepEqual(unprojectWgs84({ x: projected.value.x, y: projected.value.y }, frame, dem), {
    status: 'blocked', reason: 'dem-sample-unavailable',
  });
});

test('terrain unprojection retains valid below-ellipsoid sea elevations', () => {
  const dem = new NativeDemCache();
  const tile = { id: 'negative-sea', west: -1, south: 89, east: 1, north: 90, width: 2, height: 2, heights: [-250, -250, -250, -250] };
  assert.equal(dem.replace(1, [tile]), true);
  const inverseViewProjection = [1,0,0,0, 0,1,0,0, 0,0,-2 * 6_356_752.314245,0, 0,0,0,1];
  const frame = {
    sequence: 1, camera: { center: [0, 90], zoom: 8, pitch: 0, bearing: 0 },
    viewProjection: invertMatrix4(inverseViewProjection), inverseViewProjection,
    viewport: { x: 0, y: 0, width: 100, height: 100 }, cssScale: 1,
    clipDepth: 'minusOneToOne', demRevision: 1, capturedAt: 1, terrainEnabled: true,
  };
  const projected = projectWgs84([0, 90], frame, dem);
  assert.equal(projected.status, 'ready');
  const ground = unprojectWgs84({ x: projected.value.x, y: projected.value.y }, frame, dem);
  assert.equal(ground.status, 'ready');
  assert.equal(ground.value.elevationMeters, -250);
  assert.ok(Math.abs(ground.value.coordinate[1] - 90) < 1e-6);
});

test('DEM cache preserves highest-resolution priority and falls back across no-data samples', () => {
  const dem = new NativeDemCache();
  const coarse = { id: 'coarse', west: 0, south: 0, east: 1, north: 1, width: 2, height: 2, heights: [500, 500, 500, 500] };
  const fineHeights = Array.from({ length: 16 }, (_, index) => 0.125 + (index % 4) * 0.25 + Math.floor(index / 4) * 0.5);
  fineHeights[5] = null;
  const fine = { id: 'fine', west: 0, south: 0, east: 1, north: 1, width: 4, height: 4, heights: fineHeights };
  assert.equal(dem.replace(1, [coarse, fine]), true);
  assert.ok(Math.abs(dem.sample(0.1, 0.1) - 1.55) < 1e-12);
  assert.equal(dem.sample(0.5, 0.5), 500);
});

function syntheticSteepSlopeDem({ noDataRows = [] } = {}) {
  const tiles = [
    { id: 'synthetic-north', west: 102.65899658203125, south: 31.0552869290102, east: 103.00506591796875, north: 31.351291407790587 },
    { id: 'synthetic-south', west: 102.65899658203125, south: 30.75363814621857, east: 103.00506591796875, north: 31.0505809842175 },
  ].map((bounds) => ({
    ...bounds, width: 64, height: 64,
    heights: Array.from({ length: 64 * 64 }, (_, index) => {
      const row = Math.floor(index / 64);
      if (bounds.id === 'synthetic-south' && noDataRows.includes(row)) return null;
      const latitude = bounds.north - (bounds.north - bounds.south) * row / 63;
      return 4200 + 600 * Math.sin((latitude - 30.98) * Math.PI * 63 + 0.8);
    }),
  }));
  const dem = new NativeDemCache();
  assert.equal(dem.replace(1, tiles), true);
  return dem;
}

function steepNativeFrame() {
  // Captured WorldWind frame transform, kept as a compact projection fixture; terrain is synthetic.
  const inverseViewProjection = [
    -0.18929514342161433, -0.04335437539062495, 2.901302856259236e-15, 8.826801183225432e-22,
    -0.03761224945788125, 0.16422370502143047, 0.37840291839990114, 0,
    150.64429080242428, -657.7475139742285, -400.8055147664493, -0.0001228957710077655,
    -151.1010174960789, 659.7416874388638, 402.9700512699954, 0.00012343475103965385,
  ];
  return {
    sequence: 1486,
    camera: { center: [102.9, 31], zoom: 12, pitch: 55, bearing: 0 },
    viewProjection: invertMatrix4(inverseViewProjection), inverseViewProjection,
    viewport: { x: 0, y: 0, width: 1256, height: 2679 },
    cssScale: 3.21227621483376, clipDepth: 'minusOneToOne', demRevision: 1,
    capturedAt: 1, terrainEnabled: true, verticalExaggeration: 1,
  };
}

function frameFor(viewProjection) {
  return {
    sequence: 1,
    camera: { center: [0, 0], zoom: 1, pitch: 0, bearing: 0 },
    viewProjection, inverseViewProjection: invertMatrix4(viewProjection),
    viewport: { x: 400, y: 100, width: 200, height: 100 },
    cssScale: 2, clipDepth: 'minusOneToOne', demRevision: 0, capturedAt: 1,
  };
}
function identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function multiply(a, b) {
  const out = Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return out;
}
