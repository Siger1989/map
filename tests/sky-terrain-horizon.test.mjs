import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleTerrainHorizon, terrainHorizonAt, terrainHorizonAtAltitude } from '../modules/sky/terrainHorizon.ts';

const signal = new AbortController().signal;
const observer = { lng: 179.99, lat: 32, groundElevationMeters: 100 };
const profile = (height) => async (points) => points.map(point => ({
  ...point, elevation: height(point),
}));

test('a sampled mountain raises its own bearing and wraps longitude across the date line', async () => {
  let crossed = false;
  const horizon = await sampleTerrainHorizon(observer, signal, profile(point => {
    assert.ok(point.coordinates[0] >= -180 && point.coordinates[0] < 180);
    if (point.coordinates[0] < 0 && point.part === 90) crossed = true;
    return point.part === 90 && point.distance >= 1300 && point.distance <= 1800 ? 1000 : 100;
  }));
  assert.ok(crossed);
  assert.equal(horizon.status, 'complete');
  assert.equal(horizon.observerAltitudeMeters, 101.7);
  assert.equal(horizon.directions.length, 360);
  assert.ok(terrainHorizonAt(horizon, 90) > 25);
  assert.ok(horizon.directions[90].nearAltitudeDeg < 0);
  assert.equal(horizon.directions[90].midAltitudeDeg, terrainHorizonAt(horizon, 90));
  assert.ok(terrainHorizonAt(horizon, 270) < 0);
  assert.equal(terrainHorizonAt(horizon, 360), terrainHorizonAt(horizon, 0));
});

test('missing tiles stay unknown and known observer height takes precedence', async () => {
  const horizon = await sampleTerrainHorizon(
    { ...observer, altitudeMeters: 300 }, signal,
    profile(point => point.part === 359 ? null : 100),
  );
  assert.equal(horizon.status, 'partial');
  assert.equal(horizon.observerAltitudeMeters, 300);
  assert.equal(terrainHorizonAt(horizon, 359.5), null);
  assert.ok(terrainHorizonAt(horizon, 0) < -0.04);
  assert.ok(horizon.coverage < 1);
});

test('the DEM can supply observer ground and absence of all terrain is explicit', async () => {
  const origin = { lng: 0, lat: 0, eyeHeightMeters: 2 };
  const known = await sampleTerrainHorizon(origin, signal, profile(() => 321));
  assert.equal(known.observerAltitudeMeters, 323);
  const missing = await sampleTerrainHorizon(origin, signal, profile(() => null));
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.observerAltitudeMeters, null);
  assert.equal(terrainHorizonAt(missing, 180), null);
});

test('cancellation prevents publishing a result', async () => {
  const controller = new AbortController();
  await assert.rejects(
    sampleTerrainHorizon(observer, controller.signal, async points => {
      controller.abort();
      return points.map(point => ({ ...point, elevation: 100 }));
    }),
    { name: 'AbortError' },
  );
});

test('a missing stretch makes the exact bearing unreliable while retaining the sampled ridge', async () => {
  const horizon = await sampleTerrainHorizon(observer, signal, profile(point =>
    point.part === 90 && point.distance > 20000 ? null : 100,
  ));
  assert.equal(horizon.status, 'partial');
  assert.ok(horizon.directions[90].altitudeDeg < 0);
  assert.equal(terrainHorizonAt(horizon, 90), null);
  assert.equal(terrainHorizonAt(horizon, 89.5), null);
  assert.ok(terrainHorizonAt(horizon, 89) < 0);
});


test('new eye elevation reprojects all surveyed points without another DEM request', async () => {
  let readCount = 0;
  const terrain = point => point.part === 90
    ? point.distance === 45 ? 105 : point.distance >= 790 && point.distance <= 930 ? 150 : 100
    : 100;
  const base = await sampleTerrainHorizon(observer, signal, async points => {
    readCount++;
    return profile(terrain)(points);
  });
  assert.equal(base.directions[90].distanceMeters, 45);
  const adjusted = terrainHorizonAtAltitude(base, 133);
  const direct = await sampleTerrainHorizon({ ...observer, altitudeMeters: 133 }, signal, profile(terrain));
  assert.equal(readCount, 1);
  assert.equal(adjusted.observerAltitudeMeters, 133);
  assert.ok(adjusted.directions[90].distanceMeters > 790);
  assert.deepEqual(adjusted, direct);
  assert.equal(base.directions[90].distanceMeters, 45);
});
