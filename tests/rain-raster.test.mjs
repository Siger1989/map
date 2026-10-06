import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_STEP, gridPoints } from '../modules/weather/data.ts';
import { buildRainRaster, rainColorGradient, RAIN_COLOR_STOPS, sampleRain } from '../modules/weather/rain.ts';

function weather(values) {
  const points = gridPoints(103.28, 31.08);
  return {
    cells: points.map((point, i) => ({
      ...point,
      elevation: null,
      hours: [{ time: 1, rain: values(i, point) }],
    })),
    times: [1],
    fetchedAt: 1,
    anchor: [103.28, 31.08],
  };
}

const inverseMercator = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;

test('bilinear rainfall and raster colors vary continuously between neighboring samples', () => {
  const data = weather((_i, point) => Math.round((point.lng - 102.64) / GRID_STEP));
  const xs = [...new Set(data.cells.map(cell => cell.lng))].sort((a, b) => a - b);
  const lat = data.anchor[1];
  assert.ok(Math.abs(sampleRain(data, 0, (xs[2] + xs[3]) / 2, lat) - 2.5) < 1e-9);

  const raster = buildRainRaster(data, 0, 40);
  assert.ok(raster);
  const row = Math.floor(raster.height / 2);
  const colorAt = column => [...raster.pixels.slice((row * raster.width + column) * 4, (row * raster.width + column) * 4 + 4)];
  const low = colorAt(13), middle = colorAt(20), high = colorAt(27);
  assert.notDeepEqual(low, middle);
  assert.notDeepEqual(middle, high);
  assert.equal(low[3], 255);
  assert.equal(middle[3], 255);
  assert.equal(high[3], 255);
  assert.ok(low[0] !== middle[0] || low[1] !== middle[1] || low[2] !== middle[2]);
  assert.ok(middle[0] !== high[0] || middle[1] !== high[1] || middle[2] !== high[2],
    'neighboring rain values have distinct interpolated colors');
});

test('smoothstep interpolation preserves grid values and flattens gradients at cell seams', () => {
  const data = weather((_i, point) => Math.round((point.lng - 102.64) / GRID_STEP));
  const xs = [...new Set(data.cells.map(cell => cell.lng))].sort((a, b) => a - b);
  const y = data.anchor[1], seam = xs[2], epsilon = GRID_STEP * 0.00001;
  assert.equal(sampleRain(data, 0, seam, y), 2, 'observed grid sample stays exact');
  const leftSlope = (2 - sampleRain(data, 0, seam - epsilon, y)) / epsilon;
  const rightSlope = (sampleRain(data, 0, seam + epsilon, y) - 2) / epsilon;
  assert.ok(leftSlope >= 0 && rightSlope >= 0);
  assert.ok(leftSlope < 0.001 && rightSlope < 0.001, 'both adjacent gradients approach zero at the seam');
  assert.ok(Math.abs(sampleRain(data, 0, (xs[2] + xs[3]) / 2, y) - 2.5) < 1e-9,
    'smoothstep retains the midpoint and cannot overshoot');
});

test('dry cells stay transparent while pure-shower amounts remain visible in mixed fields', () => {
  const data = weather(index => index === 11 ? 0.5 : 0);
  assert.equal(sampleRain(data, 0, data.cells[12].lng, data.cells[12].lat), 0);
  assert.equal(sampleRain(data, 0, data.cells[11].lng, data.cells[11].lat), 0.5);
  const raster = buildRainRaster(data, 0, 64);
  assert.ok(raster);
  assert.ok(raster.pixels.some((value, i) => i % 4 === 3 && value === 0), 'dry and missing areas remain transparent');
  assert.ok(raster.pixels.some((value, i) => i % 4 === 3 && value === 255), 'positive shower-only rainfall is rendered');
});

test('missing positive-weight neighbors are not interpolated across', () => {
  const data = weather((_index, point) => point.lng === 103.6 && point.lat === 31.08 ? null : 2);
  const xs = [...new Set(data.cells.map(cell => cell.lng))].sort((a, b) => a - b);
  assert.equal(sampleRain(data, 0, xs[2], 31.08), 2, 'zero-weight missing neighbors do not invalidate an exact sample');
  assert.equal(sampleRain(data, 0, xs[3], 31.08), null);
  assert.equal(sampleRain(data, 0, (xs[2] + xs[3]) / 2, 31.08), null);
  assert.equal(sampleRain(data, 0, xs[0] - GRID_STEP, 31.08), null, 'direct sampling outside the data domain is missing');
});

test('sub-0.1 rainfall fades in by alpha and Mercator rows map through inverse latitude', () => {
  const amounts = [0, 0.025, 0.05, 0.075, 0.1];
  const data = weather((_index, point) => amounts[Math.round((point.lng - 102.64) / GRID_STEP)]);
  const raster = buildRainRaster(data, 0, 100);
  assert.ok(raster);
  const rowForFade = 50;
  const alphas = [15, 30, 45, 60, 75].map(column => raster.pixels[(rowForFade * raster.width + column) * 4 + 3]);
  assert.ok(alphas[0] < alphas[1] && alphas[1] < alphas[2] && alphas[2] < alphas[3]);
  assert.ok(alphas[4] > alphas[3]);

  const lightRain = buildRainRaster(weather(() => 0.05), 0, 2);
  assert.ok(lightRain);
  const traceRain = buildRainRaster(weather(() => 0.025), 0, 2);
  assert.deepEqual([...traceRain.pixels.slice(12, 16)], [196, 217, 255, 64],
    'light rain keeps the first stop color while alpha fades in');
  assert.equal(lightRain.pixels[(1 * lightRain.width + 1) * 4 + 3], 128,
    'the interior alpha depends only on low rainfall, not edge coverage');
  const fullRain = buildRainRaster(weather(() => 0.1), 0, 2);
  assert.equal(fullRain.pixels[(1 * fullRain.width + 1) * 4 + 3], 255);

  const row = 38, column = 50;
  const mercatorY = (1 - Math.asinh(Math.tan(raster.bounds[3] * Math.PI / 180)) / Math.PI) / 2 +
    ((row + 0.5) / raster.height) * ((1 - Math.asinh(Math.tan(raster.bounds[1] * Math.PI / 180)) / Math.PI) / 2 -
      (1 - Math.asinh(Math.tan(raster.bounds[3] * Math.PI / 180)) / Math.PI) / 2);
  const latitude = inverseMercator(mercatorY);
  const longitude = raster.bounds[0] + ((column + 0.5) / raster.width) * (raster.bounds[2] - raster.bounds[0]);
  const expected = sampleRain(data, 0, longitude, latitude);
  assert.equal(raster.pixels[(row * raster.width + column) * 4 + 3], Math.round(255 * expected / 0.1));
});

test('absolute logarithmic stops give distinct stable rain colors and a matching CSS ramp', () => {
  const expected = [
    [0.1, [108, 167, 255]],
    [0.3, [44, 212, 219]],
    [0.5, [85, 207, 117]],
    [1, [207, 228, 94]],
    [2, [246, 191, 67]],
    [4, [237, 107, 70]],
    [10, [204, 79, 148]],
    [20, [131, 75, 179]],
  ];
  for (const [rain, rgb] of expected) {
    const raster = buildRainRaster(weather(() => rain), 0, 5);
    assert.deepEqual([...raster.pixels.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 3)], rgb,
      `${rain} mm has its fixed absolute stop color`);
  }
  const logMidpoint = Math.sqrt(0.1 * 0.3);
  const midpoint = buildRainRaster(weather(() => logMidpoint), 0, 5);
  assert.deepEqual([...midpoint.pixels.slice(48, 51)], [76, 190, 237],
    'the midpoint in logarithmic rain space blends the adjacent color stops');

  const sameLocalRain = weather((index) => {
    const x = index % 5, y = Math.floor(index / 5);
    return x >= 1 && x <= 3 && y >= 1 && y <= 3 ? 1 : 20;
  });
  const uniform = buildRainRaster(weather(() => 1), 0, 5);
  const varying = buildRainRaster(sameLocalRain, 0, 5);
  assert.deepEqual([...varying.pixels.slice(48, 51)], [...uniform.pixels.slice(48, 51)],
    'one millimeter stays the same color even when the rest of the frame is much heavier');

  assert.equal(RAIN_COLOR_STOPS.length, 9);
  const gradient = rainColorGradient();
  assert.ok(gradient.startsWith('linear-gradient(90deg, #c4d9ff 0%'));
  assert.ok(gradient.endsWith('#834bb3 100%)'));
  for (let i = 1; i < RAIN_COLOR_STOPS.length; i++) {
    const [rain, color] = RAIN_COLOR_STOPS[i];
    const percent = (Math.log(rain) - Math.log(RAIN_COLOR_STOPS[0][0])) /
      (Math.log(20) - Math.log(0.05)) * 100;
    assert.ok(gradient.includes(`${color} ${percent}%`), `${rain} mm stop uses log-position ${percent}%`);
  }
});

test('raster bounds include half a grid cell and clamp latitude to Web Mercator limits', () => {
  const lowLatitude = weather(() => 1);
  const raster = buildRainRaster(lowLatitude, 0, 8);
  assert.ok(raster);
  assert.ok(Math.abs(raster.bounds[0] - (102.64 - GRID_STEP / 2)) < 1e-9);
  assert.ok(Math.abs(raster.bounds[2] - (103.92 + GRID_STEP / 2)) < 1e-9);
  assert.ok(Math.abs(raster.bounds[1] - (30.44 - GRID_STEP / 2)) < 1e-9);
  assert.ok(Math.abs(raster.bounds[3] - (31.72 + GRID_STEP / 2)) < 1e-9);

  const high = {
    ...lowLatitude,
    cells: lowLatitude.cells.map(cell => ({ ...cell, lat: cell.lat + 54 })),
  };
  const polar = buildRainRaster(high, 0, 8);
  assert.ok(polar);
  assert.equal(polar.bounds[3], 85);
});

test('rain raster accepts rectangular grids with independent regular axis spacing', () => {
  const lons = [99.36, 99.68, 100, 100.32, 100.64];
  const lats = [10, 10.64, 11.28];
  const data = {
    cells: lats.flatMap((lat, row) => lons.map((lng, column) => ({
      lng, lat, elevation: null,
      hours: [{ time: 1, rain: row + column }],
    }))),
    times: [1], fetchedAt: 1, anchor: [100, 10.64],
  };
  const raster = buildRainRaster(data, 0, 16);
  assert.ok(raster);
  assert.equal(raster.bounds[0], lons[0] - 0.16);
  assert.equal(raster.bounds[2], lons.at(-1) + 0.16);
  assert.equal(raster.bounds[1], lats[0] - 0.32);
  assert.equal(raster.bounds[3], lats.at(-1) + 0.32);
  assert.equal(sampleRain(data, 0, 100, 10.64), 3);

  const irregular = { ...data, cells: data.cells.map((cell, i) => i === 4 ? { ...cell, lng: cell.lng + 0.05 } : cell) };
  assert.equal(buildRainRaster(irregular, 0), null, 'irregular point coordinates are rejected');
  assert.equal(buildRainRaster({ ...data, cells: data.cells.slice(1) }, 0), null, 'a missing mesh point is rejected');
  const duplicate = { ...data, cells: [...data.cells.slice(1), { ...data.cells[1] }] };
  assert.equal(buildRainRaster(duplicate, 0), null, 'duplicate mesh positions are rejected');
});

test('constant rain fades across the half-cell source margin while inner coverage stays opaque', () => {
  const raster = buildRainRaster(weather(() => 1), 0, 32);
  assert.ok(raster);
  const row = 16;
  const alphaAt = column => raster.pixels[(row * raster.width + column) * 4 + 3];
  assert.ok(alphaAt(0) > 0 && alphaAt(0) < 255, 'the image boundary pixel is partially covered');
  assert.ok(alphaAt(1) > alphaAt(0), 'coverage increases smoothly inward');
  assert.equal(alphaAt(5), 255, 'the center sample domain remains fully opaque');
  assert.ok(alphaAt(31) > 0 && alphaAt(31) < 255, 'the far edge also fades instead of being cut');
  assert.ok(alphaAt(30) > alphaAt(31), 'coverage decreases toward the far edge');
});

test('missing data and out-of-range forecast indexes return null', () => {
  const data = weather(() => 1);
  assert.equal(buildRainRaster(null, 0), null);
  assert.equal(buildRainRaster(data, -1), null);
  assert.equal(buildRainRaster(data, 1), null);
  assert.equal(sampleRain(data, 1, 103.28, 31.08), null);
  const invalidCoordinates = {
    ...data,
    cells: data.cells.map((cell, index) => index === 0 ? { ...cell, lng: Number.NaN } : cell),
  };
  assert.equal(buildRainRaster(invalidCoordinates, 0), null);
  assert.equal(sampleRain(data, 0, Number.NaN, 31.08), null);
});
