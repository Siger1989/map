export type Hour = {
  time: number;
  temperature: number | null;
  rain: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  wind: number | null;
  direction: number | null;
  humidity: number | null;
  code: number | null;
};
export type WeatherCell = {
  lng: number;
  lat: number;
  elevation: number | null;
  hours: Hour[];
};
export type WeatherData = {
  cells: WeatherCell[];
  times: number[];
  fetchedAt: number;
  anchor: [number, number];
};
export const GRID_STEP = 0.32;
export type WeatherGridPoint = { lng: number; lat: number };
export type WeatherGridBounds = readonly [west: number, south: number, east: number, north: number];
export type WeatherViewportGrid = {
  points: WeatherGridPoint[];
  /** Outer raster footprint, including half a sample interval around the edge nodes. */
  bounds: [west: number, south: number, east: number, north: number];
  key: string;
  columns: number;
  rows: number;
  step: [longitude: number, latitude: number];
};

const MAX_VIEWPORT_GRID_AXIS = 9;
const MAX_MERCATOR_LAT = 85;

function viewportAxis(min: number, max: number) {
  const span = max - min;
  let step = Math.max(GRID_STEP, Math.ceil(span / 6 / GRID_STEP) * GRID_STEP);
  for (;;) {
    const start = Math.floor((min - step) / step + 1e-10) * step;
    const end = Math.ceil((max + step) / step - 1e-10) * step;
    const count = Math.round((end - start) / step) + 1;
    if (count <= MAX_VIEWPORT_GRID_AXIS && count >= 2) {
      return {
        start: Number(start.toFixed(6)),
        end: Number(end.toFixed(6)),
        count,
        step: Number(step.toFixed(6)),
      };
    }
    step = Number((step + GRID_STEP).toFixed(6));
  }
}

function mercatorLatitudeAxis(min: number, max: number) {
  const axis = viewportAxis(min, max);
  if (axis.start >= -MAX_MERCATOR_LAT && axis.end <= MAX_MERCATOR_LAT) return axis;
  let start = Math.max(-MAX_MERCATOR_LAT, axis.start);
  let end = Math.min(MAX_MERCATOR_LAT, axis.end);
  if (end - start < GRID_STEP) {
    if (start <= -MAX_MERCATOR_LAT) {
      start = -MAX_MERCATOR_LAT;
      end = -MAX_MERCATOR_LAT + GRID_STEP;
    } else {
      end = MAX_MERCATOR_LAT;
      start = MAX_MERCATOR_LAT - GRID_STEP;
    }
    return { start: Number(start.toFixed(6)), end: Number(end.toFixed(6)), count: 2, step: GRID_STEP };
  }
  const count = Math.max(2, Math.min(axis.count, Math.floor((end - start) / GRID_STEP) + 1));
  const step = Number(((end - start) / (count - 1)).toFixed(6));
  end = start + (count - 1) * step;
  return { start: Number(start.toFixed(6)), end: Number(end.toFixed(6)), count, step };
}

/**
 * Builds an aligned forecast sampling mesh for the visible geographic bounds.
 * Points are ordered south-to-north, then west-to-east; longitudes stay continuous
 * across the date line. Each side includes at least one whole sample interval of padding.
 */
export function weatherViewportGrid(bounds: WeatherGridBounds): WeatherViewportGrid | null {
  if (bounds.length !== 4 || bounds.some(value => !Number.isFinite(value))) return null;
  let [west, south, east, north] = bounds;
  if (east < west) east += Math.ceil((west - east) / 360) * 360;
  if (east - west >= 360) {
    const center = (west + east) / 2;
    west = center - 180;
    east = center + 180;
  }
  const clampedSouth = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, Math.min(south, north)));
  const clampedNorth = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, Math.max(south, north)));
  const x = viewportAxis(west, east), y = mercatorLatitudeAxis(clampedSouth, clampedNorth);
  const longitudes = Array.from({ length: x.count }, (_, i) => Number((x.start + i * x.step).toFixed(6)));
  const latitudes = Array.from({ length: y.count }, (_, i) => Number((y.start + i * y.step).toFixed(6)));
  const points = latitudes.flatMap(lat => longitudes.map(lng => ({ lng, lat })));
  const gridBounds: [number, number, number, number] = [
    Number((longitudes[0] - x.step / 2).toFixed(6)),
    Math.max(-MAX_MERCATOR_LAT, Number((latitudes[0] - y.step / 2).toFixed(6)),),
    Number((longitudes[longitudes.length - 1] + x.step / 2).toFixed(6)),
    Math.min(MAX_MERCATOR_LAT, Number((latitudes[latitudes.length - 1] + y.step / 2).toFixed(6)),),
  ];
  const key = `viewport-grid-v1:${x.count}x${y.count}:${x.step.toFixed(6)}x${y.step.toFixed(6)}:${gridBounds.map(value => value.toFixed(6)).join(',')}`;
  return { points, bounds: gridBounds, key, columns: x.count, rows: y.count, step: [x.step, y.step] };
}

export const numberOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
export function gridPoints(lng: number, lat: number) {
  return Array.from({ length: 25 }, (_, i) => ({
    lng: Number((lng + ((i % 5) - 2) * GRID_STEP).toFixed(3)),
    lat: Number((lat + (Math.floor(i / 5) - 2) * GRID_STEP).toFixed(3)),
  }));
}
export function normalizeWeather(
  raw: unknown,
  points: { lng: number; lat: number }[],
  now = Date.now(),
): WeatherData {
  const records = Array.isArray(raw) ? raw : [raw];
  if (records.length !== points.length)
    throw new Error('天气数据不完整，请重试');
  const cells: WeatherCell[] = records.map((record, index) => {
    const h = record?.hourly;
    if (!h || !Array.isArray(h.time) || !h.time.length)
      throw new Error('天气服务未返回可用时段');
    return {
      ...points[index],
      elevation: numberOrNull(record.elevation),
      hours: h.time.map((time: unknown, i: number): Hour => {
        if (typeof time !== 'number' || !Number.isFinite(time))
          throw new Error('天气时间格式无效');
        const value = (key: string) => numberOrNull(h[key]?.[i]);
        const rain = value('rain');
        const showers = value('showers');
        return {
          time: time * 1000,
          temperature: value('temperature_2m'),
          rain: rain !== null && showers !== null && rain >= 0 && showers >= 0
            ? rain + showers
            : null,
          low: value('cloud_cover_low'),
          mid: value('cloud_cover_mid'),
          high: value('cloud_cover_high'),
          wind: value('wind_speed_10m'),
          direction: value('wind_direction_10m'),
          humidity: value('relative_humidity_2m'),
          code: value('weather_code'),
        };
      }),
    };
  });
  const times = cells[0].hours.map((h) => h.time);
  if (
    cells.some(
      (cell) =>
        cell.hours.length !== times.length ||
        cell.hours.some((h, i) => h.time !== times[i]),
    )
  )
    throw new Error('各位置的天气时段不一致');
  const longitudes = points.map(point => point.lng), latitudes = points.map(point => point.lat);
  return {
    cells,
    times,
    fetchedAt: now,
    anchor: [
      (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
      (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    ],
  };
}
export function nearestCell(
  data: WeatherData | null,
  lng: number,
  lat: number,
): WeatherCell | null {
  if (
    !data ||
    Math.abs(data.anchor[0] - lng) > GRID_STEP * 2.5 ||
    Math.abs(data.anchor[1] - lat) > GRID_STEP * 2.5
  )
    return null;
  return data.cells.reduce((a, b) =>
    Math.hypot(a.lng - lng, a.lat - lat) < Math.hypot(b.lng - lng, b.lat - lat)
      ? a
      : b,
  );
}
export function describeWeather(code: number | null) {
  if (code === null) return '暂无天气状态';
  if (code <= 3) return ['晴', '晴间多云', '多云', '阴'][code];
  if (code <= 48) return '雾';
  if (code <= 57) return '毛毛雨';
  if (code <= 67) return '降雨';
  if (code <= 77) return '降雪';
  if (code <= 82) return '阵雨';
  if (code <= 86) return '阵雪';
  return '雷暴';
}
