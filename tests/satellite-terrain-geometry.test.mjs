import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSatelliteMesh, coordinate, demTileFor, earthAxis, earthPosition, heightAtTile, mercator, planSatelliteTiles, surfaceHeight, terrainHeight,
} from '../modules/sky/satelliteTerrainGeometry.ts';

const close = (value, expected, epsilon = 1e-8) => assert.ok(
  Math.abs(value - expected) < epsilon, `expected ${value} near ${expected}`,
);

test('DEM and image use invertible XYZ coordinates and bounded antimeridian planning', () => {
  for (const [longitude, latitude] of [[104.06, 30.57], [179.8, -38.2], [-179.8, 42.3]]) {
    const [x, y] = mercator(longitude, latitude, 14);
    const [lng, lat] = coordinate(x, y, 14);
    close(lng, longitude);
    close(lat, latitude);
    const tiles = planSatelliteTiles(longitude, latitude);
    assert.ok(tiles.length > 9 && tiles.length <= 39);
    assert.equal(new Set(tiles.map(tile => tile.key)).size, tiles.length);
    assert.equal(tiles.filter(tile => {
      const [x, y] = mercator(longitude, latitude, tile.z);
      return Math.floor(x) === tile.x && Math.floor(y) === tile.y;
    }).length, 1);
    assert.equal(tiles.some(tile => tiles.some(other => other.z < tile.z && other.x === (tile.x >> (tile.z - other.z)) &&
      other.y === (tile.y >> (tile.z - other.z)))), false);
  }
});

test('camera cardinal axes agree with WGS84 Earth geometry', () => {
  const check = (actual, expected) => actual.forEach((v, i) => close(v, expected[i]));
  check(earthAxis(0, 0, 0, 0), [0, 0, 1]);
  check(earthAxis(0, 0, 90, 0), [0, 1, 0]);
  check(earthAxis(0, 0, 0, 90), [1, 0, 0]);
  check(earthPosition(0, 0, 10), [6_378_147, 0, 0]);
});

test('DEM eye interpolation, source texture UV and missing terrain remain distinct', () => {
  const pixels = new Float32Array(256 * 256).fill(900);
  close(terrainHeight(pixels, .431, .823), 900);
  const tile = { z: 14, x: 12927, y: 6729, key: '14/12927/6729' };
  const mesh = buildSatelliteMesh(tile, pixels);
  assert.equal(mesh.indices.length, 36 * 36 * 6);
  close(surfaceHeight(tile, pixels, .431, .823), 900);
  assert.deepEqual([...mesh.vertices.slice(3, 5)], [0, 0]);
  for (let i = 0; i < mesh.indices.length; i++) assert.ok(mesh.indices[i] < mesh.vertices.length / 5);
  pixels.fill(NaN);
  assert.equal(buildSatelliteMesh(tile, pixels).indices.length, 0);
});

test('fine image siblings use their precise quadrants and share the existing z12 DEM', () => {
  const image = { z: 16, x: 32005, y: 32010, key: '16/32005/32010' };
  assert.deepEqual(demTileFor(image), { z: 12, x: 2000, y: 2000, key: '12/2000/2000' });
  const ramp = Float32Array.from({ length: 256 * 256 }, (_, i) => (i % 256) + Math.floor(i / 256) * 2);
  close(heightAtTile(image, ramp, .3, .4), terrainHeight(ramp, 5.3 / 16, 10.4 / 16));
  const next = { ...image, x: image.x + 1 };
  close(heightAtTile(image, ramp, 1, .7), heightAtTile(next, ramp, 0, .7));
});

test('the interpolated eye elevation follows the same mesh diagonal', () => {
  const tile = { z: 12, x: 3226, y: 1677, key: '12/3226/1677' };
  const heights = Float32Array.from({ length: 256 * 256 }, (_, i) => (i % 256) ** 2 + 2 * Math.floor(i / 256) ** 2);
  const east = heightAtTile(tile, heights, 14 / 36, 11 / 36);
  const south = heightAtTile(tile, heights, 13 / 36, 12 / 36);
  const corner = heightAtTile(tile, heights, 14 / 36, 12 / 36);
  close(surfaceHeight(tile, heights, 13.75 / 36, 11.75 / 36), .25 * east + .25 * south + .5 * corner);
});
