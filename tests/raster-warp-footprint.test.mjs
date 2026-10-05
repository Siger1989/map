import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterPixelPlan, warpPlan, worldPixel } from '../modules/mapSources/coordinates.ts';
import { resampleRasterPixels } from '../modules/mapSources/rasterResampler.ts';

function oldPlan(plan, z) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < plan.points.length; i += 2) {
    minX = Math.min(minX, plan.points[i]); maxX = Math.max(maxX, plan.points[i]);
    minY = Math.min(minY, plan.points[i + 1]); maxY = Math.max(maxY, plan.points[i + 1]);
  }
  const left = Math.floor((minX - 1) / plan.tileSize);
  const right = Math.floor((maxX + 1) / plan.tileSize);
  const top = Math.max(0, Math.floor((minY - 1) / plan.tileSize));
  const bottom = Math.min(2 ** z - 1, Math.floor((maxY + 1) / plan.tileSize));
  return { ...plan, left, top, width: right - left + 1, height: bottom - top + 1 };
}

function inputFor(plan, z, pixels) {
  const width = plan.width * pixels, height = plan.height * pixels;
  const worldWidth = 2 ** z * pixels;
  const input = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = ((plan.left * pixels + x) % worldWidth + worldWidth) % worldWidth;
    const gy = plan.top * pixels + y;
    const i = (y * width + x) * 4;
    const value = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
    input[i] = value & 255;
    input[i + 1] = (value >>> 8) & 255;
    input[i + 2] = (value >>> 16) & 255;
    input[i + 3] = value % 17 < 4 ? 0 : [64, 128, 192, 255][value & 3];
  }
  return input;
}

function tileFor(lng, lat, z, tileSize) {
  // Output coordinates remain WGS84; datum correction belongs only in warpPlan.
  const [px, py] = worldPixel(lng, lat, tileSize * 2 ** z);
  return [Math.floor(px / tileSize), Math.max(0, Math.min(2 ** z - 1, Math.floor(py / tileSize)))];
}

const fixtures = [
  { name: 'low zoom China', lng: 116.4, lat: 39.9, z: 4 },
  { name: 'mid zoom China', lng: 104.06, lat: 30.67, z: 7 },
  { name: 'high zoom China', lng: 121.47, lat: 31.23, z: 19 },
  { name: 'z24 floating edge China', lng: 116.404, lat: 39.915, z: 24 },
  { name: 'west date-line edge', lng: -179.99999, lat: 12.5, z: 6 },
  { name: 'east date-line edge', lng: 179.99999, lat: -12.5, z: 6 },
  { name: 'north Mercator limit', lng: 0, lat: 85.051128, z: 8 },
  { name: 'south Mercator limit', lng: 0, lat: -85.051128, z: 8 },
];

test('tight plans reproduce conservative-plan pixels for datum, zoom, world edge, and retina sizes', () => {
  for (const fixture of fixtures) for (const datum of ['gcj02', 'bd09'])
    for (const nominalSize of [256, 512, 1024, 2048]) for (const actualPixels of [256, 512]) {
      const [x, y] = tileFor(fixture.lng, fixture.lat, fixture.z, nominalSize);
      const tight = warpPlan(fixture.z, x, y, nominalSize, datum);
      const old = oldPlan(tight, fixture.z);
      assert.ok(tight.width * tight.height <= old.width * old.height,
        `${fixture.name} ${datum} nominal${nominalSize} actual${actualPixels}: expected tight plan <= old plan`);
      const tightPixels = rasterPixelPlan(tight, actualPixels);
      const oldPixels = rasterPixelPlan(old, actualPixels);
      const actual = resampleRasterPixels(tightPixels, inputFor(tight, fixture.z, actualPixels));
      const expected = resampleRasterPixels(oldPixels, inputFor(old, fixture.z, actualPixels));
      assert.deepEqual(actual, expected,
        `${fixture.name} ${datum} nominal${nominalSize} actual${actualPixels}`);
    }
});

test('low zoom shifted footprint reduces a 3x3 conservative input set to the required tiles', () => {
  const z = 4, nominalSize = 256, datum = 'gcj02';
  const [x, y] = tileFor(116.4, 39.9, z, nominalSize);
  const tight = warpPlan(z, x, y, nominalSize, datum);
  const old = oldPlan(tight, z);
  assert.equal(old.width * old.height, 9);
  assert.ok(tight.width * tight.height < old.width * old.height,
    `low zoom expected fewer input tiles; got tight=${tight.width}x${tight.height}, old=${old.width}x${old.height}`);
});
