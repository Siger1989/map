import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  validFavorite,
  parseFavorites,
} from '../modules/navigation/favorites.ts';
import {
  compassHeading,
  headingDelta,
  positionFix,
} from '../modules/position/types.ts';
import {
  nearestOnRoute,
  locateProgress,
  routeWeatherStops,
  secondsAlong,
  temperatureColor,
  precipitationColor,
} from '../modules/journey/routeProgress.ts';
const a = [104, 30],
  b = [104.01, 30],
  c = [104.02, 30];
const route = {
  mode: 'pedestrian',
  coordinates: [a, b, c],
  distance: 2000,
  duration: 1500,
  createdAt: 1,
  snapped: [a, c],
  steps: [
    {
      instruction: '步行',
      coordinates: [a, b],
      distance: 1000,
      duration: 1000,
      elapsedSeconds: 0,
    },
    {
      instruction: '继续',
      coordinates: [b, c],
      distance: 1000,
      duration: 500,
      elapsedSeconds: 1000,
    },
  ],
};
test('road forecasts follow each leg duration instead of a constant whole-route speed', () => {
  assert.equal(secondsAlong(route, 500), 500);
  assert.equal(secondsAlong(route, 1500), 1250);
  assert.equal(secondsAlong(route, 2000), 1500);
  const stops = routeWeatherStops({ ...route, distance: 50000 });
  assert.equal(stops.length, 8);
  assert.deepEqual(stops[0].coordinates, a);
  assert.deepEqual(stops.at(-1).coordinates, c);
  assert.equal(stops.at(-1).seconds, 1500);
});
test('route position is measured along geometry; off-road, stale and coarse fixes are distinct', () => {
  assert.ok(
    Math.abs(nearestOnRoute(route.coordinates, b).fraction - 0.5) < 0.0001,
  );
  assert.equal(locateProgress(route, null).fraction, null);
  const fix = { coordinates: b, accuracy: 10, timestamp: 100000 };
  assert.ok(
    Math.abs(locateProgress(route, fix, 100000).fraction - 0.5) < 0.0001,
  );
  assert.equal(
    locateProgress(route, { ...fix, coordinates: [105, 30] }, 100000).fraction,
    null,
  );
  assert.equal(locateProgress(route, fix, 200000).label, '定位已过期');
  assert.equal(
    locateProgress(route, { ...fix, accuracy: 1000 }, 100000).label,
    '定位精度不足',
  );
});
test('missing precipitation gets a different color from dry weather and temperature bands are distinct', () => {
  assert.notEqual(precipitationColor(null), precipitationColor(0));
  assert.equal(new Set([-5, 5, 15, 25, 32, 38].map(temperatureColor)).size, 6);
});
test('saved road routes restore geometry, steps and endpoints; invalid data cannot be restored', () => {
  const favorite = {
    id: '1',
    name: 'test',
    savedAt: 1,
    start: { name: 'a', coordinates: a },
    end: { name: 'c', coordinates: c },
    route,
  };
  assert.equal(validFavorite(favorite), true);
  assert.deepEqual(parseFavorites(JSON.stringify([favorite])), [favorite]);
  assert.equal(
    validFavorite({
      ...favorite,
      route: { ...route, coordinates: [[999, 30], b] },
    }),
    false,
  );
  assert.equal(
    validFavorite({ ...favorite, route: { ...route, duration: -1 } }),
    false,
  );
  assert.equal(
    parseFavorites(
      JSON.stringify(
        Array.from({ length: 22 }, (_, i) => ({ ...favorite, id: String(i) })),
      ),
    ).length,
    20,
  );
  assert.throws(() => parseFavorites('{}'));
});
test('compass ignores relative gyro alpha, handles screen orientation and circular wrap', () => {
  assert.equal(compassHeading({ alpha: 90, absolute: false }, 0), null);
  assert.equal(compassHeading({ alpha: 90, absolute: true }, 0), 270);
  assert.equal(compassHeading({ alpha: 90, absolute: true }, 90), 0);
  assert.equal(
    compassHeading(
      {
        alpha: null,
        absolute: false,
        webkitCompassHeading: 45,
        webkitCompassAccuracy: 5,
      },
      0,
    ),
    45,
  );
  assert.equal(
    compassHeading(
      {
        alpha: null,
        absolute: false,
        webkitCompassHeading: 45,
        webkitCompassAccuracy: -1,
      },
      0,
    ),
    null,
  );
  assert.equal(headingDelta(359, 1), 2);
  assert.equal(headingDelta(1, 359), -2);
});
test('invalid device coordinates are rejected and actual accuracy/timestamp remain available', () => {
  const position = {
    coords: { longitude: 104, latitude: 30, accuracy: 20 },
    timestamp: 12345,
  };
  assert.deepEqual(positionFix(position), {
    coordinates: a,
    accuracy: 20,
    timestamp: 12345,
  });
  assert.equal(
    positionFix({
      ...position,
      coords: { ...position.coords, longitude: 999 },
    }),
    null,
  );
});
async function compile(path) {
  const compiled = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
}
test('magnifier uses actual CSS canvas dimensions even with a zero-height wrapper, and unsubscribes', async () => {
  const { observeMagnifier } = await compile('modules/map/magnifier.ts');
  const events = new Map();
  let captured;
  const canvas = {
    width: 800,
    height: 1600,
    clientWidth: 400,
    clientHeight: 800,
  };
  const map = {
    getCanvas: () => canvas,
    getCanvasContainer: () => ({ clientWidth: 400, clientHeight: 0 }),
    on: (n, f) => events.set(n, f),
    off: (n) => events.delete(n),
    triggerRepaint: () => events.get('render')(),
  };
  const target = {
    width: 192,
    height: 192,
    getContext: () => ({
      fillRect() {},
      drawImage(...args) {
        captured = args;
      },
    }),
  };
  const remove = observeMagnifier(map, target, { x: 100, y: 200 });
  assert.equal(captured[0], canvas);
  assert.deepEqual(captured.slice(1), [168, 368, 64, 64, 0, 0, 192, 192]);
  remove();
  assert.equal(events.size, 0);
});
test('location layer contains a closed accuracy polygon and removes location data when cleared', async () => {
  const { PositionLayer } = await compile('modules/position/PositionLayer.ts');
  const sources = {},
    layers = [];
  let data;
  const map = {
    getSource: (n) => sources[n],
    addSource: (n, s) => (sources[n] = { ...s, setData: (d) => (data = d) }),
    addLayer: (l) => layers.push(l),
    moveLayer() {},
  };
  const layer = new PositionLayer(map);
  layer.sync({ coordinates: a, accuracy: 20, timestamp: 1 });
  const ring = data.features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.deepEqual(data.features[1].geometry.coordinates, a);
  const cleaned = Object.fromEntries(
    Object.entries(sources).map(([n, { setData, ...source }]) => [n, source]),
  );
  assert.deepEqual(
    validateStyleMin({ version: 8, sources: cleaned, layers }).map(
      (e) => e.message,
    ),
    [],
  );
  layer.sync(null);
  assert.equal(data.features.length, 0);
});
