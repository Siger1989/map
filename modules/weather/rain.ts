import { GRID_STEP, type WeatherData } from './data.ts';

export const RAIN_COLOR_STOPS = [
  [0.05, '#c4d9ff'],
  [0.1, '#6ca7ff'],
  [0.3, '#2cd4db'],
  [0.5, '#55cf75'],
  [1, '#cfe45e'],
  [2, '#f6bf43'],
  [4, '#ed6b46'],
  [10, '#cc4f94'],
  [20, '#834bb3'],
] as const;

export type RainRaster = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  bounds: [west: number, south: number, east: number, north: number];
};

type Grid = { lons: number[]; lats: number[]; lngStep: number; latStep: number; values: (number | null)[][] };

function makeGrid(data: WeatherData, index: number): Grid | null {
  if (!data.cells.some(cell => cell.hours[index])) return null;
  if (data.cells.some(cell => !Number.isFinite(cell.lng) || !Number.isFinite(cell.lat))) return null;
  const lons = [...new Set(data.cells.map(cell => cell.lng))].sort((a, b) => a - b);
  const lats = [...new Set(data.cells.map(cell => cell.lat))].sort((a, b) => a - b);
  if (lons.length < 2 || lons.length > 9 || lats.length < 2 || lats.length > 9 ||
      lons.length * lats.length !== data.cells.length) return null;
  const lngStep = lons[1] - lons[0], latStep = lats[1] - lats[0];
  const regular = (axis: number[], step: number) => Number.isFinite(step) && step >= GRID_STEP - 1e-6 &&
    axis.every((value, i) => Math.abs(value - (axis[0] + i * step)) <= 1e-5);
  if (!regular(lons, lngStep) || !regular(lats, latStep)) return null;
  const lonIndex = new Map(lons.map((value, i) => [value, i]));
  const latIndex = new Map(lats.map((value, i) => [value, i]));
  const values: (number | null)[][] = Array.from({ length: lats.length }, () => Array(lons.length).fill(null));
  const seen = Array.from({ length: lats.length }, () => Array(lons.length).fill(false));
  for (const cell of data.cells) {
    const x = lonIndex.get(cell.lng), y = latIndex.get(cell.lat);
    if (x === undefined || y === undefined || seen[y][x]) return null;
    seen[y][x] = true;
    const value = cell.hours[index]?.rain;
    values[y][x] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (seen.some(row => row.some(present => !present))) return null;
  return { lons, lats, lngStep, latStep, values };
}

function bracket(values: number[], step: number, value: number) {
  if (value <= values[0]) return { lower: 0, upper: 0, fraction: 0 };
  const last = values.length - 1;
  if (value >= values[last]) return { lower: last, upper: last, fraction: 0 };
  let lower = 0;
  while (lower + 1 < values.length && values[lower + 1] < value) lower++;
  const rawFraction = (value - values[lower]) / step;
  if (rawFraction < 1e-10) return { lower, upper: lower, fraction: 0 };
  if (1 - rawFraction < 1e-10) return { lower: lower + 1, upper: lower + 1, fraction: 0 };
  const fraction = rawFraction * rawFraction * (3 - 2 * rawFraction);
  return { lower, upper: lower + 1, fraction };
}

function interpolateRain(grid: Grid, lng: number, lat: number, clampToEdge = false): number | null {
  if (!clampToEdge && (lng < grid.lons[0] || lng > grid.lons.at(-1)! || lat < grid.lats[0] || lat > grid.lats.at(-1)!)) return null;
  const x = bracket(grid.lons, grid.lngStep, lng), y = bracket(grid.lats, grid.latStep, lat);
  const corners: [number, number, number][] = [
    [y.lower, x.lower, (1 - x.fraction) * (1 - y.fraction)],
    [y.lower, x.upper, x.fraction * (1 - y.fraction)],
    [y.upper, x.lower, (1 - x.fraction) * y.fraction],
    [y.upper, x.upper, x.fraction * y.fraction],
  ];
  let total = 0;
  for (const [row, column, weight] of corners) {
    if (weight <= 1e-10) continue;
    const value = grid.values[row][column];
    if (value === null) return null;
    total += value * weight;
  }
  return total;
}

/** Smoothstep-weighted bilinear rainfall; missing positive-weight neighbors stay missing. */
export function sampleRain(data: WeatherData | null, index: number, lng: number, lat: number): number | null {
  if (!data || !Number.isInteger(index) || index < 0 || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const grid = makeGrid(data, index);
  return grid ? interpolateRain(grid, lng, lat) : null;
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

const RAIN_RGB_STOPS = RAIN_COLOR_STOPS.map(([rain, color]) => [rain, hexRgb(color)] as const);
const LOG_RAIN_MIN = Math.log(RAIN_COLOR_STOPS[0][0]);
const LOG_RAIN_MAX = Math.log(RAIN_COLOR_STOPS[RAIN_COLOR_STOPS.length - 1][0]);

export function rainColorGradient(): string {
  return `linear-gradient(90deg, ${RAIN_COLOR_STOPS.map(([rain, color]) => {
    const percent = (Math.log(rain) - LOG_RAIN_MIN) / (LOG_RAIN_MAX - LOG_RAIN_MIN) * 100;
    return `${color} ${percent}%`;
  }).join(', ')})`;
}

function rainRgba(rain: number): [number, number, number, number] {
  if (!Number.isFinite(rain) || rain <= 0) return [0, 0, 0, 0];
  const alpha = rain < 0.1 ? Math.round(255 * rain / 0.1) : 255;
  const colorRain = Math.max(RAIN_COLOR_STOPS[0][0], rain);
  const stops = RAIN_RGB_STOPS;
  let left: typeof RAIN_RGB_STOPS[number] = stops[0];
  let right: typeof RAIN_RGB_STOPS[number] = stops[1];
  if (colorRain >= stops[stops.length - 1][0]) left = right = stops[stops.length - 1];
  else {
    for (let i = 1; i < stops.length; i++) {
      if (colorRain <= stops[i][0]) { left = stops[i - 1]; right = stops[i]; break; }
    }
  }
  const amount = left[0] === right[0] ? 0 :
    (Math.log(colorRain) - Math.log(left[0])) / (Math.log(right[0]) - Math.log(left[0]));
  const a = left[1], b = right[1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
    alpha,
  ];
}

function mercatorY(latitude: number) {
  const radians = latitude * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
}

function inverseMercatorY(y: number) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

export function buildRainRaster(data: WeatherData | null, index: number, size = 256): RainRaster | null {
  if (!data || !Number.isInteger(index) || index < 0 || !Number.isInteger(size) || size < 1) return null;
  const grid = makeGrid(data, index);
  if (!grid) return null;
  const halfLng = grid.lngStep / 2, halfLat = grid.latStep / 2;
  const west = Number((grid.lons[0] - halfLng).toFixed(6));
  const east = Number((grid.lons.at(-1)! + halfLng).toFixed(6));
  const south = Math.max(-85, Number((grid.lats[0] - halfLat).toFixed(6)));
  const north = Math.min(85, Number((grid.lats.at(-1)! + halfLat).toFixed(6)));
  if (east <= west || north <= south) return null;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const northY = mercatorY(north), southY = mercatorY(south);
  const minLng = grid.lons[0], maxLng = grid.lons[grid.lons.length - 1];
  const minLat = grid.lats[0], maxLat = grid.lats[grid.lats.length - 1];
  for (let py = 0; py < size; py++) {
    const mercator = northY + ((py + 0.5) / size) * (southY - northY);
    const lat = inverseMercatorY(mercator);
    for (let px = 0; px < size; px++) {
      const lng = west + ((px + 0.5) / size) * (east - west);
      const rain = interpolateRain(grid, lng, lat, true);
      if (rain === null) continue;
      const xCoverage = lng < minLng
        ? Math.max(0, Math.min(1, (lng - west) / (minLng - west)))
        : lng > maxLng
          ? Math.max(0, Math.min(1, (east - lng) / (east - maxLng)))
          : 1;
      const yCoverage = lat < minLat
        ? Math.max(0, Math.min(1, (lat - south) / (minLat - south)))
        : lat > maxLat
          ? Math.max(0, Math.min(1, (north - lat) / (north - maxLat)))
          : 1;
      const rgba = rainRgba(rain), offset = (py * size + px) * 4;
      rgba[3] = Math.round(rgba[3] * xCoverage * yCoverage);
      pixels.set(rgba, offset);
    }
  }
  return { width: size, height: size, pixels, bounds: [west, south, east, north] };
}
