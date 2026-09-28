import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: ['modules/map/snapViewport.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { createSnapViewportReader } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

const realEngineBuild = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
    contents: `
      import { MercatorTransform } from './node_modules/maplibre-gl/src/geo/projection/mercator_transform.ts';
      import { LngLat } from './node_modules/maplibre-gl/src/geo/lng_lat.ts';
      import Point from '@mapbox/point-geometry';
      import { createSnapViewportReader } from './modules/map/snapViewport.ts';
      export function mercatorFixture(centerLng:number, pitch:number, bearing:number) {
        const transform = new MercatorTransform();
        transform.setRenderWorldCopies(true);
        transform.resize(390, 844, false);
        transform.setCenter(new LngLat(centerLng, 30.8));
        transform.setZoom(9);
        transform.setPitch(pitch);
        transform.setBearing(bearing);
        const map = {
          getCenter: () => transform.center,
          getZoom: () => transform.zoom,
          getPitch: () => transform.pitch,
          getBearing: () => transform.bearing,
          getCanvas: () => ({ clientWidth: 390, clientHeight: 844 }),
          getBounds: () => transform.getBounds(),
          unproject: ([x,y]:[number,number]) => transform.screenPointToLocation(new Point(x,y)),
          project: ([lng,lat]:[number,number]) => transform.locationToScreenPoint(new LngLat(lng,lat)),
        };
        const sample = ([x,y]:[number,number]) => {
          const coordinate = transform.screenPointToLocation(new Point(x,y));
          return { coordinate, screen: transform.locationToScreenPoint(coordinate) };
        };
        return { transform, map, reader: createSnapViewportReader(map), sample };
      }
    `,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { mercatorFixture } = await import(
  `data:text/javascript;base64,${Buffer.from(realEngineBuild.outputFiles[0].text).toString('base64')}`
);

function makeMap(overrides = {}) {
  const state = {
    center: { lng: 10, lat: 20 },
    zoom: 8,
    pitch: 0,
    bearing: 0,
    width: 390,
    height: 844,
    terrain: null,
    bounds: { west: 9.9, south: 19.9, east: 10.1, north: 20.1 },
    unprojectCalls: 0,
    unproject: ([x, y]) => ({ lng: 10 + x / 10000, lat: 20 - y / 10000 }),
    project: ([lng, lat]) => ({ x: (lng - 10) * 10000, y: (20 - lat) * 10000 }),
    ...overrides,
  };
  const map = {
    getCenter: () => state.center,
    getZoom: () => state.zoom,
    getPitch: () => state.pitch,
    getBearing: () => state.bearing,
    getCanvas: () => ({ clientWidth: state.width, clientHeight: state.height }),
    getTerrain: () => state.terrain,
    getBounds: () => ({
      getWest: () => state.bounds.west,
      getSouth: () => state.bounds.south,
      getEast: () => state.bounds.east,
      getNorth: () => state.bounds.north,
    }),
    unproject: (point) => {
      state.unprojectCalls += 1;
      return state.unproject(point);
    },
    project: (coordinate) => state.project(coordinate),
  };
  return { map, state };
}

test('snap viewport caches by camera pose and recomputes after pose change or invalidate', () => {
  const { map, state } = makeMap();
  const reader = createSnapViewportReader(map);
  const first = reader.read();
  assert.ok(first);
  assert.equal(first.width, 390);
  assert.equal(first.height, 844);
  assert.ok(first.west < 9.9, 'includes expanded screen samples and coarse bounds');
  assert.ok(first.east > 10.1);
  assert.equal(state.unprojectCalls, 16);
  assert.equal(reader.read(), first, 'stable pose reuses the same viewport object');
  assert.equal(state.unprojectCalls, 16, 'stable pose does not sample again');

  state.zoom += 1;
  const moved = reader.read();
  assert.ok(moved);
  assert.notEqual(moved, first);
  assert.equal(moved.revision, first.revision + 1);
  assert.equal(state.unprojectCalls, 32);

  reader.invalidate();
  const invalidated = reader.read();
  assert.ok(invalidated);
  assert.notEqual(invalidated, moved);
  assert.equal(invalidated.revision, moved.revision + 1);
  assert.equal(state.unprojectCalls, 48);
});

test('viewport longitudes stay continuous across the antimeridian', () => {
  const { map, state } = makeMap({
    center: { lng: 179.8, lat: 25 },
    bounds: { west: 179.5, south: 24.8, east: -179.9, north: 25.2 },
    unproject: ([x, y]) => ({ lng: ((179.8 + x / 10000 + 180) % 360 + 360) % 360 - 180, lat: 25 - y / 10000 }),
    project: ([lng, lat]) => ({
      x: (179.8 + ((((lng - 179.8) % 360) + 540) % 360 - 180) - 179.8) * 10000,
      y: (25 - lat) * 10000,
    }),
  });
  const viewport = createSnapViewportReader(map).read();
  assert.ok(viewport);
  assert.ok(viewport.west < 180);
  assert.ok(viewport.east > 180);
  assert.ok(viewport.east - viewport.west < 5);
  assert.ok(state.unprojectCalls > 0);
});

test('uncertain sky samples and high pitch return null for full-projection fallback', () => {
  const sky = makeMap({ unproject: () => ({ lng: Number.NaN, lat: 20 }) });
  assert.equal(createSnapViewportReader(sky.map).read(), null);
  assert.equal(createSnapViewportReader(makeMap({ pitch: 80 }).map).read(), null);
});

test('unprojected polar or world-scale bounds fall back instead of filtering candidates', () => {
  assert.equal(
    createSnapViewportReader(makeMap({ unproject: () => ({ lng: 10, lat: 85 }) }).map).read(),
    null,
  );
  assert.equal(
    createSnapViewportReader(makeMap({ unproject: ([x]) => ({ lng: x < 0 ? -100 : 100, lat: 20 }) }).map).read(),
    null,
  );
});

test('installed MercatorTransform bounds include screen-edge snap points across pitch and bearing', () => {
  const screenXs = [-14, 0, 195, 390, 404];
  const screenYs = [-14, 0, 422, 844, 858];
  for (const pitch of [0, 40, 60, 74]) {
    const { transform, reader, sample } = mercatorFixture(103.5, pitch, 45);
    const viewport = reader.read();
    if (pitch < 74) assert.ok(viewport, `pitch ${pitch} should retain a usable coarse bound`);
    for (const x of screenXs) for (const y of screenYs) {
      const { coordinate, screen } = sample([x, y]);
      if (!Number.isFinite(coordinate.lng) || !Number.isFinite(coordinate.lat)) continue;
      if (Math.hypot(screen.x - x, screen.y - y) > 1.5) continue;
      assert.ok(viewport === null || contains(viewport, coordinate.lng, coordinate.lat, transform.center.lng),
        `pitch ${pitch}: viewport must include screen point ${x},${y} or fall back`);
    }
  }
});

test('installed MercatorTransform preserves dateline and multiple-world-copy coverage', () => {
  for (const centerLng of [179.9, 540.1, -540.1]) {
    const { transform, reader, sample } = mercatorFixture(centerLng, 40, 45);
    const viewport = reader.read();
    for (const [x, y] of [[-14, 422], [0, 422], [390, 422], [404, 422]]) {
      const { coordinate, screen } = sample([x, y]);
      if (!Number.isFinite(coordinate.lng) || Math.hypot(screen.x - x, screen.y - y) > 1.5) continue;
      assert.ok(viewport === null || contains(viewport, coordinate.lng, coordinate.lat, transform.center.lng),
        `center ${centerLng}: viewport must include screen point ${x},${y} or fall back`);
    }
  }
});

function contains(viewport, lng, lat, centerLng) {
  const delta = lng - centerLng;
  const wrappedLng = centerLng + ((((delta % 360) + 540) % 360) - 180);
  let east = viewport.east;
  if (east < viewport.west) east += 360;
  return wrappedLng >= viewport.west && wrappedLng <= east && lat >= viewport.south && lat <= viewport.north;
}

